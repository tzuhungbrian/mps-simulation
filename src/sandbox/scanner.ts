import * as THREE from "three";
import {
  makePinhole,
  cameraRay,
  projectPoint,
  triangulateColumn,
  type Pinhole,
} from "./geometry";
import {
  createSeededRandom,
  decodeThreeStep,
  SHIFTS,
  TAU,
  type PhaseResult,
} from "../core/simulation";

export interface WorldConfig {
  shape: "sphere" | "box" | "ramp";
  x: number;
  y: number;
  z: number;
  baseline: number;
  cameraFov: number;
  seed: number;
  noiseSigma: number;
}

export const DEFAULT_WORLD: WorldConfig = {
  shape: "sphere",
  x: 0,
  y: 0.75,
  z: 0,
  baseline: 2,
  cameraFov: 45,
  seed: 42,
  noiseSigma: 0,
};

export function validateWorldConfig(config: WorldConfig): void {
  if (!["sphere", "box", "ramp"].includes(config.shape))
    throw new RangeError("Unknown world shape");
  const limits = {
    x: [-2, 2],
    y: [0.65, 2.5],
    z: [-2, 2],
    baseline: [0.4, 3],
    cameraFov: [30, 75],
    seed: [0, 4294967295],
    noiseSigma: [0, 0.01],
  } as const;
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = config[key];
    const [lo, hi] = limits[key];
    if (
      !Number.isFinite(value) ||
      value < lo ||
      value > hi ||
      (key === "seed" && !Number.isInteger(value))
    )
      throw new RangeError(
        `Invalid ${key}: expected [${lo}, ${hi}]${key === "seed" ? " integer" : ""}`,
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
  for (const key of [
    "x",
    "y",
    "z",
    "baseline",
    "cameraFov",
    "seed",
    "noiseSigma",
  ] as const) {
    if (!Object.hasOwn(record, key) || typeof record[key] !== "number")
      throw new RangeError(`${key} must be a number`);
    result[key] = record[key];
  }
  validateWorldConfig(result);
  return result;
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
  frames: [Float64Array, Float64Array, Float64Array];
  clipped: Uint8Array;
  /** Camera optical-axis depth, evaluation only. Never passed to reconstruction. */
  truthDepth: Float64Array;
  cameraHit: Uint8Array;
  /** Camera hits unilluminated by the projector (occlusion, outside FoV, or back-facing). */
  shadowMask: Uint8Array;
}

const insideProjector = (
  projector: Pinhole,
  p: { u: number; v: number } | null,
): boolean =>
  !!p &&
  p.u >= -0.5 &&
  p.u < projector.width - 0.5 &&
  p.v >= -0.5 &&
  p.v < projector.height - 0.5;

/** CPU float64 point samples on the very same triangle meshes used by the UI. */
export function captureWorld(
  config: WorldConfig,
  width = 96,
  height = 72,
): WorldCaptures {
  const { camera, projector } = getRig(config, width, height);
  const world = createWorld(config);
  const count = width * height;
  const capture: WorldCaptures = {
    width,
    height,
    frames: [
      new Float64Array(count).fill(0.12),
      new Float64Array(count).fill(0.12),
      new Float64Array(count).fill(0.12),
    ],
    clipped: new Uint8Array(count),
    truthDepth: new Float64Array(count).fill(NaN),
    cameraHit: new Uint8Array(count),
    shadowMask: new Uint8Array(count),
  };
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3(...camera.position);
  const projectorOrigin = new THREE.Vector3(...projector.position);
  const direction = new THREE.Vector3();
  const towardProjector = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  try {
    for (let i = 0; i < count; i++) {
      direction.fromArray(cameraRay(camera, i % width, Math.floor(i / width)));
      raycaster.set(origin, direction);
      const hit = raycaster.intersectObjects(world.meshes, false)[0];
      if (!hit || !hit.face) continue;
      const point = hit.point.toArray() as [number, number, number];
      capture.cameraHit[i] = 1;
      capture.truthDepth[i] = projectPoint(camera, point)!.depth;
      capture.shadowMask[i] = 1;
      const pp = projectPoint(projector, point);
      if (!insideProjector(projector, pp)) continue;
      towardProjector.subVectors(projectorOrigin, hit.point);
      const projectorDistance = towardProjector.length();
      towardProjector.normalize();
      normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      normal.copy(hit.face.normal).applyNormalMatrix(normalMatrix);
      const factor = Math.max(0, normal.dot(towardProjector));
      if (factor === 0) continue;
      direction.copy(towardProjector).negate();
      raycaster.set(projectorOrigin, direction);
      const projectorHit = raycaster.intersectObjects(world.meshes, false)[0];
      const tolerance = 1e-6 * Math.max(1, projectorDistance);
      if (
        !projectorHit ||
        Math.abs(projectorHit.distance - projectorDistance) > tolerance
      )
        continue;
      capture.shadowMask[i] = 0;
      const phi = (TAU * (pp!.u + 0.5)) / projector.width - Math.PI;
      for (let k = 0; k < 3; k++)
        capture.frames[k][i] =
          0.12 + 0.4 * factor + 0.36 * factor * Math.cos(phi + SHIFTS[k]);
    }
    const random = createSeededRandom(config.seed);
    const gaussian = () =>
      Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        const value =
          capture.frames[k][i] +
          (config.noiseSigma === 0 ? 0 : config.noiseSigma * gaussian());
        if (value <= 0 || value >= 1) capture.clipped[i] = 1;
        capture.frames[k][i] = Math.max(0, Math.min(1, value));
      }
    }
    return capture;
  } finally {
    world.dispose();
  }
}

