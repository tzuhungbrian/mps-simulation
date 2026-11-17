import { t } from "../i18n";
import {
  add3,
  cross3,
  dot3,
  gaussian,
  invert3,
  matMul,
  mul3,
  nearestRotation,
  norm3,
  nullVector,
  rodrigues,
  rotationAngleDeg,
  rotationToVector,
  scale3,
  sub3,
  transpose,
  type Mat,
  type Vec3,
} from "./linalg";
import { levenbergMarquardt } from "./lm";

export type Point2 = [number, number];
/** OpenCV order: k1, k2, p1, p2, k3. */
export type Distortion = [number, number, number, number, number];
export interface Intrinsics {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  dist: Distortion;
}
/** X_device = R · X_ref + t (OpenCV rvec/tvec convention). */
export interface Pose {
  R: Mat;
  t: Vec3;
}

export const NO_DISTORTION: Distortion = [0, 0, 0, 0, 0];

export function distort(x: number, y: number, d: Distortion): Point2 {
  const [k1, k2, p1, p2, k3] = d;
  const r2 = x * x + y * y;
  const radial = 1 + r2 * (k1 + r2 * (k2 + r2 * k3));
  return [
    x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x),
    y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y,
  ];
}

/** Pixel of a reference-frame point, or null behind the device. */
export function project(K: Intrinsics, pose: Pose, X: Vec3): Point2 | null {
  const c = add3(mul3(pose.R, X), pose.t);
  if (!(c[2] > 1e-9)) return null;
  const [xd, yd] = distort(c[0] / c[2], c[1] / c[2], K.dist);
  return [K.fx * xd + K.cx, K.fy * yd + K.cy];
}

/** Pixel → undistorted normalized coordinates (fixed-point iteration, like cv.undistortPoints). */
export function undistortPixel(K: Intrinsics, [u, v]: Point2): Point2 {
  const xd = (u - K.cx) / K.fx,
    yd = (v - K.cy) / K.fy;
  const [k1, k2, p1, p2, k3] = K.dist;
  let x = xd,
    y = yd;
  for (let i = 0; i < 30; i++) {
    const r2 = x * x + y * y;
    const radial = 1 + r2 * (k1 + r2 * (k2 + r2 * k3));
    const dx = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const dy = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    x = (xd - dx) / radial;
    y = (yd - dy) / radial;
  }
  return [x, y];
}

export const invertPose = (p: Pose): Pose => {
  const Rt = transpose(p.R);
  return { R: Rt, t: scale3(mul3(Rt, p.t), -1) };
};
/** Device centre in the reference frame: C = −Rᵀ t. */
export const poseCenter = (p: Pose): Vec3 => invertPose(p).t;
/** a ∘ b: first b, then a. */
export const composePose = (a: Pose, b: Pose): Pose => ({
  R: matMul(a.R, b.R),
  t: add3(mul3(a.R, b.t), a.t),
});
export const applyPose = (p: Pose, X: Vec3): Vec3 => add3(mul3(p.R, X), p.t);

