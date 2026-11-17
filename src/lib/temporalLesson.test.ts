import { describe, expect, it } from "vitest";
import { TAU } from "../core/simulation";
import { unwrapTemporal as labUnwrapTemporal } from "../calibration/lab/phase";
import {
  FINE,
  HIERARCHY,
  LEVELS_ALL,
  LEVELS_SKIP,
  PROJECTOR_WIDTH,
  explainPixel,
  orderErrors,
  spatialAligned,
  stepColumn,
  synthesizeScene,
  toProjectorPixel,
  unwrapTemporal,
} from "./temporalLesson";

const W = 512;

describe("temporal unwrapping lesson", () => {
  it("recovers the absolute fine phase of a noiseless scene, step included", () => {
    const data = synthesizeScene({ width: W, stepCycles: 1.3 });
    const abs = unwrapTemporal(data, LEVELS_ALL);
    for (let i = 0; i < W; i++)
      expect(abs[i]).toBeCloseTo(TAU * FINE * data.truth![i], 9);
    expect(orderErrors(data, abs).errors).toBe(0);
  });

  it("matches the 3D lab's hierarchical unwrapTemporal", () => {
    const data = synthesizeScene({
      width: W,
      rows: 4,
      noiseSigma: 0.05,
      stepCycles: 0.7,
    });
    const ours = unwrapTemporal(data, LEVELS_ALL);
    const lab = labUnwrapTemporal(
      data.wrapped.map((w) => Float32Array.from(w)),
      [...HIERARCHY],
    );
    for (let i = 0; i < ours.length; i++) {
      if (!Number.isFinite(ours[i])) continue;
      expect(Math.abs(ours[i] - lab[i])).toBeLessThan(1e-3);
    }
  });

  it("explains each level as k = round((r·Φ − φ̂) / 2π)", () => {
    const steps = explainPixel([-2.5, 1.0, -0.4], HIERARCHY)!;
    expect(steps[0].absolute).toBeCloseTo(TAU - 2.5, 12);
    expect(steps[0].predicted).toBeNull();
    for (let l = 1; l < steps.length; l++) {
      const s = steps[l];
      expect(s.predicted).toBeCloseTo(
        (HIERARCHY[l] / HIERARCHY[l - 1]) * steps[l - 1].absolute,
        12,
      );
      expect(Number.isInteger(s.order)).toBe(true);
      expect(Math.abs(s.absolute - s.predicted!)).toBeLessThanOrEqual(Math.PI);
    }
    expect(explainPixel([NaN, 1, 2], HIERARCHY)).toBeNull();
  });

  it("spatial unwrapping slips whole cycles once the step exceeds half a cycle", () => {
    const at = (cycles: number) => {
      const data = synthesizeScene({ width: W, stepCycles: cycles });
      const s = spatialAligned(data);
      return (
        Math.round((s[W - 1] - TAU * FINE * data.truth![W - 1]) / TAU) || 0
      );
    };
    expect(at(0)).toBe(0);
    expect(at(0.3)).toBe(0);
    expect(at(0.7)).toBe(-1);
    expect(at(1.3)).toBe(-1);
    expect(at(1.8)).toBe(-2);
    const d = synthesizeScene({ width: W, stepCycles: 0.7 });
    const s = spatialAligned(d);
    const x0 = stepColumn(W);
    expect(s[x0 - 1]).toBeCloseTo(TAU * FINE * d.truth![x0 - 1], 9);
  });

  it("skipping the middle level amplifies coarse noise into order errors", () => {
    const data = synthesizeScene({ width: W, rows: 32, noiseSigma: 0.06 });
    const full = orderErrors(data, unwrapTemporal(data, LEVELS_ALL));
    const skip = orderErrors(data, unwrapTemporal(data, LEVELS_SKIP));
    expect(full.errors).toBe(0);
    expect(skip.errors / skip.valid).toBeGreaterThan(0.01);
    expect(full.coarseNoise).toBeGreaterThan(0.05);
  });

  it("maps the absolute fine phase to a projector column", () => {
    expect(toProjectorPixel(0)).toBe(0);
    expect(toProjectorPixel(TAU * FINE)).toBeCloseTo(PROJECTOR_WIDTH, 9);
  });

  it("is deterministic and validates options", () => {
    const a = synthesizeScene({ width: 64, noiseSigma: 0.03, seed: 3 });
    const b = synthesizeScene({ width: 64, noiseSigma: 0.03, seed: 3 });
    expect(a.wrapped[2]).toEqual(b.wrapped[2]);
    expect(() => synthesizeScene({ width: 64, stepCycles: 3 })).toThrow(
      RangeError,
    );
    expect(() => synthesizeScene({ width: 4 })).toThrow(RangeError);
  });
});
