import * as THREE from "three";
import {
  makePinhole,
  cameraRay,
  projectPoint,
  triangulateColumn,
  type Pinhole,
  type Vec3,
} from "./geometry";
import {
  createSeededRandom,
  decodeNStep,
  TAU,
  type PhaseResult,
} from "../core/simulation";
import {
  buildTraceScene,
  evaluateBrdf,
  sampleBrdf,
  type SurfaceMaterial,
} from "./lightTransport";
import { buildPcbGeometry } from "./pcb";

export const WORLD_SHAPES = [
  "sphere",
  "box",
  "ramp",
  "vgroove",
  "pcb",
] as const;

export interface WorldConfig {
  shape: (typeof WORLD_SHAPES)[number];
  x: number;
  y: number;
  z: number;
  /** Full opening angle of the V-groove in degrees. */
  grooveAngle: number;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  projectorX: number;
  projectorY: number;
  projectorZ: number;
  cameraFov: number;
  /** Projector vertical field of view in degrees. */
  projectorFov: number;
  /** Fringe periods across the projector width. */
  fringeFrequency: number;
  /** Phase-shift steps N; shifts are 2πk/N. */
  phaseSteps: number;
  /** Projected pattern = offset + amplitude·cos(…), both in projector gray level. */
  fringeOffset: number;
  fringeAmplitude: number;
  /** Add N unit-frequency frames to resolve the fringe order when frequency > 1. */
  temporalUnwrap: boolean;
  /** Camera image width in pixels; height is always 3/4 of it. */
  cameraWidth: number;
  /** n×n sub-rays averaged per pixel (1 = point sampling, no mixed pixels). */
  pixelGrid: number;
  seed: number;
  noiseSigma: number;
  objectAlbedo: number;
  objectSpecular: number;
  objectRoughness: number;
  groundAlbedo: number;
  groundSpecular: number;
  groundRoughness: number;
  chipAlbedo: number;
  chipSpecular: number;
  chipRoughness: number;
  pinAlbedo: number;
  pinSpecular: number;
  pinRoughness: number;
  interreflection: boolean;
  bounces: number;
  giSamples: number;
}

export const DEFAULT_WORLD: WorldConfig = {
  shape: "sphere",
  x: 0,
  y: 0.75,
  z: 0,
  grooveAngle: 90,
  cameraX: 0,
  cameraY: 3.5,
  cameraZ: 0,
  projectorX: 2.5,
  projectorY: 0.75,
  projectorZ: 0,
  cameraFov: 45,
  projectorFov: 55,
  fringeFrequency: 1,
  phaseSteps: 3,
  fringeOffset: 0.4,
  fringeAmplitude: 0.36,
  temporalUnwrap: true,
  cameraWidth: 96,
  pixelGrid: 1,
  seed: 42,
  noiseSigma: 0,
  objectAlbedo: 0.8,
  objectSpecular: 0,
  objectRoughness: 0.3,
  groundAlbedo: 0.5,
  groundSpecular: 0,
  groundRoughness: 0.6,
  chipAlbedo: 0.06,
  chipSpecular: 0.04,
  chipRoughness: 0.5,
  pinAlbedo: 0,
  pinSpecular: 0.8,
  pinRoughness: 0.35,
  interreflection: false,
  bounces: 1,
  giSamples: 32,
};

/** Inspection setup applied when choosing the PCB: board material, overhead rig, finer camera. */
export const PCB_SETUP: Partial<WorldConfig> = {
  shape: "pcb",
  x: 0,
  y: 0.65,
  z: 0,
  cameraX: 0,
  cameraY: 2.6,
  cameraZ: 0,
  projectorX: 1.2,
  projectorY: 2.3,
  projectorZ: 0,
  cameraWidth: 256,
  pixelGrid: 2,
  objectAlbedo: 0.25,
  objectSpecular: 0.06,
  objectRoughness: 0.3,
};

/** Both devices always aim at the object's current centre and stay RIG_MIN_DISTANCE away. */
export const rigTarget = (config: WorldConfig): Vec3 => [
  config.x,
  config.y,
  config.z,
];
export const RIG_MIN_DISTANCE = 0.5;