export interface WorldReconstruction {
  phase: PhaseResult;
  depth: Float64Array;
  points: Float64Array;
  valid: Uint8Array;
  validCount: number;
}

/** Inverse boundary: only intensities, clipping flags and known calibration enter. */
export function reconstructCaptures(
  captures: Pick<WorldCaptures, "width" | "height" | "frames" | "clipped">,
  camera: Pinhole,
  projector: Pinhole,
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
    frames.some((frame) => frame.length !== count) ||
    clipped.length !== count
  )
    throw new RangeError(
      "Capture dimensions, frame lengths, clipping mask and camera calibration must match",
    );
  const phase = decodeThreeStep(frames, 0.01, clipped);
  const result: WorldReconstruction = {
    phase,
    depth: new Float64Array(count).fill(NaN),
    points: new Float64Array(3 * count).fill(NaN),
    valid: new Uint8Array(count),
    validCount: 0,
  };
  for (let i = 0; i < count; i++) {
    if (!phase.valid[i]) continue;
    const u = (projector.width * (phase.wrapped[i] + Math.PI)) / TAU - 0.5;
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
    result.points.set(point, 3 * i);
    result.valid[i] = 1;
    result.validCount++;
  }
  return result;
}

export function runWorldScan(
  config: WorldConfig,
  width = 96,
  height = 72,
): {
  capture: WorldCaptures;
  reconstruction: WorldReconstruction;
  camera: Pinhole;
  projector: Pinhole;
  metrics: {
    rmseDepth: number | null;
    validCount: number;
    cameraHitCount: number;
    totalCount: number;
    validRatio: number;
    occludedCount: number;
    evaluatedCount: number;
  };
} {
  const { camera, projector } = getRig(config, width, height);
  const capture = captureWorld(config, width, height);
  // Intentionally construct an explicit field-only payload: truth and visibility never cross this boundary.
  const reconstruction = reconstructCaptures(
    { width, height, frames: capture.frames, clipped: capture.clipped },
    camera,
    projector,
  );
  let squaredError = 0,
    evaluatedCount = 0,
    cameraHitCount = 0,
    occludedCount = 0;
  const totalCount = width * height;
  for (let i = 0; i < totalCount; i++) {
    cameraHitCount += capture.cameraHit[i];
    occludedCount += capture.shadowMask[i];
    if (!reconstruction.valid[i] || !Number.isFinite(capture.truthDepth[i]))
      continue;
    squaredError += (reconstruction.depth[i] - capture.truthDepth[i]) ** 2;
    evaluatedCount++;
  }
  return {
    capture,
    reconstruction,
    camera,
    projector,
    metrics: {
      rmseDepth: evaluatedCount
        ? Math.sqrt(squaredError / evaluatedCount)
        : null,
      validCount: reconstruction.validCount,
      cameraHitCount,
      totalCount,
      validRatio: reconstruction.validCount / totalCount,
      occludedCount,
      evaluatedCount,
    },
  };
}

export function getRig(
  config: WorldConfig,
  width = 96,
  height = 72,
): { camera: Pinhole; projector: Pinhole } {
  validateWorldConfig(config);
  return {
    camera: makePinhole(
      [-config.baseline / 2, 1.8, 4],
      [0, 0.4, 0],
      width,
      height,
      config.cameraFov,
    ),
    projector: makePinhole(
      [config.baseline / 2, 2.3, 3.5],
      [0, 0.4, 0],
      160,
      120,
      55,
    ),
  };
}
