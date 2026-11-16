import { createSeededRandom } from "../core/simulation";
import {
  calibrateCamera,
  composePose,
  invertPose,
  applyPose,
  noisy,
  poseCenter,
  project,
  solvePnP,
  stereoCalibrate,
  triangulate,
  undistortPixel,
  type CalibrationResult,
  type Intrinsics,
  type Point2,
  type Pose,
  type StereoResult,
} from "./camera";
import {
  add3,
  cross3,
  dot3,
  gaussian,
  identity3,
  matMul,
  mul3,
  norm3,
  normalize3,
  rigidTransform,
  rodrigues,
  rotationAngleDeg,
  scale3,
  sub3,
  symmetricEigen,
  type Mat,
  type Vec3,
} from "./linalg";

export const BOARD_COLS = 9;
export const BOARD_ROWS = 6;
export const TRUE_SQUARE_MM = 20;

/** Inner corners in OpenCV np.mgrid order (x fastest), board frame z = 0. */
export function boardPoints(square: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let j = 0; j < BOARD_ROWS; j++)
    for (let i = 0; i < BOARD_COLS; i++) pts.push([i * square, j * square, 0]);
  return pts;
}
const BOARD_CENTER: Vec3 = [
  ((BOARD_COLS - 1) * TRUE_SQUARE_MM) / 2,
  ((BOARD_ROWS - 1) * TRUE_SQUARE_MM) / 2,
  0,
];

export const TRUE_CAMERA: Intrinsics = {
  width: 1280,
  height: 1024,
  fx: 1450,
  fy: 1452,
  cx: 652,
  cy: 498,
  dist: [-0.12, 0.06, 0.0008, -0.0006, 0],
};
/** Offset-optics projector: principal point near the bottom edge, as in most DLP units. */
export const TRUE_PROJECTOR: Intrinsics = {
  width: 1024,
  height: 768,
  fx: 1700,
  fy: 1700,
  cx: 508,
  cy: 740,
  dist: [-0.03, 0.01, 0, 0, 0],
};

/** World→device pose at centre C looking at target; `up` is the world direction shown as image-up. */
export function lookAt(C: Vec3, target: Vec3, up: Vec3): Pose {
  const z = normalize3(sub3(target, C));
  const x = normalize3(cross3(z, up));
  const y = cross3(z, x);
  const R: Mat = [x, y, z];
  return { R, t: scale3(mul3(R, C), -1) };
}

/** Like lookAt, but the target lands on `pixel` instead of the principal point. */
export function aimAtPixel(
  C: Vec3,
  target: Vec3,
  up: Vec3,
  K: Intrinsics,
  pixel: Point2,
): Pose {
  const base = lookAt(C, target, up);
  const o = normalize3([(pixel[0] - K.cx) / K.fx, (pixel[1] - K.cy) / K.fy, 1]);
  const axis: Vec3 = [-o[1], o[0], 0];
  const s = norm3(axis);
  const Q =
    s < 1e-12 ? identity3() : rodrigues(scale3(axis, Math.atan2(s, o[2]) / s));
  const R = matMul(Q, base.R);
  return { R, t: scale3(mul3(R, C), -1) };
}

const inside = (K: Intrinsics, p: Point2 | null, margin: number) =>
  !!p &&
  p[0] >= margin &&
  p[1] >= margin &&
  p[0] <= K.width - 1 - margin &&
  p[1] <= K.height - 1 - margin;

/** Camera → projector for the calibration bench (camera frame = reference). */
export const TRUE_STEREO: Pose = aimAtPixel(
  [170, -20, 10],
  [0, 0, 470],
  [0, -1, 0],
  TRUE_PROJECTOR,
  [512, 384],
);

// ---------------------------------------------------------------- Lab A / B

export interface CalibrationLabConfig {
  views: number;
  /** Largest board tilt from facing the camera, degrees. */
  maxTilt: number;
  /** Corner detection noise, camera px. */
  cornerNoise: number;
  /** True radial k1 of the camera lens. */
  k1: number;
  estimateDistortion: boolean;
  /** Square size typed into the calibration script, mm (truth is 20 mm). */
  declaredSquare: number;
  /** Projector correspondence noise (from phase noise), projector px. */
  projectorNoise: number;
  seed: number;
}