export const WORLD_LIMITS = {
  x: [-2, 2],
  y: [0.65, 2.5],
  z: [-2, 2],
  grooveAngle: [30, 150],
  cameraX: [-5, 5],
  cameraY: [0.3, 6],
  cameraZ: [-5, 6],
  projectorX: [-5, 5],
  projectorY: [0.3, 6],
  projectorZ: [-5, 6],
  cameraFov: [30, 75],
  projectorFov: [30, 80],
  fringeFrequency: [1, 32],
  phaseSteps: [3, 8],
  fringeOffset: [0.05, 0.95],
  fringeAmplitude: [0.01, 0.5],
  cameraWidth: [64, 384],
  pixelGrid: [1, 3],
  seed: [0, 4294967295],
  noiseSigma: [0, 0.01],
  objectAlbedo: [0, 1],
  objectSpecular: [0, 1],
  objectRoughness: [0.05, 1],
  groundAlbedo: [0, 1],
  groundSpecular: [0, 1],
  groundRoughness: [0.05, 1],
  chipAlbedo: [0, 1],
  chipSpecular: [0, 1],
  chipRoughness: [0.05, 1],
  pinAlbedo: [0, 1],
  pinSpecular: [0, 1],
  pinRoughness: [0.05, 1],
  bounces: [1, 3],
  giSamples: [8, 256],
} as const satisfies Record<
  Exclude<keyof WorldConfig, BooleanKey | "shape">,
  readonly [number, number]
>;
export const BOOLEAN_KEYS = ["interreflection", "temporalUnwrap"] as const;
type BooleanKey = (typeof BOOLEAN_KEYS)[number];
const INTEGER_KEYS = new Set([
  "seed",
  "bounces",
  "giSamples",
  "cameraWidth",
  "pixelGrid",
  "fringeFrequency",
  "phaseSteps",
]);
export const cameraHeight = (config: WorldConfig) =>
  (config.cameraWidth * 3) / 4;

export function validateWorldConfig(config: WorldConfig): void {
  if (!(WORLD_SHAPES as readonly string[]).includes(config.shape))
    throw new RangeError("Unknown world shape");
  for (const key of BOOLEAN_KEYS)
    if (typeof config[key] !== "boolean")
      throw new RangeError(`${key} must be a boolean`);
  const limits = WORLD_LIMITS;
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = config[key];
    const [lo, hi] = limits[key];
    const integer = INTEGER_KEYS.has(key);
    if (
      !Number.isFinite(value) ||
      value < lo ||
      value > hi ||
      (integer && !Number.isInteger(value))
    )
      throw new RangeError(
        `Invalid ${key}: expected [${lo}, ${hi}]${integer ? " integer" : ""}`,
      );
  }
  if (config.cameraWidth % 4 !== 0)
    throw new RangeError("cameraWidth must be a multiple of 4 (4:3 images)");
  if (
    config.fringeAmplitude >
    Math.min(config.fringeOffset, 1 - config.fringeOffset) + 1e-9
  )
    throw new RangeError(
      "fringeAmplitude must keep the pattern inside [0, 1] (≤ offset and ≤ 1 − offset)",
    );
  for (const device of ["camera", "projector"] as const) {
    const p = [
      config[`${device}X`],
      config[`${device}Y`],
      config[`${device}Z`],
    ];
    if (
      Math.hypot(...p.map((v, axis) => v - rigTarget(config)[axis])) <
      RIG_MIN_DISTANCE
    )
      throw new RangeError(
        `${device} must stay at least ${RIG_MIN_DISTANCE} m from the aim point`,
      );
  }
}

