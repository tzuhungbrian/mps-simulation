import { describe, it, expect } from "vitest";
import { TAU, unwrapRows, wrapPhase } from "../core/simulation";
import {
  buildUnwrapLesson,
  describeUnwrapTransition,
} from "./unwrappingLesson";

describe("Phase Unwrapping lesson uses decoded data only", () => {
  it("uses the real spatial unwrap and preserves the unknown integer-period family", () => {
    const wrapped = Float64Array.from([2.8, 3.1, -3.1, -2.8]),
      valid = new Uint8Array(4).fill(1);
    const original = wrapped.slice();
    const lesson = buildUnwrapLesson(wrapped, valid, { periodOffset: 1 });
    const canonical = unwrapRows(wrapped, valid, 4);
    expect(lesson.relative).toEqual(canonical);
    for (let i = 0; i < 4; i++) {
      expect(lesson.displayed[i]).toBeCloseTo(canonical[i] + TAU, 12);
      expect(wrapPhase(lesson.displayed[i])).toBeCloseTo(wrapped[i], 12);
    }
    expect(lesson.boundaries).toEqual([2]);
    expect(lesson.segmentCount).toBe(1);
    expect(wrapped).toEqual(original);
    expect(valid).toEqual(new Uint8Array(4).fill(1));
  });

  it("restarts independently after a labelled teaching gap without altering captures", () => {
    const wrapped = Float64Array.from([
      2.7, 2.9, 3.1, -3.1, -2.9, -2.7, -2.5, -2.3,
    ]);
    const valid = new Uint8Array(8).fill(1);
    const lesson = buildUnwrapLesson(wrapped, valid, { showGap: true });
    expect(lesson.gap).toEqual({ start: 3, end: 5 });
    expect(lesson.segmentCount).toBe(2);
    expect([...lesson.segments]).toEqual([0, 0, 0, -1, -1, 1, 1, 1]);
    expect(Number.isNaN(lesson.relative[3])).toBe(true);
    expect(Number.isNaN(lesson.wrapped[4])).toBe(true);
    expect(lesson.relative[5]).toBe(wrapped[5]);
    expect(unwrapRows(wrapped, valid, 8)[5]).not.toBeCloseTo(
      lesson.relative[5],
    );
    expect(valid.every((v) => v === 1)).toBe(true);
    expect(wrapped.every(Number.isFinite)).toBe(true);
  });

  it("respects existing invalid or nonfinite measurements and never fills a gap", () => {
    const lesson = buildUnwrapLesson(
      Float64Array.from([1, 2, NaN, 2.5, 2.8]),
      Uint8Array.from([1, 0, 1, 1, 1]),
    );
    expect([...lesson.valid]).toEqual([1, 0, 0, 1, 1]);
    expect(lesson.segmentCount).toBe(2);
    expect(lesson.relative[3]).toBe(2.5);
    expect(Number.isNaN(lesson.displayed[1])).toBe(true);
  });

  it.each([-1, 0, 1])(
    "all k=%i candidates rewrap to the same decoded observations",
    (periodOffset) => {
      const source = Float64Array.from([2.9, -3.1, -2.9]);
      const data = buildUnwrapLesson(source, new Uint8Array(3).fill(1), {
        periodOffset,
      });
      data.displayed.forEach((v, i) =>
        expect(wrapPhase(v)).toBeCloseTo(source[i], 12),
      );
    },
  );

  it.each([
    { values: [3.1, -3.1], periods: 1 },
    { values: [-3.1, 3.1], periods: -1 },
    { values: [0.4, 0.6], periods: 0 },
  ])(
    "explains a correction of $periods periods using the measured adjacent difference",
    ({ values, periods }) => {
      const data = buildUnwrapLesson(
        Float64Array.from(values),
        new Uint8Array(2).fill(1),
      );
      const transition = describeUnwrapTransition(data, 1);
      expect(transition.kind).toBe("connected");
      expect(transition.periodAdjustment).toBe(periods);
      expect(transition.rawDelta).toBeCloseTo(values[1] - values[0], 12);
      expect(transition.correctedDelta).toBeCloseTo(
        values[1] - values[0] + periods * TAU,
        12,
      );
      expect(
        transition.previousUnwrapped! + transition.correctedDelta!,
      ).toBeCloseTo(data.displayed[1], 12);
    },
  );

  it("does not invent a previous sample at a segment anchor or an invalid pixel", () => {
    const data = buildUnwrapLesson(
      Float64Array.from([1, 2, 3]),
      Uint8Array.from([1, 0, 1]),
    );
    expect(describeUnwrapTransition(data, 0).kind).toBe("anchor");
    expect(describeUnwrapTransition(data, 1).kind).toBe("invalid");
    expect(describeUnwrapTransition(data, 2).rawDelta).toBeNull();
    expect(describeUnwrapTransition(data, 2).kind).toBe("anchor");
  });

  it("marks an exact π difference as directionally ambiguous, not a proven correction", () => {
    const data = buildUnwrapLesson(
      Float64Array.from([-Math.PI, 0]),
      new Uint8Array(2).fill(1),
    );
    expect(describeUnwrapTransition(data, 1).ambiguous).toBe(true);
  });

  it.each([1.5, Infinity, NaN])(
    "rejects noninteger or nonfinite period offsets %s",
    (periodOffset) => {
      expect(() =>
        buildUnwrapLesson(new Float64Array(2), new Uint8Array(2).fill(1), {
          periodOffset,
        }),
      ).toThrow(RangeError);
    },
  );

  it("rejects malformed row sizes and out-of-range transition indices", () => {
    expect(() =>
      buildUnwrapLesson(new Float64Array(0), new Uint8Array(0)),
    ).toThrow(RangeError);
    expect(() =>
      buildUnwrapLesson(new Float64Array(2), new Uint8Array(1)),
    ).toThrow(RangeError);
    const data = buildUnwrapLesson(
      new Float64Array(2),
      new Uint8Array(2).fill(1),
    );
    expect(() => describeUnwrapTransition(data, -1)).toThrow(RangeError);
    expect(() => describeUnwrapTransition(data, 2)).toThrow(RangeError);
  });
});
