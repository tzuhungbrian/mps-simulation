import { describe, expect, it } from "vitest";
import { stereoCalibrate } from "../camera";
import { rotationAngleDeg, norm3, sub3 } from "../linalg";
import { hintsFor } from "./assistant";
import { runCapture } from "./capture";
import { calibrateCameraCV } from "./opencv";
import { opencvForTests } from "./opencv.node";
import { decodeWrapped, unwrapTemporal } from "./phase";
import {
  DEFAULT_PLACEMENT,
  DEFAULT_SETTINGS,
  LAB_CAMERA,
  LAB_PROJECTOR,
  LAB_STEREO,
  boardCorners,
  cameraAt,
  truthProjections,
  type BoardPlacement,
} from "./rig";
import { checkView } from "./validate";

describe("fringe decoding", () => {
  it("recovers phase from 4-step frames and unwraps 1 → 4 → 16 periods", () => {
    const n = 200;
    const truth = Float32Array.from(
      { length: n },
      (_, i) => (i / n) * 2 * Math.PI * 0.999,
    );
    const wrapped = [1, 4, 16].map((f) => {
      const frames = [0, 1, 2, 3].map((k) =>
        Uint8Array.from(truth, (p) =>
          Math.round(120 + 80 * Math.cos(f * p + (k * Math.PI) / 2)),
        ),
      );
      return decodeWrapped(frames, 5).phase;
    });
    const abs = unwrapTemporal(wrapped, [1, 4, 16]);
    abs.forEach((v, i) =>
      expect(Math.abs(v - 16 * truth[i])).toBeLessThan(0.05),
    );
  });
});

describe("simulated bench", () => {
  const poses: BoardPlacement[] = [
    { x: 0, y: 0, z: 520, rx: 0, ry: 0, rz: 0 },
    { x: -60, y: -40, z: 500, rx: 25, ry: -15, rz: 10 },
    { x: 60, y: 40, z: 560, rx: -20, ry: 25, rz: -8 },
    { x: -50, y: 50, z: 600, rx: -30, ry: -20, rz: -20 },
    { x: 20, y: 10, z: 540, rx: 0, ry: -35, rz: 90 },
  ];

  it("renders, detects corners, decodes the projector and calibrates with real OpenCV", async () => {
    const cv = await opencvForTests();
    const caps = poses.map((p, k) =>
      runCapture(p, DEFAULT_SETTINGS, k + 1, cv),
    );
    caps.forEach((c, k) => {
      expect(c.corners, `pose ${k}`).not.toBeNull();
      const truth = truthProjections(poses[k]);
      c.corners!.forEach((q, i) => {
        const j = truth.camera.findIndex(
          (t) => t && Math.hypot(t[0] - q[0], t[1] - q[1]) < 2,
        );
        expect(j, "corner matches a true corner").toBeGreaterThanOrEqual(0);
        expect(
          Math.hypot(truth.camera[j]![0] - q[0], truth.camera[j]![1] - q[1]),
        ).toBeLessThan(0.5);
        const p = c.projector![i]!;
        expect(
          Math.hypot(
            truth.projector[j]![0] - p[0],
            truth.projector[j]![1] - p[1],
          ),
        ).toBeLessThan(1);
      });
    });
    const obj = boardCorners();
    const cam = calibrateCameraCV(
      cv,
      obj,
      caps.map((c) => c.corners!),
      1024,
      768,
      ["CALIB_FIX_K3"],
    );
    expect(cam.rms).toBeLessThan(0.3);
    expect(Math.abs(cam.K.fx - LAB_CAMERA.fx) / LAB_CAMERA.fx).toBeLessThan(
      0.01,
    );
    const proj = calibrateCameraCV(
      cv,
      obj,
      caps.map((c) => c.projector as [number, number][]),
      1024,
      768,
      ["CALIB_FIX_K3"],
    );
    expect(
      Math.abs(proj.K.fx - LAB_PROJECTOR.fx) / LAB_PROJECTOR.fx,
    ).toBeLessThan(0.02);
    const stereo = stereoCalibrate(
      obj,
      caps.map((c) => c.corners!),
      caps.map((c) => c.projector as [number, number][]),
      cam.K,
      proj.K,
    );
    if (!stereo.ok) throw new Error(stereo.reason);
    expect(rotationAngleDeg(stereo.R, LAB_STEREO.R)).toBeLessThan(0.5);
    expect(norm3(sub3(stereo.T, LAB_STEREO.t))).toBeLessThan(5);
    const check = checkView(
      cam.K,
      proj.K,
      stereo.R,
      stereo.T,
      caps[1].corners!,
      caps[1].projector!,
    );
    expect(Math.abs(check!.spacingMean - 20)).toBeLessThan(0.2);
  }, 180_000);

  it("the lab assistant flags corners outside the camera view", () => {
    const hints = hintsFor(
      { ...DEFAULT_PLACEMENT, x: 160 },
      DEFAULT_SETTINGS,
      [],
    );
    expect(hints.some((h) => h.level === "error")).toBe(true);
    expect(
      hintsFor(DEFAULT_PLACEMENT, DEFAULT_SETTINGS, []).every(
        (h) => h.level !== "error",
      ),
    ).toBe(true);
  });

  it("refocusing changes fx (focus breathing) and the assistant flags it", () => {
    expect(cameraAt(DEFAULT_SETTINGS.focusMm).fx).toBe(LAB_CAMERA.fx);
    // Thin lens f = 16 mm: v(300) / v(520) = 1.0238.
    expect(cameraAt(300).fx / LAB_CAMERA.fx).toBeCloseTo(1.0238, 4);
    expect(cameraAt(1000).fx).toBeLessThan(LAB_CAMERA.fx);
    const previous = [
      { placement: DEFAULT_PLACEMENT, settings: DEFAULT_SETTINGS },
    ];
    const placement = { ...DEFAULT_PLACEMENT, rx: 25 };
    expect(
      hintsFor(placement, DEFAULT_SETTINGS, previous).every(
        (h) => h.level !== "error",
      ),
    ).toBe(true);
    expect(
      hintsFor(placement, { ...DEFAULT_SETTINGS, focusMm: 600 }, previous).some(
        (h) => h.level === "error" && h.text.includes("對焦"),
      ),
    ).toBe(true);
  });
});
