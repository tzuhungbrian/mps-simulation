import { describe, expect, it } from "vitest";
import { distort, findHomography, project, undistortPixel } from "./camera";
import {
  matMul,
  mul3,
  nearestRotation,
  rigidTransform,
  rodrigues,
  rotationAngleDeg,
  rotationToVector,
  symmetricEigen,
  transpose,
  type Vec3,
} from "./linalg";
import {
  DEFAULT_LAB,
  DEFAULT_REGISTRATION,
  TRUE_PROJECTOR,
  TRUE_STEREO,
  runCalibrationLab,
  runRegistrationLab,
} from "./simulate";

describe("linear algebra", () => {
  it("symmetric eigen-decomposition reconstructs the matrix", () => {
    const A = [
      [4, 1, -2, 0.5],
      [1, 3, 0, 1],
      [-2, 0, 5, 2],
      [0.5, 1, 2, 1],
    ];
    const { values, vectors } = symmetricEigen(A);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const r = values.reduce(
          (s, l, k) => s + l * vectors[k][i] * vectors[k][j],
          0,
        );
        expect(r).toBeCloseTo(A[i][j], 10);
      }
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("Rodrigues round-trips, including angles near π", () => {
    for (const r of [
      [0.1, -0.2, 0.3],
      [0, 0, 0],
      [Math.PI - 1e-4, 0, 0],
      [1.5, 1.5, -1.5],
    ]) {
      const back = rotationToVector(rodrigues(r));
      expect(rotationAngleDeg(rodrigues(back), rodrigues(r))).toBeLessThan(
        1e-6,
      );
    }
  });

  it("nearestRotation projects a perturbed matrix onto SO(3)", () => {
    const R = rodrigues([0.3, -0.5, 0.2]);
    const noisy = R.map((row) => row.map((v) => v + 0.01));
    const Q = nearestRotation(noisy);
    const QtQ = matMul(transpose(Q), Q);
    QtQ.forEach((row, i) =>
      row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 10)),
    );
    expect(rotationAngleDeg(Q, R)).toBeLessThan(1.5);
  });

  it("rigidTransform (Kabsch) recovers a known rigid motion", () => {
    const R = rodrigues([0.4, 0.1, -0.7]);
    const t: Vec3 = [10, -20, 30];
    const src: Vec3[] = [
      [0, 0, 0],
      [100, 0, 0],
      [0, 50, 0],
      [20, 30, 40],
    ];
    const dst = src.map((p) => {
      const q = mul3(R, p);
      return [q[0] + t[0], q[1] + t[1], q[2] + t[2]] as Vec3;
    });
    const fit = rigidTransform(src, dst);
    expect(rotationAngleDeg(fit.R, R)).toBeLessThan(1e-6);
    fit.t.forEach((v, i) => expect(v).toBeCloseTo(t[i], 6));
    expect(fit.rms).toBeLessThan(1e-9);
  });
});

describe("camera model", () => {
  it("undistortPixel inverts the OpenCV distortion model", () => {
    const K = {
      ...TRUE_PROJECTOR,
      dist: [-0.2, 0.05, 0.001, -0.002, 0] as [
        number,
        number,
        number,
        number,
        number,
      ],
    };
    for (const [x, y] of [
      [0.1, -0.2],
      [-0.3, 0.25],
      [0, 0],
    ]) {
      const [xd, yd] = distort(x, y, K.dist);
      const [u, v] = undistortPixel(K, [K.fx * xd + K.cx, K.fy * yd + K.cy]);
      expect(u).toBeCloseTo(x, 9);
      expect(v).toBeCloseTo(y, 9);
    }
  });

  it("findHomography is exact on noise-free correspondences", () => {
    const H = [
      [1.2, 0.1, 30],
      [-0.05, 0.9, 12],
      [1e-4, -2e-4, 1],
    ];
    const src: [number, number][] = [
      [0, 0],
      [100, 0],
      [0, 80],
      [100, 80],
      [40, 30],
    ];
    const map = ([x, y]: [number, number]): [number, number] => {
      const p = mul3(H, [x, y, 1]);
      return [p[0] / p[2], p[1] / p[2]];
    };
    const est = findHomography(src, src.map(map))!;
    est.forEach((row, i) =>
      row.forEach((v, j) => expect(v).toBeCloseTo(H[i][j], 8)),
    );
  });
});