/** Validate an import and discard unknown fields; numeric strings are never coerced. */
export function parseWorldConfig(value: unknown): WorldConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new RangeError("World config must be an object");
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, "shape") || typeof record.shape !== "string")
    throw new RangeError("shape must be a string");
  const result = { shape: record.shape } as WorldConfig;
  for (const key of BOOLEAN_KEYS) {
    const flag = Object.hasOwn(record, key) ? record[key] : undefined;
    if (typeof flag !== "boolean")
      throw new RangeError(`${key} must be a boolean`);
    result[key] = flag;
  }
  for (const key of Object.keys(
    WORLD_LIMITS,
  ) as (keyof typeof WORLD_LIMITS)[]) {
    if (!Object.hasOwn(record, key) || typeof record[key] !== "number")
      throw new RangeError(`${key} must be a number`);
    result[key] = record[key];
  }
  validateWorldConfig(result);
  return result;
}

/** V-groove block (1.6 × 0.8 × 1.2) whose groove runs along Z, centred at the origin. */
function vGrooveGeometry(angleDegrees: number): THREE.BufferGeometry {
  const halfWidth = 0.8,
    halfHeight = 0.4,
    tan = Math.tan((angleDegrees * Math.PI) / 360),
    depth = Math.min(0.6, 0.7 / tan),
    opening = depth * tan;
  const shape = new THREE.Shape([
    new THREE.Vector2(-halfWidth, -halfHeight),
    new THREE.Vector2(halfWidth, -halfHeight),
    new THREE.Vector2(halfWidth, halfHeight),
    new THREE.Vector2(opening, halfHeight),
    new THREE.Vector2(0, halfHeight - depth),
    new THREE.Vector2(-opening, halfHeight),
    new THREE.Vector2(-halfWidth, halfHeight),
  ]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1.2,
    bevelEnabled: false,
  });
  geometry.translate(0, 0, -0.6);
  return geometry;
}

export function createWorld(config: WorldConfig): {
  scene: THREE.Scene;
  object: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  ground: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  meshes: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[];
  dispose: () => void;
} {
  validateWorldConfig(config);
  const scene = new THREE.Scene();
  const geometry =
    config.shape === "sphere"
      ? new THREE.SphereGeometry(0.65, 24, 16)
      : config.shape === "box"
        ? new THREE.BoxGeometry(1.2, 1.2, 1.2)
        : config.shape === "vgroove"
          ? vGrooveGeometry(config.grooveAngle)
          : config.shape === "pcb"
            ? buildPcbGeometry().geometry
            : new THREE.BoxGeometry(1.5, 0.4, 1.2);
  const object = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0x5bbdcd, side: THREE.DoubleSide }),
  );
  object.position.set(config.x, config.y, config.z);
  if (config.shape === "ramp") object.rotation.z = -0.35;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshBasicMaterial({ color: 0x57647b, side: THREE.DoubleSide }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(object, ground);
  scene.updateMatrixWorld(true);
  const meshes = [object, ground];
  const owned = meshes.map((mesh) => ({
    geometry: mesh.geometry,
    material: mesh.material,
  }));
  return {
    scene,
    object,
    ground,
    meshes,
    dispose: () => {
      for (const resource of owned) {
        resource.geometry.dispose();
        resource.material.dispose();
      }
      scene.clear();
    },
  };
}

export interface WorldCaptures {
  width: number;
  height: number;
  /** One image per entry of fringePatterns(config). */
  frames: Float64Array[];
  clipped: Uint8Array;
  /** Camera optical-axis depth, evaluation only. Never passed to reconstruction. */
  truthDepth: Float64Array;
  cameraHit: Uint8Array;
  /** Camera hits unilluminated by the projector (occlusion, outside FoV, or back-facing). */
  shadowMask: Uint8Array;
  /** Material slot seen by each pixel (see SURFACE), 255 for background; evaluation only. */
  surface: Uint8Array;
  /** PCB pin seen by each pixel, −1 elsewhere; evaluation only. */
  pinId: Int16Array;
  /** Forward-model light components (no ambient, noise or clipping); evaluation only. */
  direct: Float64Array[];
  indirect: Float64Array[];
  /** Counterfactual captures without interreflection, same noise; evaluation only. */
  directOnly: {
    frames: Float64Array[];
    clipped: Uint8Array;
  } | null;
}