export const DEFAULT_LAB: CalibrationLabConfig = {
  views: 12,
  maxTilt: 35,
  cornerNoise: 0.2,
  k1: -0.12,
  estimateDistortion: true,
  declaredSquare: 20,
  projectorNoise: 0.15,
  seed: 7,
};

function boardPoses(
  count: number,
  maxTilt: number,
  random: () => number,
  camera: Intrinsics,
): Pose[] {
  const truthPts = boardPoints(TRUE_SQUARE_MM);
  const poses: Pose[] = [];
  for (let v = 0; v < count; v++) {
    let pose: Pose | null = null;
    for (let attempt = 0; attempt < 300 && !pose; attempt++) {
      const center: Vec3 = [
        (random() * 2 - 1) * 70,
        (random() * 2 - 1) * 50,
        400 + random() * 120,
      ];
      const tilt = ((0.45 + 0.55 * random()) * maxTilt * Math.PI) / 180;
      const psi = random() * 2 * Math.PI;
      const roll = ((random() * 2 - 1) * 15 * Math.PI) / 180;
      const R = matMul(
        rodrigues([Math.cos(psi) * tilt, Math.sin(psi) * tilt, 0]),
        rodrigues([0, 0, roll]),
      );
      const candidate: Pose = { R, t: sub3(center, mul3(R, BOARD_CENTER)) };
      const ok = truthPts.every(
        (X) =>
          inside(camera, project(camera, candidate, X), 20) &&
          inside(
            TRUE_PROJECTOR,
            project(TRUE_PROJECTOR, composePose(TRUE_STEREO, candidate), X),
            10,
          ),
      );
      if (ok) pose = candidate;
    }
    if (!pose) throw new Error("Could not place a visible calibration board");
    poses.push(pose);
  }
  return poses;
}

export interface CalibrationLab {
  config: CalibrationLabConfig;
  trueCamera: Intrinsics;
  /** Board → camera, truth. */
  truePoses: Pose[];
  /** Object points as declared by the user (square size may be wrong). */
  objectPoints: Vec3[];
  cameraObs: Point2[][];
  projectorObs: Point2[][];
  camera: CalibrationResult;
  projector: CalibrationResult;
  stereo: StereoResult | null;
  scan: ScanTest | null;
}

export interface ScanTest {
  truth: Vec3[];
  estimated: (Vec3 | null)[];
  ideal: (Vec3 | null)[];
  rmsEstimated: number;
  rmsIdeal: number;
  meanEstimated: number;
  /** Scale of the estimated cloud about its centroid relative to truth. */
  scale: number;
}

function sphereHit(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
  const oc = sub3(o, c);
  const b = dot3(oc, d),
    q = dot3(oc, oc) - r * r;
  const disc = b * b - q;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 1e-6 ? t : null;
}

function rmsDistance(
  a: (Vec3 | null)[],
  truth: Vec3[],
): { rms: number; mean: number } {
  let s = 0,
    m = 0,
    n = 0;
  a.forEach((p, i) => {
    if (!p) return;
    const d = norm3(sub3(p, truth[i]));
    s += d * d;
    m += d;
    n++;
  });
  return n ? { rms: Math.sqrt(s / n), mean: m / n } : { rms: NaN, mean: NaN };
}

