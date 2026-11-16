import type { Distortion, Intrinsics, Point2, Pose } from "../camera";
import { rodrigues, type Vec3 } from "../linalg";

// opencv.js ships partial typings without calibrateCameraExtended; use a loose handle.
export type CV = any;

let loading: Promise<CV> | null = null;
/** Load OpenCV.js (WASM, ~13 MB) once in the browser; tests pass a Node-required cv instead. */
export function loadOpenCV(): Promise<CV> {
  loading ??= (async () => {
    // The UMD bundle's CommonJS export is a thenable that breaks ESM interop, so run it as a
    // classic script: it then publishes `globalThis.cv` (a promise of the namespace).
    const { default: url } =
      await import("@techstark/opencv-js/dist/opencv.js?url");
    const source = await (await fetch(url)).text();
    (0, eval)(source);
    const cv = (await (globalThis as unknown as { cv: unknown }).cv) as CV;
    if (!cv.Mat) await new Promise<void>((r) => (cv.onRuntimeInitialized = r));
    return cv;
  })();
  return loading;
}

export interface CvCalibration {
  K: Intrinsics;
  rms: number;
  perViewErrors: number[];
  /** Board → device per view. */
  poses: Pose[];
  stdIntrinsics: number[];
}

export const CALIB_FLAGS = [
  "CALIB_FIX_K3",
  "CALIB_ZERO_TANGENT_DIST",
  "CALIB_FIX_PRINCIPAL_POINT",
  "CALIB_FIX_ASPECT_RATIO",
] as const;
export type CalibFlag = (typeof CALIB_FLAGS)[number];

/** cv.calibrateCameraExtended — the real OpenCV calibrateCamera. */
export function calibrateCameraCV(
  cv: CV,
  objectPoints: Vec3[],
  imagePoints: Point2[][],
  width: number,
  height: number,
  flags: CalibFlag[],
): CvCalibration {
  const objs = new cv.MatVector(),
    imgs = new cv.MatVector();
  const mats: CV[] = [];
  for (const view of imagePoints) {
    const o = cv.matFromArray(
      objectPoints.length,
      1,
      cv.CV_32FC3,
      objectPoints.flat(),
    );
    const i = cv.matFromArray(view.length, 1, cv.CV_32FC2, view.flat());
    objs.push_back(o);
    imgs.push_back(i);
    mats.push(o, i);
  }
  const K = new cv.Mat(),
    dist = new cv.Mat(),
    rvecs = new cv.MatVector(),
    tvecs = new cv.MatVector(),
    stdInt = new cv.Mat(),
    stdExt = new cv.Mat(),
    perView = new cv.Mat();
  const flagValue = flags.reduce((s, f) => s | cv[f], 0);
  try {
    const rms = cv.calibrateCameraExtended(
      objs,
      imgs,
      new cv.Size(width, height),
      K,
      dist,
      rvecs,
      tvecs,
      stdInt,
      stdExt,
      perView,
      flagValue,
      new cv.TermCriteria(
        cv.TermCriteria_COUNT + cv.TermCriteria_EPS,
        100,
        1e-12,
      ),
    );
    const k = Array.from(K.data64F as Float64Array);
    const d = Array.from(dist.data64F as Float64Array);
    const poses: Pose[] = [];
    for (let v = 0; v < rvecs.size(); v++) {
      const r = rvecs.get(v),
        t = tvecs.get(v);
      poses.push({
        R: rodrigues(Array.from(r.data64F as Float64Array)),
        t: Array.from(t.data64F as Float64Array) as Vec3,
      });
      r.delete();
      t.delete();
    }
    return {
      K: {
        width,
        height,
        fx: k[0],
        fy: k[4],
        cx: k[2],
        cy: k[5],
        dist: [
          d[0] ?? 0,
          d[1] ?? 0,
          d[2] ?? 0,
          d[3] ?? 0,
          d[4] ?? 0,
        ] as Distortion,
      },
      rms,
      perViewErrors: Array.from(perView.data64F as Float64Array),
      poses,
      stdIntrinsics: Array.from(stdInt.data64F as Float64Array).slice(0, 9),
    };
  } finally {
    for (const m of [
      ...mats,
      objs,
      imgs,
      K,
      dist,
      rvecs,
      tvecs,
      stdInt,
      stdExt,
      perView,
    ])
      m.delete();
  }
}

/** cv.remap with bilinear interpolation: sample a float image at sub-pixel points (NaN propagates). */
export function remapAt(
  cv: CV,
  image: Float32Array,
  width: number,
  height: number,
  points: Point2[],
): number[] {
  const src = cv.matFromArray(height, width, cv.CV_32FC1, image);
  const mx = cv.matFromArray(
    points.length,
    1,
    cv.CV_32FC1,
    points.map((p) => p[0]),
  );
  const my = cv.matFromArray(
    points.length,
    1,
    cv.CV_32FC1,
    points.map((p) => p[1]),
  );
  const dst = new cv.Mat();
  try {
    cv.remap(
      src,
      dst,
      mx,
      my,
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(NaN),
    );
    return Array.from(dst.data32F as Float32Array);
  } finally {
    for (const m of [src, mx, my, dst]) m.delete();
  }
}

/** cv.projectPoints for one view. */
export function projectPointsCV(
  cv: CV,
  objectPoints: Vec3[],
  pose: Pose,
  K: Intrinsics,
): Point2[] {
  const obj = cv.matFromArray(
    objectPoints.length,
    1,
    cv.CV_64FC3,
    objectPoints.flat(),
  );
  const R = cv.matFromArray(3, 3, cv.CV_64F, pose.R.flat());
  const rvec = new cv.Mat();
  const tvec = cv.matFromArray(3, 1, cv.CV_64F, [...pose.t]);
  const Km = cv.matFromArray(3, 3, cv.CV_64F, [
    K.fx,
    0,
    K.cx,
    0,
    K.fy,
    K.cy,
    0,
    0,
    1,
  ]);
  const dist = cv.matFromArray(1, 5, cv.CV_64F, [...K.dist]);
  const out = new cv.Mat();
  try {
    cv.Rodrigues(R, rvec);
    cv.projectPoints(obj, rvec, tvec, Km, dist, out);
    const d = Array.from(out.data64F as Float64Array);
    return objectPoints.map((_, i): Point2 => [d[2 * i], d[2 * i + 1]]);
  } finally {
    for (const m of [obj, R, rvec, tvec, Km, dist, out]) m.delete();
  }
}