/** Constant camera offset (ambient + black level) in normalized intensity. */
export const AMBIENT = 0.12;

export type FringeCoding = Pick<
  WorldConfig,
  "fringeFrequency" | "phaseSteps" | "temporalUnwrap"
>;
export interface FringePattern {
  frequency: number;
  shift: number;
}
/** Capture order: N shifted patterns at the chosen frequency, then N unit-frequency ones for unwrapping. */
export function fringePatterns(coding: FringeCoding): FringePattern[] {
  const n = coding.phaseSteps;
  const set = (frequency: number) =>
    Array.from({ length: n }, (_, k) => ({ frequency, shift: (TAU * k) / n }));
  return coding.fringeFrequency > 1 && coding.temporalUnwrap
    ? [...set(coding.fringeFrequency), ...set(1)]
    : set(coding.fringeFrequency);
}
/** Projector gray level at column u; phase φ = 2πf(u + ½)/W − π spans f periods. */
const projectorPattern = (
  u: number,
  width: number,
  pattern: FringePattern,
  config: WorldConfig,
) =>
  config.fringeOffset +
  config.fringeAmplitude *
    Math.cos(
      (TAU * pattern.frequency * (u + 0.5)) / width - Math.PI + pattern.shift,
    );
const stack = (frames: number, count: number) =>
  Array.from({ length: frames }, () => new Float64Array(count));

const insideProjector = (
  projector: Pinhole,
  p: { u: number; v: number } | null,
): boolean =>
  !!p &&
  p.u >= -0.5 &&
  p.u < projector.width - 0.5 &&
  p.v >= -0.5 &&
  p.v < projector.height - 0.5;

/**
 * CPU float64 light transport on the very same triangle meshes used by the UI:
 * projector point light with exact visibility, GGX + Lambert BRDF, and optional
 * Monte Carlo interreflection (next-event estimation at every bounce).
 */
