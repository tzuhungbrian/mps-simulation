import * as THREE from "three";
import { cameraRay, projectPoint, type Pinhole } from "../sandbox/geometry";
import {
  evaluateBrdf,
  type SurfaceMaterial,
  type TraceScene,
} from "../sandbox/lightTransport";
import { AMBIENT, fringeIntensity, insideProjector } from "../sandbox/scanner";
import { createSeededRandom, TAU } from "../core/simulation";
import {
  aoiPatterns,
  MATERIAL_SLOTS,
  type AoiConfig,
  type AoiDevice,
} from "./rig";
import { axisDepth, blurDiameter, blurSigma, gaussianMtf } from "./sensitivity";
import { NO_SURFACE } from "./scene";

/** Camera rays are shared by every projector paired with the camera. */
export interface CameraTrace {
  width: number;
  height: number;
  grid: number;
  /** Per sub-sample (pixel-major, grid² per pixel). */
  point: Float64Array;
  normal: Float64Array;
  slot: Uint8Array;
  /** Optical-axis depth of the pixel-centre hit (forward model only), NaN for background. */
  centerDepth: Float64Array;
}

export function traceCamera(
  scene: TraceScene,
  camera: Pinhole,
  grid: number,
): CameraTrace {
  const { width, height } = camera,
    count = width * height,
    sub = grid * grid;
  const trace: CameraTrace = {
    width,
    height,
    grid,
    point: new Float64Array(3 * count * sub).fill(NaN),
    normal: new Float64Array(3 * count * sub),
    slot: new Uint8Array(count * sub).fill(NO_SURFACE),
    centerDepth: new Float64Array(count).fill(NaN),
  };
  const origin = new THREE.Vector3(...camera.position),
    direction = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const px = i % width,
      py = Math.floor(i / width);
    if (grid > 1) {
      direction.fromArray(cameraRay(camera, px, py));
      const centre = scene.trace(origin, direction);
      if (centre)
        trace.centerDepth[i] = projectPoint(
          camera,
          centre.point.toArray(),
        )!.depth;
    }
    for (let sy = 0; sy < grid; sy++)
      for (let sx = 0; sx < grid; sx++) {
        const s = i * sub + sy * grid + sx;
        direction.fromArray(
          cameraRay(
            camera,
            px + (sx + 0.5) / grid - 0.5,
            py + (sy + 0.5) / grid - 0.5,
          ),
        );
        const hit = scene.trace(origin, direction);
        if (!hit) continue;
        trace.point.set([hit.point.x, hit.point.y, hit.point.z], 3 * s);
        trace.normal.set([hit.normal.x, hit.normal.y, hit.normal.z], 3 * s);
        trace.slot[s] = hit.mesh;
        if (grid === 1)
          trace.centerDepth[i] = projectPoint(
            camera,
            hit.point.toArray(),
          )!.depth;
      }
  }
  return trace;
}

export interface PairCaptures {
  width: number;
  height: number;
  frames: Float64Array[];
  clipped: Uint8Array;
}

const MAX_BLUR_RADIUS = 20;

/**
 * Spatially varying defocus: every source pixel spreads with its own Gaussian
 * (separable two-pass approximation, exact for uniform σ; energy kept inside the image).
 */
export function scatterBlur(
  images: Float64Array[],
  width: number,
  height: number,
  sigma: Float64Array,
): Float64Array[] {
  const pass = (input: Float64Array[], horizontal: boolean) => {
    const output = input.map(() => new Float64Array(width * height));
    const weights = new Float64Array(2 * MAX_BLUR_RADIUS + 1);
    for (let i = 0; i < width * height; i++) {
      const s = sigma[i];
      if (!(s >= 0.2)) {
        for (let k = 0; k < input.length; k++) output[k][i] += input[k][i];
        continue;
      }
      const x = i % width,
        y = Math.floor(i / width),
        pos = horizontal ? x : y,
        size = horizontal ? width : height,
        radius = Math.min(MAX_BLUR_RADIUS, Math.ceil(3 * s)),
        lo = Math.max(-radius, -pos),
        hi = Math.min(radius, size - 1 - pos);
      let total = 0;
      for (let d = lo; d <= hi; d++)
        total += weights[d + radius] = Math.exp((-d * d) / (2 * s * s));
      for (let d = lo; d <= hi; d++) {
        const j = horizontal ? i + d : i + d * width,
          w = weights[d + radius] / total;
        for (let k = 0; k < input.length; k++) output[k][j] += w * input[k][i];
      }
    }
    return output;
  };
  return pass(pass(images, true), false);
}

