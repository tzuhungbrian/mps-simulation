import * as THREE from "three";
import { cameraRay, projectPoint, type Pinhole } from "../sandbox/geometry";
import { evaluateBrdf, type TraceScene } from "../sandbox/lightTransport";
import {
  AMBIENT,
  cameraBlurSigma,
  fringeIntensity,
  fringePatterns,
  insideProjector,
  projectorContrast,
  surfaceMaterials,
  type WorldConfig,
} from "../sandbox/scanner";
import { NO_SURFACE } from "../sandbox/pcb";
import { scatterBlur } from "../sandbox/optics";
import type { Device } from "../sandbox/devices";
import { createSeededRandom, TAU } from "../core/simulation";

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
 * Direct-light forward model for one pair, identical physics to the sandbox
 * captureWorld (same BRDF, projector defocus contrast, camera scatter blur,
 * exposure, noise and clipping) but reusing a shared camera trace.
 * Interreflection is not modelled here.
 */
export function renderPair(
  scene: TraceScene,
  trace: CameraTrace,
  camera: Pinhole,
  projector: Pinhole,
  cameraDevice: Device,
  projectorDevice: Device,
  config: WorldConfig,
  seed: number,
): PairCaptures {
  const patterns = fringePatterns(config),
    frames = patterns.length,
    { width, height, grid } = trace,
    count = width * height,
    sub = grid * grid;
  const materials = surfaceMaterials(config);
  const signal = patterns.map(() => new Float64Array(count));
  const projectorOrigin = new THREE.Vector3(...projector.position),
    point = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    wo = new THREE.Vector3(),
    wi = new THREE.Vector3(),
    back = new THREE.Vector3();
  const contrast = new Float64Array(frames);
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
    projectorContrast(
      projector,
      projectorDevice,
      config,
      patterns,
      pp.depth,
      contrast,
    );
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
  const sigma = cameraBlurSigma(
    camera,
    cameraDevice,
    config,
    trace.centerDepth,
  );
  const blurred = sigma ? scatterBlur(signal, width, height, sigma) : signal;
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
