import {
  TAU,
  SHIFTS,
  createSeededRandom,
  decodeThreeStep,
  unwrapRows,
} from "../core/simulation";
import { FRINGE, LAB_PROJECTOR } from "../calibration/lab/rig";

/** Same coarse → fine set as the 3D lab, so what is learned here carries over. */
export const HIERARCHY = FRINGE.frequencies;
/** Level indices: the full hierarchy, and the same endpoints with the middle level skipped. */
export const LEVELS_ALL = HIERARCHY.map((_, i) => i);
export const LEVELS_SKIP = [0, HIERARCHY.length - 1];
export const FINE = HIERARCHY[HIERARCHY.length - 1];
export const PROJECTOR_WIDTH = LAB_PROJECTOR.width;

/**
 * Decoded fringe phases for a block of camera rows, one wrapped map per frequency.
 * Source-agnostic: 1D synthesis today, 3D-lab captures later.
 */
export interface TemporalData {
  width: number;
  rows: number;
  frequencies: readonly number[];
  wrapped: Float64Array[];
  valid: Uint8Array;
  /** Projector coordinate u ∈ [0, 1); synthetic truth for grading only. */
  truth?: Float64Array;
}

export interface SceneOptions {
  width: number;
  rows?: number;
  /** Depth-step height in cycles of the finest fringe. */
  stepCycles?: number;
  noiseSigma?: number;
  seed?: number;
}

// Margins keep the single-period level away from its 0/2π seam, even after the largest step.
const U0 = 0.08,
  SPAN = 0.7,
  MEAN = 0.5,
  AMPLITUDE = 0.35,
  MIN_MODULATION = 0.02;
export const MAX_STEP_CYCLES = 2;
export const stepColumn = (width: number) => Math.round(width * 0.55);

/** A tilted plane with one depth step, seen through three-step fringes at every frequency. */
export function synthesizeScene({
  width,
  rows = 1,
  stepCycles = 0,
  noiseSigma = 0,
  seed = 7,
}: SceneOptions): TemporalData {
  if (
    !Number.isInteger(width) ||
    width < 8 ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    !(stepCycles >= 0 && stepCycles <= MAX_STEP_CYCLES) ||
    !(noiseSigma >= 0 && noiseSigma <= 0.15)
  )
    throw new RangeError("Invalid temporal scene options");
  const n = width * rows,
    x0 = stepColumn(width);
  const truth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % width;
    truth[i] =
      U0 + (SPAN * x) / (width - 1) + (x >= x0 ? stepCycles / FINE : 0);
  }
  const random = createSeededRandom(seed);
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
  const valid = new Uint8Array(n).fill(1);
  const wrapped = HIERARCHY.map((f) => {
    const frames = SHIFTS.map(() => new Float64Array(n)) as [
      Float64Array,
      Float64Array,
      Float64Array,
    ];
    const clipped = new Uint8Array(n);
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 3; k++) {
        const v =
          MEAN +
          AMPLITUDE * Math.cos(TAU * f * truth[i] + SHIFTS[k]) +
          (noiseSigma ? noiseSigma * gaussian() : 0);
        if (v <= 0 || v >= 1) clipped[i] = 1;
        frames[k][i] = Math.min(1, Math.max(0, v));
      }
    const decoded = decodeThreeStep(frames, MIN_MODULATION, clipped);
    for (let i = 0; i < n; i++) valid[i] &= decoded.valid[i];
    return decoded.wrapped;
  });
  return { width, rows, frequencies: HIERARCHY, wrapped, valid, truth };
}

export interface LevelStep {
  frequency: number;
  wrapped: number;
  /** r · Φ of the coarser level; null on the first level. */
  predicted: number | null;
  order: number;
  absolute: number;
}

/** Per-pixel hierarchical unwrapping, same rule as the 3D lab's unwrapTemporal. */
export function explainPixel(
  wrapped: readonly number[],
  frequencies: readonly number[],
): LevelStep[] | null {
  if (wrapped.some((v) => !Number.isFinite(v))) return null;
  const first = ((wrapped[0] % TAU) + TAU) % TAU;
  const out: LevelStep[] = [
    {
      frequency: frequencies[0],
      wrapped: wrapped[0],
      predicted: null,
      order: Math.round((first - wrapped[0]) / TAU),
      absolute: first,
    },
  ];
  for (let l = 1; l < frequencies.length; l++) {
    const predicted =
      (frequencies[l] / frequencies[l - 1]) * out[l - 1].absolute;
    const order = Math.round((predicted - wrapped[l]) / TAU);
    out.push({
      frequency: frequencies[l],
      wrapped: wrapped[l],
      predicted,
      order,
      absolute: wrapped[l] + TAU * order,
    });
  }
  return out;
}

/** Absolute phase of the finest level for the chosen subset of levels (indices into data.frequencies). */
export function unwrapTemporal(
  data: TemporalData,
  levels: readonly number[],
): Float64Array {
  const n = data.valid.length,
    out = new Float64Array(n).fill(NaN);
  const freqs = levels.map((l) => data.frequencies[l]);
  for (let i = 0; i < n; i++) {
    if (!data.valid[i]) continue;
    const steps = explainPixel(
      levels.map((l) => data.wrapped[l][i]),
      freqs,
    );
    if (steps) out[i] = steps[steps.length - 1].absolute;
  }
  return out;
}

/** Spatial unwrap of the finest level; each row is shifted once so its first valid pixel matches truth (comparison only). */
export function spatialAligned(data: TemporalData): Float64Array {
  const last = data.frequencies.length - 1,
    fine = data.frequencies[last];
  const out = unwrapRows(data.wrapped[last], data.valid, data.width);
  if (!data.truth) return out;
  for (let r = 0; r < data.rows; r++) {
    let shift: number | null = null;
    for (let x = 0; x < data.width; x++) {
      const i = r * data.width + x;
      if (!Number.isFinite(out[i])) continue;
      // Later segments keep their own unknown offset: re-aligning them would hide slips.
      shift ??= TAU * Math.round((TAU * fine * data.truth[i] - out[i]) / TAU);
      out[i] += shift;
    }
  }
  return out;
}

export interface OrderStats {
  errors: number;
  valid: number;
  /** Std of the coarsest level's phase error, rad. */
  coarseNoise: number;
}

/** Count pixels whose fine-level order is off by at least one cycle. */
export function orderErrors(
  data: TemporalData,
  absolute: Float64Array,
): OrderStats {
  if (!data.truth) throw new RangeError("Grading needs synthetic truth");
  let errors = 0,
    valid = 0,
    sq = 0;
  const f0 = data.frequencies[0],
    fine = data.frequencies[data.frequencies.length - 1];
  for (let i = 0; i < absolute.length; i++) {
    if (!Number.isFinite(absolute[i])) continue;
    valid++;
    if (Math.abs(absolute[i] - TAU * fine * data.truth[i]) > Math.PI) errors++;
    const e = data.wrapped[0][i] - TAU * f0 * data.truth[i];
    const d = e - TAU * Math.round(e / TAU);
    sq += d * d;
  }
  return { errors, valid, coarseNoise: valid ? Math.sqrt(sq / valid) : 0 };
}

/** Absolute fine phase → projector column, px. */
export const toProjectorPixel = (absolute: number) =>
  (absolute * PROJECTOR_WIDTH) / (TAU * FINE);