/** Scan a sphere in front of a wall with estimated vs true calibration (camera frame). */
function scanTest(
  lab: Pick<CalibrationLab, "trueCamera">,
  camera: Intrinsics,
  projector: Intrinsics,
  stereo: { R: Mat; T: Vec3 },
  noise: number,
  random: () => number,
): ScanTest {
  const K = lab.trueCamera;
  const sphereC: Vec3 = [0, 10, 470],
    radius = 45;
  const projC = poseCenter(TRUE_STEREO);
  const truth: Vec3[] = [],
    estimated: (Vec3 | null)[] = [],
    ideal: (Vec3 | null)[] = [];
  for (let v = 120; v < K.height - 120; v += 18)
    for (let u = 160; u < K.width - 160; u += 18) {
      const d = normalize3([...undistortPixel(K, [u, v]), 1]);
      const ts = sphereHit([0, 0, 0], d, sphereC, radius);
      const tw = 560 / d[2];
      const t = ts ?? tw;
      const P = scale3(d, t);
      if (!ts && (Math.abs(P[0]) > 170 || Math.abs(P[1]) > 120)) continue;
      const toProj = normalize3(sub3(projC, P));
      if (ts) {
        if (dot3(sub3(P, sphereC), toProj) <= 0) continue;
      } else {
        const blocked = sphereHit(P, toProj, sphereC, radius);
        if (blocked !== null) continue;
      }
      const pp = project(TRUE_PROJECTOR, TRUE_STEREO, P);
      if (!inside(TRUE_PROJECTOR, pp, 0)) continue;
      const measured = noisy(pp!, noise, random);
      truth.push(P);
      estimated.push(
        triangulate(camera, projector, stereo.R, stereo.T, [u, v], measured),
      );
      ideal.push(
        triangulate(
          K,
          TRUE_PROJECTOR,
          TRUE_STEREO.R,
          TRUE_STEREO.t,
          [u, v],
          measured,
        ),
      );
    }
  const est = rmsDistance(estimated, truth),
    idl = rmsDistance(ideal, truth);
  const valid = estimated
    .map((p, i) => (p ? [p, truth[i]] : null))
    .filter((x): x is [Vec3, Vec3] => !!x);
  const centroid = (k: 0 | 1) =>
    scale3(
      valid.reduce<Vec3>((s, x) => add3(s, x[k]), [0, 0, 0]),
      1 / valid.length,
    );
  const ce = centroid(0),
    ct = centroid(1);
  const spread = (k: 0 | 1, c: Vec3) =>
    Math.sqrt(
      valid.reduce((s, x) => s + dot3(sub3(x[k], c), sub3(x[k], c)), 0),
    );
  return {
    truth,
    estimated,
    ideal,
    rmsEstimated: est.rms,
    rmsIdeal: idl.rms,
    meanEstimated: est.mean,
    scale: valid.length ? spread(0, ce) / spread(1, ct) : NaN,
  };
}

export function runCalibrationLab(
  config: CalibrationLabConfig,
): CalibrationLab {
  const random = createSeededRandom(config.seed);
  const trueCamera: Intrinsics = {
    ...TRUE_CAMERA,
    dist: [config.k1, ...TRUE_CAMERA.dist.slice(1)] as Intrinsics["dist"],
  };
  const truePoses = boardPoses(
    config.views,
    config.maxTilt,
    random,
    trueCamera,
  );
  const truthPts = boardPoints(TRUE_SQUARE_MM);
  const objectPoints = boardPoints(config.declaredSquare);
  const cameraObs = truePoses.map((pose) =>
    truthPts.map((X) =>
      noisy(project(trueCamera, pose, X)!, config.cornerNoise, random),
    ),
  );
  const projectorObs = truePoses.map((pose) =>
    truthPts.map((X) =>
      noisy(
        project(TRUE_PROJECTOR, composePose(TRUE_STEREO, pose), X)!,
        config.projectorNoise,
        random,
      ),
    ),
  );
  const options = { estimateDistortion: config.estimateDistortion };
  const camera = calibrateCamera(
    objectPoints,
    cameraObs,
    trueCamera.width,
    trueCamera.height,
    options,
  );
  const projector = calibrateCamera(
    objectPoints,
    projectorObs,
    TRUE_PROJECTOR.width,
    TRUE_PROJECTOR.height,
    options,
  );
  const stereo =
    camera.ok && projector.ok
      ? stereoCalibrate(
          objectPoints,
          cameraObs,
          projectorObs,
          camera.K,
          projector.K,
        )
      : null;
  const scan =
    camera.ok && projector.ok && stereo?.ok
      ? scanTest(
          { trueCamera },
          camera.K,
          projector.K,
          stereo,
          config.projectorNoise,
          createSeededRandom(config.seed + 1),
        )
      : null;
  return {
    config,
    trueCamera,
    truePoses,
    objectPoints,
    cameraObs,
    projectorObs,
    camera,
    projector,
    stereo,
    scan,
  };
}

// ---------------------------------------------------------------- Lab C

export type RegistrationMethod = "none" | "board" | "markers";

export interface RegistrationConfig {
  method: RegistrationMethod;
  /** Board corner noise for solvePnP, px. */
  cornerNoise: number;
  /** Marker centre noise for Kabsch, mm. */
  markerNoise: number;
  /** Extra rotation error injected into scanner B's estimated pose, degrees. */
  rotationErrorB: number;
  /** Projector correspondence noise, px. */
  projectorNoise: number;
  seed: number;
}