/** Normalized DLT homography mapping src → dst. */
export function findHomography(src: Point2[], dst: Point2[]): Mat | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  const normalizer = (pts: Point2[]): Mat => {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length,
      my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const md =
      pts.reduce((s, p) => s + Math.hypot(p[0] - mx, p[1] - my), 0) /
      pts.length;
    const s = md > 0 ? Math.SQRT2 / md : 1;
    return [
      [s, 0, -s * mx],
      [0, s, -s * my],
      [0, 0, 1],
    ];
  };
  const Ts = normalizer(src),
    Td = normalizer(dst);
  const rows: number[][] = [];
  src.forEach((p, i) => {
    const [x, y] = mul3(Ts, [p[0], p[1], 1]);
    const [u, v] = mul3(Td, [dst[i][0], dst[i][1], 1]);
    rows.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    rows.push([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  });
  const h = nullVector(rows);
  const Hn: Mat = [h.slice(0, 3), h.slice(3, 6), h.slice(6, 9)];
  const TdInv = invert3(Td);
  if (!TdInv) return null;
  const H = matMul(matMul(TdInv, Hn), Ts);
  const s = H[2][2];
  return Math.abs(s) > 1e-15 ? H.map((r) => r.map((v) => v / s)) : H;
}

/** Zhang's closed form with zero skew; null when the views do not constrain K. */
export function zhangIntrinsics(
  homographies: Mat[],
  width: number,
  height: number,
): { fx: number; fy: number; cx: number; cy: number } | null {
  // Work in a pixel frame scaled to ~[-1, 1] so B is well conditioned.
  const s = 2 / (width + height);
  const N: Mat = [
    [s, 0, -s * (width - 1) * 0.5],
    [0, s, -s * (height - 1) * 0.5],
    [0, 0, 1],
  ];
  const rows: number[][] = [];
  for (const raw of homographies) {
    const H = matMul(N, raw);
    const col = (j: number) => [H[0][j], H[1][j], H[2][j]];
    // b = [B11, B22, B13, B23, B33]; B12 = 0 under zero skew.
    const v = (i: number, j: number) => {
      const a = col(i),
        b = col(j);
      return [
        a[0] * b[0],
        a[1] * b[1],
        a[2] * b[0] + a[0] * b[2],
        a[2] * b[1] + a[1] * b[2],
        a[2] * b[2],
      ];
    };
    const v01 = v(0, 1),
      v00 = v(0, 0),
      v11 = v(1, 1);
    for (const r of [v01, v00.map((x, k) => x - v11[k])]) {
      const n = Math.hypot(...r);
      if (n > 0) rows.push(r.map((x) => x / n));
    }
  }
  if (rows.length < 4) return null;
  let [B11, B22, B13, B23, B33] = nullVector(rows);
  if (B11 < 0) [B11, B22, B13, B23, B33] = [-B11, -B22, -B13, -B23, -B33];
  const v0 = -B23 / B22;
  const lambda = B33 - (B13 * B13 - v0 * B11 * B23) / B11;
  const alpha = Math.sqrt(lambda / B11),
    beta = Math.sqrt(lambda / B22);
  const u0 = (-B13 * alpha * alpha) / lambda;
  if (![alpha, beta, u0, v0].every(Number.isFinite) || alpha <= 0 || beta <= 0)
    return null;
  return {
    fx: alpha / s,
    fy: beta / s,
    cx: u0 / s + (width - 1) * 0.5,
    cy: v0 / s + (height - 1) * 0.5,
  };
}

/** Pose of the plane z=0 from H = K[r1 r2 t] (homography in pixels). */
export function poseFromHomography(K: Intrinsics, H: Mat): Pose | null {
  const Kinv = invert3([
    [K.fx, 0, K.cx],
    [0, K.fy, K.cy],
    [0, 0, 1],
  ]);
  if (!Kinv) return null;
  const M = matMul(Kinv, H);
  const h1: Vec3 = [M[0][0], M[1][0], M[2][0]],
    h2: Vec3 = [M[0][1], M[1][1], M[2][1]],
    h3: Vec3 = [M[0][2], M[1][2], M[2][2]];
  let lambda = 2 / (norm3(h1) + norm3(h2));
  if (h3[2] * lambda < 0) lambda = -lambda;
  const r1 = scale3(h1, lambda),
    r2 = scale3(h2, lambda),
    r3 = cross3(r1, r2);
  const R = nearestRotation([
    [r1[0], r2[0], r3[0]],
    [r1[1], r2[1], r3[1]],
    [r1[2], r2[2], r3[2]],
  ]);
  const t = scale3(h3, lambda);
  return [...t, ...R.flat()].every(Number.isFinite) ? { R, t } : null;
}

const poseParams = (p: Pose) => [...rotationToVector(p.R), ...p.t];
const paramsPose = (q: readonly number[], o: number): Pose => ({
  R: rodrigues([q[o], q[o + 1], q[o + 2]]),
  t: [q[o + 3], q[o + 4], q[o + 5]],
});

function reprojectionInto(
  out: Float64Array,
  offset: number,
  K: Intrinsics,
  pose: Pose,
  obj: readonly Vec3[],
  img: readonly Point2[],
) {
  obj.forEach((X, k) => {
    const p = project(K, pose, X);
    out[offset + 2 * k] = p ? p[0] - img[k][0] : 1e3;
    out[offset + 2 * k + 1] = p ? p[1] - img[k][1] : 1e3;
  });
}

const rmsOf = (r: Float64Array, start = 0, end = r.length) => {
  let s = 0;
  for (let i = start; i < end; i++) s += r[i] * r[i];
  return Math.sqrt(s / ((end - start) / 2));
};

export type CalibrationResult =
  | {
      ok: true;
      K: Intrinsics;
      /** Board → device pose per view (rvecs / tvecs). */
      poses: Pose[];
      /** Overall RMS reprojection error, px (what cv.calibrateCamera returns). */
      rms: number;
      perViewRms: number[];
      /** Zhang closed-form before non-linear refinement. */
      initial: { fx: number; fy: number; cx: number; cy: number };
      iterations: number;
    }
  | { ok: false; reason: string };

/** Planar-target calibration in the spirit of cv.calibrateCamera (k3 fixed to 0). */
export function calibrateCamera(
  objectPoints: readonly Vec3[],
  imagePoints: readonly Point2[][],
  width: number,
  height: number,
  options: { estimateDistortion: boolean } = { estimateDistortion: true },
): CalibrationResult {
  if (imagePoints.length < 2)
    return {
      ok: false,
      reason: t("至少需要 2 個姿態", "At least 2 poses are required"),
    };
  const plane = objectPoints.map((p): Point2 => [p[0], p[1]]);
  const Hs: Mat[] = [];
  for (const img of imagePoints) {
    const H = findHomography(plane, [...img]);
    if (!H)
      return {
        ok: false,
        reason: t("Homography 無法估計", "Could not estimate the homography"),
      };
    Hs.push(H);
  }
  const initial = zhangIntrinsics(Hs, width, height);
  if (!initial)
    return {
      ok: false,
      reason: t(
        "Zhang 初始化無解：姿態太少，或所有校正板都幾乎正對相機（傾角不足時焦距與距離分不開）",
        "Zhang initialization has no solution: too few poses, or every calibration board almost faces the camera (without enough tilt, focal length and distance can't be separated)",
      ),
    };
  const K0: Intrinsics = {
    width,
    height,
    ...initial,
    dist: [...NO_DISTORTION],
  };
  const poses0: Pose[] = [];
  for (const H of Hs) {
    const p = poseFromHomography(K0, H);
    if (!p)
      return {
        ok: false,
        reason: t("外參初始化失敗", "Extrinsics initialization failed"),
      };
    poses0.push(p);
  }
  const nIntr = options.estimateDistortion ? 8 : 4;
  const nPts = objectPoints.length;
  const unpackK = (q: readonly number[]): Intrinsics => ({
    width,
    height,
    fx: q[0],
    fy: q[1],
    cx: q[2],
    cy: q[3],
    dist: options.estimateDistortion
      ? [q[4], q[5], q[6], q[7], 0]
      : [...NO_DISTORTION],
  });
  const residuals = (q: readonly number[]) => {
    const K = unpackK(q);
    const out = new Float64Array(imagePoints.length * nPts * 2);
    imagePoints.forEach((img, v) =>
      reprojectionInto(
        out,
        v * nPts * 2,
        K,
        paramsPose(q, nIntr + 6 * v),
        objectPoints,
        img,
      ),
    );
    return out;
  };
  const start = [
    initial.fx,
    initial.fy,
    initial.cx,
    initial.cy,
    ...(options.estimateDistortion ? [0, 0, 0, 0] : []),
    ...poses0.flatMap(poseParams),
  ];
  const fit = levenbergMarquardt(
    {
      residuals,
      localResiduals: (q, i) => {
        if (i < nIntr) return null;
        const v = Math.floor((i - nIntr) / 6);
        const values = new Float64Array(nPts * 2);
        reprojectionInto(
          values,
          0,
          unpackK(q),
          paramsPose(q, nIntr + 6 * v),
          objectPoints,
          imagePoints[v],
        );
        return { start: v * nPts * 2, values };
      },
    },
    start,
  );
  const r = residuals(fit.params);
  const K = unpackK(fit.params);
  if (!(K.fx > 0 && K.fy > 0))
    return {
      ok: false,
      reason: t(
        "最佳化發散：焦距變成非正值",
        "Optimization diverged: the focal length became non-positive",
      ),
    };
  return {
    ok: true,
    K,
    poses: imagePoints.map((_, v) => paramsPose(fit.params, nIntr + 6 * v)),
    rms: rmsOf(r),
    perViewRms: imagePoints.map((_, v) =>
      rmsOf(r, v * nPts * 2, (v + 1) * nPts * 2),
    ),
    initial,
    iterations: fit.iterations,
  };
}

/** Planar cv.solvePnP: pose of the target (z=0) for a calibrated device. */
export function solvePnP(
  objectPoints: readonly Vec3[],
  imagePoints: readonly Point2[],
  K: Intrinsics,
): { pose: Pose; rms: number } | null {
  const ideal: Intrinsics = {
    ...K,
    fx: 1,
    fy: 1,
    cx: 0,
    cy: 0,
    dist: [...NO_DISTORTION],
  };
  const H = findHomography(
    objectPoints.map((p): Point2 => [p[0], p[1]]),
    imagePoints.map((p) => undistortPixel(K, p)),
  );
  const init = H && poseFromHomography(ideal, H);
  if (!init) return null;
  const residuals = (q: readonly number[]) => {
    const out = new Float64Array(objectPoints.length * 2);
    reprojectionInto(out, 0, K, paramsPose(q, 0), objectPoints, imagePoints);
    return out;
  };
  const fit = levenbergMarquardt({ residuals }, poseParams(init));
  return { pose: paramsPose(fit.params, 0), rms: rmsOf(residuals(fit.params)) };
}

export type StereoResult =
  | {
      ok: true;
      /** Camera → projector: X_p = R X_c + T (cv.stereoCalibrate). */
      R: Mat;
      T: Vec3;
      rms: number;
      /** Per-view R_i, T_i before the joint refinement. */
      perView: Pose[];
      spreadDeg: number;
      spreadMm: number;
    }
  | { ok: false; reason: string };

/** cv.stereoCalibrate with CALIB_FIX_INTRINSIC. */
export function stereoCalibrate(
  objectPoints: readonly Vec3[],
  pointsA: readonly Point2[][],
  pointsB: readonly Point2[][],
  KA: Intrinsics,
  KB: Intrinsics,
): StereoResult {
  const views = pointsA.length;
  if (views < 1 || views !== pointsB.length)
    return {
      ok: false,
      reason: t(
        "兩台裝置的姿態數不同",
        "The two devices have different numbers of poses",
      ),
    };
  const perView: Pose[] = [];
  const posesA: Pose[] = [];
  for (let v = 0; v < views; v++) {
    const a = solvePnP(objectPoints, pointsA[v], KA),
      b = solvePnP(objectPoints, pointsB[v], KB);
    if (!a || !b)
      return {
        ok: false,
        reason: t(
          `第 ${v + 1} 個姿態 solvePnP 失敗`,
          `solvePnP failed for pose ${v + 1}`,
        ),
      };
    posesA.push(a.pose);
    perView.push(composePose(b.pose, invertPose(a.pose)));
  }
  const sum = perView.reduce<Mat>(
    (s, p) => s.map((row, i) => row.map((x, j) => x + p.R[i][j])),
    [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  );
  const R0 = nearestRotation(sum);
  const T0 = scale3(
    perView.reduce<Vec3>((s, p) => add3(s, p.t), [0, 0, 0]),
    1 / views,
  );
  const nPts = objectPoints.length;
  const block = nPts * 4;
  const viewResiduals = (
    q: readonly number[],
    v: number,
    out: Float64Array,
    offset: number,
  ) => {
    const rel = paramsPose(q, 0);
    const a = paramsPose(q, 6 + 6 * v);
    reprojectionInto(out, offset, KA, a, objectPoints, pointsA[v]);
    reprojectionInto(
      out,
      offset + nPts * 2,
      KB,
      composePose(rel, a),
      objectPoints,
      pointsB[v],
    );
  };
  const residuals = (q: readonly number[]) => {
    const out = new Float64Array(views * block);
    for (let v = 0; v < views; v++) viewResiduals(q, v, out, v * block);
    return out;
  };
  const fit = levenbergMarquardt(
    {
      residuals,
      localResiduals: (q, i) => {
        if (i < 6) return null;
        const v = Math.floor((i - 6) / 6);
        const values = new Float64Array(block);
        viewResiduals(q, v, values, 0);
        return { start: v * block, values };
      },
    },
    [...poseParams({ R: R0, t: T0 }), ...posesA.flatMap(poseParams)],
  );
  const rel = paramsPose(fit.params, 0);
  const meanT = T0;
  return {
    ok: true,
    R: rel.R,
    T: rel.t,
    rms: rmsOf(residuals(fit.params)),
    perView,
    spreadDeg: Math.max(...perView.map((p) => rotationAngleDeg(p.R, R0))),
    spreadMm: Math.sqrt(
      perView.reduce((s, p) => {
        const d = sub3(p.t, meanT);
        return s + dot3(d, d);
      }, 0) / views,
    ),
  };
}

/** Linear triangulation (cv.triangulatePoints on undistorted points); result in A's frame. */
export function triangulate(
  KA: Intrinsics,
  KB: Intrinsics,
  R: Mat,
  T: Vec3,
  pa: Point2,
  pb: Point2,
): Vec3 | null {
  const [xa, ya] = undistortPixel(KA, pa),
    [xb, yb] = undistortPixel(KB, pb);
  const P2 = R.map((row, i) => [...row, T[i]]);
  const rows = [
    [-1, 0, xa, 0],
    [0, -1, ya, 0],
    P2[2].map((v, k) => xb * v - P2[0][k]),
    P2[2].map((v, k) => yb * v - P2[1][k]),
  ];
  const X = nullVector(rows);
  if (Math.abs(X[3]) < 1e-12) return null;
  const p: Vec3 = [X[0] / X[3], X[1] / X[3], X[2] / X[3]];
  return p[2] > 0 ? p : null;
}

export const noisy = (
  p: Point2,
  sigma: number,
  random: () => number,
): Point2 =>
  sigma > 0
    ? [p[0] + sigma * gaussian(random), p[1] + sigma * gaussian(random)]
    : [p[0], p[1]];
