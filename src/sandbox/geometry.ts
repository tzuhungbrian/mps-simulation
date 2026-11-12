export type Vec3 = [number, number, number];

export interface Pinhole {
  position: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

export const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const scale = (a: Vec3, s: number): Vec3 => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];
const finite = (v: Vec3) => v.every(Number.isFinite);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  if (!Number.isFinite(length) || length < 1e-12)
    throw new RangeError("Degenerate direction");
  return scale(v, 1 / length);
};

export function makePinhole(
  position: Vec3,
  target: Vec3,
  width: number,
  height: number,
  fovYDegrees: number,
  /** Preferred image-right direction; its component ⊥ forward is used when non-degenerate. */
  rightHint?: Vec3,
): Pinhole {
  if (
    !finite(position) ||
    !finite(target) ||
    (rightHint && !finite(rightHint)) ||
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(height) ||
    height < 1 ||
    !Number.isFinite(fovYDegrees) ||
    fovYDegrees <= 0 ||
    fovYDegrees >= 180
  )
    throw new RangeError("Invalid pinhole parameters");
  const forward = normalize(sub(target, position));
  let right: Vec3 | null = null;
  if (rightHint) {
    const along = sub(rightHint, scale(forward, dot(rightHint, forward)));
    if (Math.hypot(...along) > 1e-6 * Math.hypot(...rightHint))
      right = normalize(along);
  }
  if (!right) {
    let reference: Vec3 = [0, 1, 0];
    // Looking straight up/down: world Y cannot define image right, so use -Z.
    if (Math.hypot(...cross(forward, reference)) < 1e-6) reference = [0, 0, -1];
    right = normalize(cross(forward, reference));
  }
  const up = cross(right, forward);
  const fy = height / (2 * Math.tan((fovYDegrees * Math.PI) / 360));
  return {
    position: [...position],
    forward,
    right,
    up,
    width,
    height,
    fx: fy,
    fy,
    cx: (width - 1) / 2,
    cy: (height - 1) / 2,
  };
}

/** Image y points down; integer x/y locate pixel centers. */
export function cameraRay(camera: Pinhole, x: number, y: number): Vec3 {
  return normalize(
    add(
      camera.forward,
      add(
        scale(camera.right, (x - camera.cx) / camera.fx),
        scale(camera.up, -(y - camera.cy) / camera.fy),
      ),
    ),
  );
}

/** Intersect a camera ray with the calibrated projector column plane. */
export function triangulateColumn(
  camera: Pinhole,
  projector: Pinhole,
  x: number,
  y: number,
  projectorU: number,
): Vec3 | null {
  if (
    ![x, y, projectorU, projector.fx].every(Number.isFinite) ||
    projector.fx <= 0
  )
    return null;
  let ray: Vec3;
  try {
    ray = cameraRay(camera, x, y);
  } catch {
    return null;
  }
  const n = sub(
    projector.right,
    scale(projector.forward, (projectorU - projector.cx) / projector.fx),
  );
  const denominator = dot(n, ray);
  if (
    !Number.isFinite(denominator) ||
    Math.abs(denominator) < 1e-12 * Math.hypot(...n)
  )
    return null;
  const distance =
    dot(n, sub(projector.position, camera.position)) / denominator;
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const point = add(camera.position, scale(ray, distance));
  return projectPoint(camera, point) && projectPoint(projector, point)
    ? point
    : null;
}

/** depth is optical-axis Z, not Euclidean range. */
export function projectPoint(
  camera: Pinhole,
  point: Vec3,
): { u: number; v: number; depth: number } | null {
  if (
    !finite(point) ||
    !finite(camera.position) ||
    camera.fx <= 0 ||
    camera.fy <= 0
  )
    return null;
  const offset = sub(point, camera.position);
  const depth = dot(offset, camera.forward);
  const u = camera.cx + (camera.fx * dot(offset, camera.right)) / depth;
  const v = camera.cy - (camera.fy * dot(offset, camera.up)) / depth;
  return depth > 0 && [depth, u, v].every(Number.isFinite)
    ? { u, v, depth }
    : null;
}