describe("calibration lab", () => {
  it("recovers intrinsics, distortion and stereo extrinsics without noise", () => {
    const lab = runCalibrationLab({
      ...DEFAULT_LAB,
      cornerNoise: 0,
      projectorNoise: 0,
    });
    expect(lab.camera.ok && lab.projector.ok && lab.stereo?.ok).toBe(true);
    if (!lab.camera.ok || !lab.projector.ok || !lab.stereo?.ok) return;
    const K = lab.camera.K;
    expect(lab.camera.rms).toBeLessThan(1e-4);
    expect(K.fx).toBeCloseTo(lab.trueCamera.fx, 2);
    expect(K.cy).toBeCloseTo(lab.trueCamera.cy, 2);
    expect(K.dist[0]).toBeCloseTo(lab.trueCamera.dist[0], 4);
    expect(lab.projector.K.cy).toBeCloseTo(TRUE_PROJECTOR.cy, 2);
    expect(rotationAngleDeg(lab.stereo.R, TRUE_STEREO.R)).toBeLessThan(1e-4);
    lab.stereo.T.forEach((v, i) => expect(v).toBeCloseTo(TRUE_STEREO.t[i], 3));
    expect(lab.scan!.rmsEstimated).toBeLessThan(1e-3);
  });

  it("a wrong square size scales the scene but not the intrinsics or the RMS", () => {
    const lab = runCalibrationLab({
      ...DEFAULT_LAB,
      cornerNoise: 0,
      projectorNoise: 0,
      declaredSquare: 22,
    });
    if (!lab.camera.ok || !lab.stereo?.ok)
      throw new Error("calibration failed");
    expect(lab.camera.rms).toBeLessThan(1e-4);
    expect(lab.camera.K.fx).toBeCloseTo(lab.trueCamera.fx, 2);
    expect(lab.camera.poses[0].t[2] / lab.truePoses[0].t[2]).toBeCloseTo(
      1.1,
      6,
    );
    expect(lab.scan!.scale).toBeCloseTo(1.1, 4);
  });

  it("without tilt the focal length is not identifiable", () => {
    const lab = runCalibrationLab({
      ...DEFAULT_LAB,
      maxTilt: 0,
      cornerNoise: 0.2,
    });
    const ok =
      lab.camera.ok && Math.abs(lab.camera.K.fx - lab.trueCamera.fx) < 5;
    expect(ok).toBe(false);
  });

  it("ignoring distortion leaves a large reprojection error", () => {
    const lab = runCalibrationLab({
      ...DEFAULT_LAB,
      estimateDistortion: false,
      k1: -0.25,
    });
    if (!lab.camera.ok) throw new Error("calibration failed");
    expect(lab.camera.rms).toBeGreaterThan(1);
  });

  it("projects every simulated corner inside the image", () => {
    const lab = runCalibrationLab(DEFAULT_LAB);
    lab.truePoses.forEach((pose) => {
      const p = project(lab.trueCamera, pose, [0, 0, 0])!;
      expect(p[0]).toBeGreaterThan(0);
      expect(p[1]).toBeLessThan(lab.trueCamera.height);
    });
  });
});

describe("registration lab", () => {
  it("board-based registration puts both scanners in one world frame", () => {
    const lab = runRegistrationLab({
      ...DEFAULT_REGISTRATION,
      cornerNoise: 0,
      projectorNoise: 0,
    });
    for (const s of lab.scanners) {
      expect(s.worldCloud.length).toBeGreaterThan(500);
      expect(s.rms).toBeLessThan(1e-3);
      expect(Math.abs(s.stageHeight)).toBeLessThan(1e-3);
    }
    expect(lab.consistency.points).toBeGreaterThan(50);
    expect(lab.consistency.rms).toBeLessThan(0.05);
  });

  it("marker (Kabsch) registration also works and a rotation error shows up as inconsistency", () => {
    const good = runRegistrationLab({
      ...DEFAULT_REGISTRATION,
      method: "markers",
      markerNoise: 0,
      projectorNoise: 0,
    });
    good.scanners.forEach((s) => expect(s.rms).toBeLessThan(1e-3));
    const bad = runRegistrationLab({
      ...DEFAULT_REGISTRATION,
      rotationErrorB: 0.5,
    });
    expect(bad.scanners[1].poseErrorDeg).toBeGreaterThan(0.4);
    expect(bad.consistency.rms).toBeGreaterThan(good.consistency.rms + 0.5);
  });
});
