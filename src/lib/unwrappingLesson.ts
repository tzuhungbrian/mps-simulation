import { TAU, unwrapRows, wrapPhase } from "../core/simulation";

export interface UnwrapLessonOptions {
  periodOffset?: number;
  showGap?: boolean;
}
export interface UnwrapLessonData {
  wrapped: Float64Array;
  valid: Uint8Array;
  relative: Float64Array;
  displayed: Float64Array;
  segments: Int32Array;
  segmentCount: number;
  boundaries: number[];
  gap: { start: number; end: number } | null;
}
export function buildUnwrapLesson(
  source: Float64Array,
  sourceValid: Uint8Array,
  options: UnwrapLessonOptions = {},
): UnwrapLessonData {
  const periodOffset = options.periodOffset ?? 0;
  if (
    source.length < 1 ||
    source.length !== sourceValid.length ||
    !Number.isSafeInteger(periodOffset)
  ) {
    throw new RangeError(
      "Expected a nonempty decoded row, matching mask and integer period offset",
    );
  }
  const wrapped = source.slice(),
    valid = sourceValid.slice();
  // This optional mask teaches invalid-data handling, not physical occlusion.
  const gap =
    options.showGap && source.length >= 3
      ? {
          start: Math.floor(source.length * 0.46),
          end: Math.ceil(source.length * 0.54),
        }
      : null;
  if (gap) valid.fill(0, gap.start, gap.end);
  for (let i = 0; i < wrapped.length; i++) {
    if (!valid[i] || !Number.isFinite(wrapped[i])) {
      valid[i] = 0;
      wrapped[i] = NaN;
    }
  }
  const relative = unwrapRows(wrapped, valid, wrapped.length);
  const displayed = relative.map((value) => value + periodOffset * TAU);
  const segments = new Int32Array(wrapped.length).fill(-1);
  const boundaries: number[] = [];
  let segment = -1,
    anchored = false;
  for (let i = 0; i < wrapped.length; i++) {
    if (!valid[i] || !Number.isFinite(wrapped[i])) {
      anchored = false;
      continue;
    }
    if (!anchored) segment++;
    else if (Math.abs(wrapped[i] - wrapped[i - 1]) > Math.PI)
      boundaries.push(i);
    segments[i] = segment;
    anchored = true;
  }
  return {
    wrapped,
    valid,
    relative,
    displayed,
    segments,
    segmentCount: segment + 1,
    boundaries,
    gap,
  };
}

export interface UnwrapTransition {
  kind: "invalid" | "anchor" | "connected";
  rawDelta: number | null;
  correctedDelta: number | null;
  periodAdjustment: number;
  previousUnwrapped: number | null;
  ambiguous: boolean;
}

/** Describe the same shortest-difference rule used by unwrapRows, not a truth lookup. */
export function describeUnwrapTransition(
  data: UnwrapLessonData,
  index: number,
): UnwrapTransition {
  if (!Number.isInteger(index) || index < 0 || index >= data.wrapped.length) {
    throw new RangeError("Transition index is outside the decoded row");
  }
  const empty = {
    rawDelta: null,
    correctedDelta: null,
    periodAdjustment: 0,
    previousUnwrapped: null,
    ambiguous: false,
  };
  if (!data.valid[index]) return { ...empty, kind: "invalid" };
  if (index === 0 || !data.valid[index - 1])
    return { ...empty, kind: "anchor" };
  const rawDelta = data.wrapped[index] - data.wrapped[index - 1];
  const correctedDelta = wrapPhase(rawDelta);
  return {
    kind: "connected",
    rawDelta,
    correctedDelta,
    periodAdjustment: Math.round((correctedDelta - rawDelta) / TAU) || 0,
    previousUnwrapped: data.displayed[index - 1],
    ambiguous: Math.abs(Math.abs(correctedDelta) - Math.PI) < 1e-12,
  };
}