export function captureWorld(
  config: WorldConfig,
  width = config.cameraWidth,
  height = cameraHeight(config),
  onProgress?: (fraction: number) => void,
): WorldCaptures {
  const { camera, projector } = getRig(config, width, height);
  const world = createWorld(config);
  const scene = buildTraceScene(world.meshes);
  const material = (prefix: "object" | "ground" | "chip" | "pin") => ({
    albedo: config[`${prefix}Albedo`],
    specular: config[`${prefix}Specular`],
    roughness: config[`${prefix}Roughness`],
  });
  // Indexed by SURFACE slot: object, ground, chip body, pin.
  const materials: SurfaceMaterial[] = [
    material("object"),
    material("ground"),
    material("chip"),
    material("pin"),
  ];
  const count = width * height;
  const patterns = fringePatterns(config),
    frameCount = patterns.length;
  const capture: WorldCaptures = {
    width,
    height,
    frames: stack(frameCount, count),
    clipped: new Uint8Array(count),
    truthDepth: new Float64Array(count).fill(NaN),
    cameraHit: new Uint8Array(count),
    shadowMask: new Uint8Array(count),
    surface: new Uint8Array(count).fill(255),
    pinId: new Int16Array(count).fill(-1),
    direct: stack(frameCount, count),
    indirect: stack(frameCount, count),
    directOnly: config.interreflection
      ? { frames: stack(frameCount, count), clipped: new Uint8Array(count) }
      : null,
  };
  const cameraOrigin = new THREE.Vector3(...camera.position),
    projectorOrigin = new THREE.Vector3(...projector.position),
    direction = new THREE.Vector3(),
    toProjector = new THREE.Vector3(),
    fromProjector = new THREE.Vector3(),
    wo = new THREE.Vector3(),
    wi = new THREE.Vector3(),
    origin = new THREE.Vector3();
  // Leaves the unit direction to the projector in toProjector.
  const illuminate = (point: THREE.Vector3, normal: THREE.Vector3) => {
    const pp = projectPoint(projector, [point.x, point.y, point.z]);
    if (!pp || !insideProjector(projector, pp)) return null;
    toProjector.subVectors(projectorOrigin, point);
    const distance = toProjector.length();
    toProjector.divideScalar(distance);
    const cos = normal.dot(toProjector);
    if (cos <= 0) return null;
    // Visible when nothing lies strictly before the point; robust to shared-edge cracks.
    const blocker = scene.trace(
      projectorOrigin,
      fromProjector.copy(toProjector).negate(),
      0,
      distance - 1e-6 * Math.max(1, distance),
    );
    if (blocker) return null;
    return { u: pp.u, cos };
  };
  const giRandom = createSeededRandom((config.seed ^ 0x9e3779b9) >>> 0);
  const directSum = new Array<number>(frameCount).fill(0),
    indirectSum = new Array<number>(frameCount).fill(0);
  const grid = config.pixelGrid,
    subpixels = grid * grid,
    pathsPerSubpixel = config.interreflection
      ? Math.max(1, Math.round(config.giSamples / subpixels))
      : 0;
  const subRay = new THREE.Vector3();
  // Adds one camera ray's direct and indirect radiance to the per-pixel sums.
  const shade = (hit: NonNullable<ReturnType<typeof scene.trace>>) => {
    if (hit.normal.dot(wo) <= 0) return;
    const lit = illuminate(hit.point, hit.normal);
    if (lit) {
      const radiance =
        evaluateBrdf(materials[hit.mesh], hit.normal, toProjector, wo) *
        lit.cos;
      for (let k = 0; k < frameCount; k++)
        directSum[k] +=
          radiance *
          projectorPattern(lit.u, projector.width, patterns[k], config);
    }
    for (let s = 0; s < pathsPerSubpixel; s++) {
      let throughput = 1,
        point = hit.point,
        normal = hit.normal,
        material = materials[hit.mesh];
      const pathWo = wo.clone();
      for (let bounce = 0; bounce < config.bounces; bounce++) {
        const weight = sampleBrdf(material, normal, pathWo, giRandom, wi);
        if (weight <= 0) break;
        throughput *= weight;
        origin.copy(point).addScaledVector(normal, 1e-5);
        const next = scene.trace(origin, wi);
        if (!next) break;
        pathWo.copy(wi).negate();
        if (next.normal.dot(pathWo) <= 0) break;
        const light = illuminate(next.point, next.normal);
        if (light) {
          const contribution =
            throughput *
            evaluateBrdf(
              materials[next.mesh],
              next.normal,
              toProjector,
              pathWo,
            ) *
            light.cos;
          for (let k = 0; k < frameCount; k++)
            indirectSum[k] +=
              contribution *
              projectorPattern(light.u, projector.width, patterns[k], config);
        }
        point = next.point;
        normal = next.normal;
        material = materials[next.mesh];
      }
    }
  };
  try {
    for (let i = 0; i < count; i++) {
      const px = i % width,
        py = Math.floor(i / width);
      if (onProgress && px === 0) onProgress(py / height);
      // The pixel-centre ray defines truth, surface labels and the shadow mask.
      direction.fromArray(cameraRay(camera, px, py));
      const hit = scene.trace(cameraOrigin, direction);
      if (hit) {
        capture.cameraHit[i] = 1;
        capture.surface[i] = hit.mesh;
        capture.pinId[i] = hit.pin;
        capture.truthDepth[i] = projectPoint(
          camera,
          hit.point.toArray(),
        )!.depth;
        wo.copy(direction).negate();
        capture.shadowMask[i] =
          hit.normal.dot(wo) > 0 && illuminate(hit.point, hit.normal) ? 0 : 1;
      }
      directSum.fill(0);
      indirectSum.fill(0);
      for (let sy = 0; sy < grid; sy++)
        for (let sx = 0; sx < grid; sx++) {
          if (grid === 1) {
            if (hit) shade(hit);
            continue;
          }
          // Pixel-area integration: mixed pixels blend neighbouring surfaces.
          subRay.fromArray(
            cameraRay(
              camera,
              px + (sx + 0.5) / grid - 0.5,
              py + (sy + 0.5) / grid - 0.5,
            ),
          );
          const sub = scene.trace(cameraOrigin, subRay);
          if (!sub) continue;
          wo.copy(subRay).negate();
          shade(sub);
        }
      // π maps radiance to normalized intensity: a white Lambertian facing the projector reads p_k.
      for (let k = 0; k < frameCount; k++) {
        capture.direct[k][i] = (Math.PI * directSum[k]) / subpixels;
        if (pathsPerSubpixel)
          capture.indirect[k][i] =
            (Math.PI * indirectSum[k]) / (subpixels * pathsPerSubpixel);
      }
    }
    const random = createSeededRandom(config.seed);
    const gaussian = () =>
      Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
    const expose = (
      value: number,
      target: { frames: Float64Array[]; clipped: Uint8Array },
      i: number,
      k: number,
    ) => {
      if (value <= 0 || value >= 1) target.clipped[i] = 1;
      target.frames[k][i] = Math.max(0, Math.min(1, value));
    };
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < frameCount; k++) {
        const noise =
          config.noiseSigma === 0 ? 0 : config.noiseSigma * gaussian();
        const direct = AMBIENT + capture.direct[k][i] + noise;
        expose(direct + capture.indirect[k][i], capture, i, k);
        if (capture.directOnly) expose(direct, capture.directOnly, i, k);
      }
    }
    onProgress?.(1);
    return capture;
  } finally {
    scene.dispose();
    world.dispose();
  }
}