export const DEFAULT_REGISTRATION: RegistrationConfig = {
  method: "board",
  cornerNoise: 0.2,
  markerNoise: 0.05,
  rotationErrorB: 0,
  projectorNoise: 0.15,
  seed: 3,
};

/** World: board corner 0 at origin, board on the stage, Z up. */
const DOME_C: Vec3 = [80, 50, -10];
const DOME_R = 45;
const STAGE = { x: [-40, 200], y: [-30, 130] } as const;
export const MARKERS: Vec3[] = [
  [-25, -20, 8],
  [185, -20, 8],
  [185, 120, 8],
  [-25, 120, 8],
];

export interface Scanner {
  name: "A" | "B";
  /** World → camera, truth. */
  camera: Pose;
  /** World → projector, truth. */
  projector: Pose;
  /** Camera → projector. */
  stereo: Pose;
}

const UP: Vec3 = [0, 0, 1];
const TARGET: Vec3 = [80, 50, 0];
function scanner(name: "A" | "B", cam: Vec3, proj: Vec3): Scanner {
  const camera = lookAt(cam, TARGET, UP);
  const projector = aimAtPixel(proj, TARGET, UP, TRUE_PROJECTOR, [512, 384]);
  return {
    name,
    camera,
    projector,
    stereo: composePose(projector, invertPose(camera)),
  };
}
export const SCANNERS: Scanner[] = [
  scanner("A", [-170, 20, 330], [-160, 170, 320]),
  scanner("B", [330, 80, 330], [320, -70, 320]),
];

export interface ScannerResult {
  name: "A" | "B";
  /** Camera-frame reconstruction (what the scanner outputs). */
  cameraCloud: Vec3[];
  /** After applying the estimated camera → world transform. */
  worldCloud: Vec3[];
  truth: Vec3[];
  onStage: boolean[];
  /** Estimated world → camera pose (null for "none"). */
  estimatedPose: Pose | null;
  rms: number;
  /** Mean height of stage points: the height-zero offset, mm. */
  stageHeight: number;
  poseErrorDeg: number;
  poseErrorMm: number;
}

export interface RegistrationLab {
  config: RegistrationConfig;
  scanners: ScannerResult[];
  /** Truth-free: RMS distance of B points to A's local surface (NaN without a common frame). */
  consistency: { rms: number; points: number };
}

function scanScene(s: Scanner, noise: number, random: () => number) {
  const K = TRUE_CAMERA;
  const camC = poseCenter(s.camera),
    projC = poseCenter(s.projector);
  const toWorld = invertPose(s.camera);
  const cloud: Vec3[] = [],
    truth: Vec3[] = [],
    onStage: boolean[] = [];
  for (let v = 6; v < K.height; v += 10)
    for (let u = 6; u < K.width; u += 10) {
      const dCam = normalize3([...undistortPixel(K, [u, v]), 1]);
      const d = mul3(toWorld.R, dCam);
      let t = sphereHit(camC, d, DOME_C, DOME_R);
      let P = t !== null ? add3(camC, scale3(d, t)) : null;
      let stage = false;
      if (!P || P[2] < 0) {
        if (d[2] >= 0) continue;
        t = -camC[2] / d[2];
        P = add3(camC, scale3(d, t));
        stage = true;
        if (
          P[0] < STAGE.x[0] ||
          P[0] > STAGE.x[1] ||
          P[1] < STAGE.y[0] ||
          P[1] > STAGE.y[1]
        )
          continue;
      }
      const toProj = normalize3(sub3(projC, P));
      const block = sphereHit(P, toProj, DOME_C, DOME_R);
      if (block !== null && add3(P, scale3(toProj, block))[2] >= 0) continue;
      const pp = project(TRUE_PROJECTOR, s.projector, P);
      if (!inside(TRUE_PROJECTOR, pp, 0)) continue;
      const X = triangulate(
        K,
        TRUE_PROJECTOR,
        s.stereo.R,
        s.stereo.t,
        [u, v],
        noisy(pp!, noise, random),
      );
      if (!X) continue;
      cloud.push(X);
      truth.push(P);
      onStage.push(stage);
    }
  return { cloud, truth, onStage };
}

