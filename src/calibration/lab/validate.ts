import { triangulate, type Intrinsics, type Point2 } from "../camera";
import {
  add3,
  norm3,
  scale3,
  sub3,
  symmetricEigen,
  dot3,
  type Mat,
  type Vec3,
} from "../linalg";
import { BOARD } from "./rig";

export interface ViewCheck {
  /** Mean and standard deviation of adjacent-corner spacing, mm (truth: BOARD.square). */
  spacingMean: number;
  spacingStd: number;
  /** RMS distance of the 54 points to their best-fit plane, mm. */
  flatness: number;
  points: Vec3[];
}

/** Triangulate one view's corners with the estimated calibration and measure the board like a gauge. */
export function checkView(
  camera: Intrinsics,
  projector: Intrinsics,
  R: Mat,
  T: Vec3,
  cam: Point2[],
  proj: (Point2 | null)[],
): ViewCheck | null {
  const pts = cam.map((c, i) =>
    proj[i] ? triangulate(camera, projector, R, T, c, proj[i]!) : null,
  );
  if (pts.some((p) => !p)) return null;
  const P = pts as Vec3[];
  const spacing: number[] = [];
  for (let j = 0; j < BOARD.rows; j++)
    for (let i = 0; i < BOARD.cols; i++) {
      const k = j * BOARD.cols + i;
      if (i + 1 < BOARD.cols) spacing.push(norm3(sub3(P[k + 1], P[k])));
      if (j + 1 < BOARD.rows)
        spacing.push(norm3(sub3(P[k + BOARD.cols], P[k])));
    }
  const mean = spacing.reduce((s, v) => s + v, 0) / spacing.length;
  const std = Math.sqrt(
    spacing.reduce((s, v) => s + (v - mean) ** 2, 0) / spacing.length,
  );
  const c = scale3(
    P.reduce<Vec3>((s, p) => add3(s, p), [0, 0, 0]),
    1 / P.length,
  );
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of P) {
    const d = sub3(p, c);
    for (let r = 0; r < 3; r++)
      for (let q = 0; q < 3; q++) cov[r][q] += d[r] * d[q];
  }
  const n = symmetricEigen(cov).vectors[0];
  const flatness = Math.sqrt(
    P.reduce((s, p) => s + dot3(sub3(p, c), n) ** 2, 0) / P.length,
  );
  return { spacingMean: mean, spacingStd: std, flatness, points: P };
}