export interface WorldReconstruction {
  /** Wrapped phase of the chosen-frequency patterns. */
  phase: PhaseResult;
  /** Unit-frequency phase used for temporal unwrapping, when projected. */
  lowPhase: PhaseResult | null;
  /** Absolute phase after unwrapping (equals the wrapped phase when not unwrapped). */
  absolute: Float64Array;
  /** Decoded projector column. */
  column: Float64Array;
  depth: Float64Array;
  points: Float64Array;
  valid: Uint8Array;
  validCount: number;
}

const DEFAULT_CODING: FringeCoding = {
  fringeFrequency: 1,
  phaseSteps: 3,
  temporalUnwrap: true,
};

/** Inverse boundary: only intensities, clipping flags, the known pattern coding and calibration enter. */
export function reconstructCaptures(
  captures: Pick<WorldCaptures, "width" | "height" | "frames" | "clipped">,
  camera: Pinhole,
  projector: Pinhole,
  coding: FringeCoding = DEFAULT_CODING,
): WorldReconstruction {
  const { width, height, frames, clipped } = captures;
  const count = width * height;
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    !Number.isSafeInteger(count) ||
    camera.width !== width ||
    camera.height !== height ||
    frames.length !== fringePatterns(coding).length ||
    frames.some((frame) => frame.length !== count) ||
    clipped.length !== count
  )
    throw new RangeError(
      "Capture dimensions, frame count and lengths, clipping mask and camera calibration must match",
    );
  const n = coding.phaseSteps,
    f = coding.fringeFrequency;
  const phase = decodeNStep(frames.slice(0, n), 0.01, clipped);
  const lowPhase =
    frames.length > n ? decodeNStep(frames.slice(n), 0.01, clipped) : null;
  const result: WorldReconstruction = {
    phase,
    lowPhase,
    absolute: new Float64Array(count).fill(NaN),
    column: new Float64Array(count).fill(NaN),
    depth: new Float64Array(count).fill(NaN),
    points: new Float64Array(3 * count).fill(NaN),
    valid: new Uint8Array(count),
    validCount: 0,
  };
  for (let i = 0; i < count; i++) {
    if (!phase.valid[i] || (lowPhase && !lowPhase.valid[i])) continue;
    let absolute = phase.wrapped[i];
    if (lowPhase) {
      // Scale the unambiguous unit-frequency phase to predict the fringe order.
      const predicted = f * (lowPhase.wrapped[i] + Math.PI) - Math.PI;
      absolute += TAU * Math.round((predicted - absolute) / TAU);
    }
    const u = (projector.width * (absolute + Math.PI)) / (TAU * f) - 0.5;
    if (!Number.isFinite(u) || u < -0.5 || u >= projector.width - 0.5) continue;
    const point = triangulateColumn(
      camera,
      projector,
      i % width,
      Math.floor(i / width),
      u,
    );
    if (!point) continue;
    const cp = projectPoint(camera, point);
    if (!cp || !insideProjector(projector, projectPoint(projector, point)))
      continue;
    result.depth[i] = cp.depth;
    result.absolute[i] = absolute;
    result.column[i] = u;
    result.points.set(point, 3 * i);
    result.valid[i] = 1;
    result.validCount++;
  }
  return result;
}