export function runRegistrationLab(
  config: RegistrationConfig,
): RegistrationLab {
  const random = createSeededRandom(config.seed);
  const board = boardPoints(TRUE_SQUARE_MM);
  const scanners = SCANNERS.map((s): ScannerResult => {
    const { cloud, truth, onStage } = scanScene(
      s,
      config.projectorNoise,
      random,
    );
    let estimated: Pose | null = null;
    if (config.method === "board") {
      const corners = board.map((X) =>
        noisy(project(TRUE_CAMERA, s.camera, X)!, config.cornerNoise, random),
      );
      estimated = solvePnP(board, corners, TRUE_CAMERA)?.pose ?? null;
    } else if (config.method === "markers") {
      const measured = MARKERS.map((M) =>
        add3(applyPose(s.camera, M), [
          config.markerNoise * gaussian(random),
          config.markerNoise * gaussian(random),
          config.markerNoise * gaussian(random),
        ]),
      );
      const fit = rigidTransform(measured, MARKERS);
      estimated = invertPose({ R: fit.R, t: fit.t });
    }
    if (estimated && s.name === "B" && config.rotationErrorB) {
      // Rotate about the camera's own x axis: the camera centre stays put.
      const Q = rodrigues([(config.rotationErrorB * Math.PI) / 180, 0, 0]);
      estimated = { R: matMul(Q, estimated.R), t: mul3(Q, estimated.t) };
    }
    const toWorld = estimated ? invertPose(estimated) : null;
    const worldCloud = cloud.map((X) => (toWorld ? applyPose(toWorld, X) : X));
    let s2 = 0,
      h = 0,
      hn = 0;
    worldCloud.forEach((X, i) => {
      const d = sub3(X, truth[i]);
      s2 += dot3(d, d);
      if (onStage[i]) {
        h += X[2];
        hn++;
      }
    });
    return {
      name: s.name,
      cameraCloud: cloud,
      worldCloud,
      truth,
      onStage,
      estimatedPose: estimated,
      rms: Math.sqrt(s2 / Math.max(1, cloud.length)),
      stageHeight: hn ? h / hn : NaN,
      poseErrorDeg: estimated ? rotationAngleDeg(estimated.R, s.camera.R) : NaN,
      poseErrorMm: estimated
        ? norm3(sub3(poseCenter(estimated), poseCenter(s.camera)))
        : NaN,
    };
  });
  return {
    config,
    scanners,
    consistency:
      config.method === "none"
        ? { rms: NaN, points: 0 }
        : cloudConsistency(scanners),
  };
}

/** Truth-free cloud-to-cloud distance: B points to local planes fitted on A. */
function cloudConsistency(s: ScannerResult[]): { rms: number; points: number } {
  const radius = 5,
    a = s[0].worldCloud;
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / radius)},${Math.floor(y / radius)},${Math.floor(z / radius)}`;
  const hash = new Map<string, Vec3[]>();
  for (const p of a) {
    const k = key(...p);
    const list = hash.get(k);
    if (list) list.push(p);
    else hash.set(k, [p]);
  }
  let sum = 0,
    n = 0;
  for (const p of s[1].worldCloud) {
    const near: Vec3[] = [];
    const [i, j, k] = p.map((v) => Math.floor(v / radius));
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (let dk = -1; dk <= 1; dk++)
          for (const q of hash.get(`${i + di},${j + dj},${k + dk}`) ?? [])
            if (norm3(sub3(q, p)) <= radius) near.push(q);
    if (near.length < 6) continue;
    const c = scale3(
      near.reduce<Vec3>((acc, q) => add3(acc, q), [0, 0, 0]),
      1 / near.length,
    );
    const cov = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (const q of near) {
      const d = sub3(q, c);
      for (let r = 0; r < 3; r++)
        for (let col = 0; col < 3; col++) cov[r][col] += d[r] * d[col];
    }
    const normal = symmetricEigen(cov).vectors[0];
    const dist = dot3(sub3(p, c), normal);
    sum += dist * dist;
    n++;
  }
  return { rms: n ? Math.sqrt(sum / n) : NaN, points: n };
}

export const SCENE = { DOME_C, DOME_R, STAGE };
