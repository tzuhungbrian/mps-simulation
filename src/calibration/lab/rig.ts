import { composePose, project, type Intrinsics, type Pose } from "../camera";
import { matMul, mul3, rodrigues, sub3, type Vec3 } from "../linalg";
import { aimAtPixel } from "../simulate";

/** Bench camera: 16 mm lens on a 10 µm-pitch 1024×768 sensor, focused at DEFAULT_SETTINGS.focusMm (see cameraAt). */
export const LAB_CAMERA: Intrinsics = {
  width: 1024,
  height: 768,
  fx: 1600,
  fy: 1601,
  cx: 518.5,
  cy: 379.2,
  dist: [-0.11, 0.09, 0.0006, -0.0004, 0],
};
export const LENS = { focalMm: 16, pixelMm: 0.01 };

/** Offset-optics DLP-style projector: principal point near the bottom edge. */
export const LAB_PROJECTOR: Intrinsics = {
  width: 1024,
  height: 768,
  fx: 1450,
  fy: 1450,
  cx: 510,
  cy: 722,
  dist: [-0.04, 0.02, 0, 0, 0],
};

/** Camera → projector, truth (camera frame is the bench reference). */
export const LAB_STEREO: Pose = aimAtPixel(
  [160, -25, 15],
  [0, 0, 520],
  [0, -1, 0],
  LAB_PROJECTOR,
  [512, 384],
);

export const BOARD = {
  cols: 9,
  rows: 6,
  square: 20,
  border: 16,
  white: 0.82,
  black: 0.14,
};
/** Board frame: origin at the first inner corner, x along columns, y along rows, z away from the printed face. */
export const BOARD_SIZE = {
  x0: -BOARD.square - BOARD.border,
  y0: -BOARD.square - BOARD.border,
  x1: BOARD.cols * BOARD.square + BOARD.border,
  y1: BOARD.rows * BOARD.square + BOARD.border,
};
export const BOARD_CENTER: Vec3 = [
  ((BOARD.cols - 1) * BOARD.square) / 2,
  ((BOARD.rows - 1) * BOARD.square) / 2,
  0,
];

export function boardCorners(square = BOARD.square): Vec3[] {
  const out: Vec3[] = [];
  for (let j = 0; j < BOARD.rows; j++)
    for (let i = 0; i < BOARD.cols; i++) out.push([i * square, j * square, 0]);
  return out;
}

/** Board placement as the user edits it: centre in camera frame (mm) and XYZ Euler angles (deg). */
export interface BoardPlacement {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}
export const DEFAULT_PLACEMENT: BoardPlacement = {
  x: 0,
  y: 0,
  z: 520,
  rx: 0,
  ry: 0,
  rz: 0,
};

const rad = (d: number) => (d * Math.PI) / 180;
/** R = Rx · Ry · Rz (three.js "XYZ" order). */
export function placementPose(p: BoardPlacement): Pose {
  const R = matMul(
    matMul(rodrigues([rad(p.rx), 0, 0]), rodrigues([0, rad(p.ry), 0])),
    rodrigues([0, 0, rad(p.rz)]),
  );
  return { R, t: sub3([p.x, p.y, p.z], mul3(R, BOARD_CENTER)) };
}

/** Angle between board normal and the camera's optical axis, degrees. */
export function boardTilt(p: BoardPlacement): number {
  const n = mul3(placementPose(p).R, [0, 0, 1]);
  return (Math.acos(Math.min(1, Math.abs(n[2]))) * 180) / Math.PI;
}

export interface CaptureSettings {
  exposureMs: number;
  fNumber: number;
  focusMm: number;
  /** Read noise, DN (8-bit). */
  noiseDN: number;
  /** Room light relative to the projector's full white. */
  ambient: number;
}
export const DEFAULT_SETTINGS: CaptureSettings = {
  exposureMs: 12,
  fNumber: 4,
  focusMm: 520,
  noiseDN: 1.5,
  ambient: 0.08,
};

/** Thin-lens lens-to-sensor distance when focused at d mm. */
const imageDistance = (d: number) => (LENS.focalMm * d) / (d - LENS.focalMm);

/** Focus breathing: refocusing moves the lens, so fx and fy scale with the image distance. */
export function cameraAt(focusMm: number): Intrinsics {
  const s = imageDistance(focusMm) / imageDistance(DEFAULT_SETTINGS.focusMm);
  return { ...LAB_CAMERA, fx: LAB_CAMERA.fx * s, fy: LAB_CAMERA.fy * s };
}

/** Thin-lens blur σ in camera pixels for an object at depth z. */
export function defocusSigma(s: CaptureSettings, z: number): number {
  const f = LENS.focalMm;
  const c =
    ((f * f) / (s.fNumber * (s.focusMm - f))) * (Math.abs(z - s.focusMm) / z);
  return c / LENS.pixelMm / 4;
}

/** DN produced by unit radiance (white paper under full projector light). */
export function exposureGain(s: CaptureSettings): number {
  return 255 * 0.95 * (s.exposureMs / 12) * (4 / s.fNumber) ** 2;
}

/** Pixel positions of the inner corners in camera and projector, truth (for the lab assistant only). */
export function truthProjections(
  p: BoardPlacement,
  focusMm = DEFAULT_SETTINGS.focusMm,
) {
  const pose = placementPose(p);
  const pts = boardCorners();
  const camera = cameraAt(focusMm);
  return {
    camera: pts.map((X) => project(camera, pose, X)),
    projector: pts.map((X) =>
      project(LAB_PROJECTOR, composePose(LAB_STEREO, pose), X),
    ),
  };
}

export const FRINGE = {
  /** Periods across the projector image, coarse → fine (temporal unwrapping). */
  frequencies: [1, 4, 16],
  steps: 4,
};