export interface WorldScan {
  capture: WorldCaptures;
  reconstruction: WorldReconstruction;
  /** Same pipeline on the no-interreflection counterfactual; evaluation only. */
  directReconstruction: WorldReconstruction | null;
  camera: Pinhole;
  projector: Pinhole;
  metrics: {
    rmseDepth: number | null;
    directRmseDepth: number | null;
    validCount: number;
    cameraHitCount: number;
    totalCount: number;
    validRatio: number;
    occludedCount: number;
    evaluatedCount: number;
  };
}

function depthRmse(
  reconstruction: WorldReconstruction,
  truthDepth: Float64Array,
): { rmse: number | null; count: number } {
  let squaredError = 0,
    count = 0;
  for (let i = 0; i < truthDepth.length; i++) {
    if (!reconstruction.valid[i] || !Number.isFinite(truthDepth[i])) continue;
    squaredError += (reconstruction.depth[i] - truthDepth[i]) ** 2;
    count++;
  }
  return { rmse: count ? Math.sqrt(squaredError / count) : null, count };
}

export function runWorldScan(
  config: WorldConfig,
  width = config.cameraWidth,
  height = cameraHeight(config),
  onProgress?: (fraction: number) => void,
): WorldScan {
  const { camera, projector } = getRig(config, width, height);
  const capture = captureWorld(config, width, height, onProgress);
  // Intentionally construct an explicit field-only payload: truth and visibility never cross this boundary.
  const reconstruction = reconstructCaptures(
    { width, height, frames: capture.frames, clipped: capture.clipped },
    camera,
    projector,
    config,
  );
  const directReconstruction = capture.directOnly
    ? reconstructCaptures(
        {
          width,
          height,
          frames: capture.directOnly.frames,
          clipped: capture.directOnly.clipped,
        },
        camera,
        projector,
        config,
      )
    : null;
  let cameraHitCount = 0,
    occludedCount = 0;
  const totalCount = width * height;
  for (let i = 0; i < totalCount; i++) {
    cameraHitCount += capture.cameraHit[i];
    occludedCount += capture.shadowMask[i];
  }
  const evaluated = depthRmse(reconstruction, capture.truthDepth);
  return {
    capture,
    reconstruction,
    directReconstruction,
    camera,
    projector,
    metrics: {
      rmseDepth: evaluated.rmse,
      directRmseDepth: directReconstruction
        ? depthRmse(directReconstruction, capture.truthDepth).rmse
        : null,
      validCount: reconstruction.validCount,
      cameraHitCount,
      totalCount,
      validRatio: reconstruction.validCount / totalCount,
      occludedCount,
      evaluatedCount: evaluated.count,
    },
  };
}

export function getRig(
  config: WorldConfig,
  width = config.cameraWidth,
  height = cameraHeight(config),
): { camera: Pinhole; projector: Pinhole } {
  validateWorldConfig(config);
  const target = rigTarget(config),
    camera: Vec3 = [config.cameraX, config.cameraY, config.cameraZ],
    projector: Vec3 = [config.projectorX, config.projectorY, config.projectorZ],
    // Image right follows the baseline so fringes vary across it, never along it.
    baseline = projector.map((v, axis) => v - camera[axis]) as Vec3;
  return {
    camera: makePinhole(
      camera,
      target,
      width,
      height,
      config.cameraFov,
      baseline,
    ),
    projector: makePinhole(
      projector,
      target,
      160,
      120,
      config.projectorFov,
      baseline,
    ),
  };
}