/** Deterministic per-pair noise stream derived from the global seed. */
export const pairSeed = (
  seed: number,
  cameraIndex: number,
  projectorIndex: number,
) =>
  (seed ^
    Math.imul(cameraIndex + 1, 0x9e3779b1) ^
    Math.imul(projectorIndex + 1, 0x85ebca6b)) >>>
  0;

/**
 * Forward model for one camera–projector pair: projector point light with exact
 * visibility, Lambert + GGX BRDF, thin-lens projector defocus (Gaussian MTF on
 * each sinusoid), camera defocus (scatter blur), additive Gaussian noise and clipping.
 * Direct illumination only; interreflection is not modelled here.
 */
export function renderPair(
  scene: TraceScene,
  trace: CameraTrace,
  camera: Pinhole,
  projector: Pinhole,
  cameraDevice: AoiDevice,
  projectorDevice: AoiDevice,
  config: AoiConfig,
  seed: number,
): PairCaptures {
  const patterns = aoiPatterns(config),
    frames = patterns.length,
    { width, height, grid } = trace,
    count = width * height,
    sub = grid * grid;
  const materials: SurfaceMaterial[] = MATERIAL_SLOTS.map(
    (slot) => config.materials[slot],
  );
  const signal = patterns.map(() => new Float64Array(count));
  const projectorOrigin = new THREE.Vector3(...projector.position),
    point = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    wo = new THREE.Vector3(),
    wi = new THREE.Vector3(),
    back = new THREE.Vector3();
  const projectorFocus = axisDepth(projectorDevice, config.focusHeight),
    contrast = new Float64Array(frames);
  for (let s = 0; s < count * sub; s++) {
    const slot = trace.slot[s];
    if (slot === NO_SURFACE) continue;
    point.fromArray(trace.point, 3 * s);
    normal.fromArray(trace.normal, 3 * s);
    wo.fromArray(camera.position).sub(point).normalize();
    if (normal.dot(wo) <= 0) continue;
    const pp = projectPoint(projector, [point.x, point.y, point.z]);
    if (!pp || !insideProjector(projector, pp)) continue;
    wi.subVectors(projectorOrigin, point);
    const distance = wi.length();
    wi.divideScalar(distance);
    const cos = normal.dot(wi);
    if (cos <= 0) continue;
    if (
      scene.trace(
        projectorOrigin,
        back.copy(wi).negate(),
        0,
        distance - 1e-6 * Math.max(1, distance),
      )
    )
      continue;
    const radiance = evaluateBrdf(materials[slot], normal, wi, wo) * cos;
    const sigma =
      config.defocus && projectorDevice.aperture > 0
        ? blurSigma(
            blurDiameter(
              projector.fx,
              projectorDevice.aperture,
              pp.depth,
              projectorFocus,
            ),
          )
        : 0;
    for (let k = 0; k < frames; k++)
      contrast[k] =
        sigma > 0
          ? gaussianMtf(sigma, projector.width / patterns[k].frequency)
          : 1;
    const pixel = Math.floor(s / sub);
    for (let k = 0; k < frames; k++)
      signal[k][pixel] +=
        radiance *
        fringeIntensity(
          pp.u,
          projector.width,
          patterns[k],
          config.fringeOffset,
          config.fringeAmplitude,
          contrast[k],
        );
  }
  // π maps radiance to normalized intensity (white Lambertian facing the projector reads p_k).
  const gain = (Math.PI * config.exposure) / sub;
  for (const image of signal) for (let i = 0; i < count; i++) image[i] *= gain;
  let blurred = signal;
  if (config.defocus && cameraDevice.aperture > 0) {
    const focus = axisDepth(cameraDevice, config.focusHeight);
    const sigma = trace.centerDepth.map((depth) =>
      Number.isFinite(depth)
        ? blurSigma(
            blurDiameter(camera.fx, cameraDevice.aperture, depth, focus),
          )
        : 0,
    );
    blurred = scatterBlur(signal, width, height, sigma);
  }
  const random = createSeededRandom(seed);
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
  const clipped = new Uint8Array(count);
  for (let i = 0; i < count; i++)
    for (let k = 0; k < frames; k++) {
      const value =
        AMBIENT +
        blurred[k][i] +
        (config.noiseSigma === 0 ? 0 : config.noiseSigma * gaussian());
      if (value <= 0 || value >= 1) clipped[i] = 1;
      blurred[k][i] = Math.max(0, Math.min(1, value));
    }
  return { width, height, frames: blurred, clipped };
}
