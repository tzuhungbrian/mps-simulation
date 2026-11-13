import type { PairClass } from "./rig";

/** One pair's height map as fusion sees it: measurements and predicted noise only. */
export interface FusionSource {
  id: string;
  kind: PairClass;
  height: Float64Array;
  sigma: Float64Array;
}

export const CELL_STATUS = [
  ["none", "無資料"],
  ["single", "僅單一 Pair"],
  ["consistent", "多 Pair 一致"],
  ["conflict", "Pair 間矛盾（已剔除離群）"],
] as const;
export const STATUS = {
  none: 0,
  single: 1,
  consistent: 2,
  conflict: 3,
} as const;

export interface FusedMap {
  height: Float64Array;
  sigma: Float64Array;
  /** Pairs that contributed to the fused value. */
  support: Uint8Array;
  /** Pairs with any value in the cell. */
  sources: Uint8Array;
  status: Uint8Array;
  /** max − min over all pair values in the cell, mm. */
  spread: Float64Array;
  /** Index into `labels` of the source group used for the cell, 255 = none. */
  origin: Uint8Array;
  labels: string[];
}

const SIGMA_FLOOR = 1e-4;

/**
 * Consensus fusion per cell: the candidate value with the most agreeing pairs
 * (|Δh| ≤ max(tolerance, 3σ)) wins, ties go to the smaller σ; inliers are then
 * averaged with 1/σ² weights. Truth never enters.
 */
export function robustFuse(
  sources: readonly FusionSource[],
  tolerance: number,
  label = "fused",
): FusedMap {
  const cells = sources[0]?.height.length ?? 0;
  const map = emptyMap(cells, [label]);
  const values: number[] = [],
    sigmas: number[] = [];
  for (let c = 0; c < cells; c++) {
    values.length = 0;
    sigmas.length = 0;
    for (const s of sources)
      if (Number.isFinite(s.height[c])) {
        values.push(s.height[c]);
        sigmas.push(
          Math.max(SIGMA_FLOOR, Number.isFinite(s.sigma[c]) ? s.sigma[c] : 1),
        );
      }
    const n = values.length;
    map.sources[c] = n;
    if (!n) continue;
    map.origin[c] = 0;
    if (n === 1) {
      map.height[c] = values[0];
      map.sigma[c] = sigmas[0];
      map.support[c] = 1;
      map.spread[c] = 0;
      map.status[c] = STATUS.single;
      continue;
    }
    const gate = (i: number, j: number) =>
      Math.max(tolerance, 3 * sigmas[i], 3 * sigmas[j]);
    let best = 0,
      bestCount = -1;
    for (let i = 0; i < n; i++) {
      let agree = 0;
      for (let j = 0; j < n; j++)
        if (Math.abs(values[i] - values[j]) <= gate(i, j)) agree++;
      if (
        agree > bestCount ||
        (agree === bestCount && sigmas[i] < sigmas[best])
      ) {
        best = i;
        bestCount = agree;
      }
    }
    let weight = 0,
      sum = 0,
      lo = Infinity,
      hi = -Infinity;
    for (let j = 0; j < n; j++) {
      lo = Math.min(lo, values[j]);
      hi = Math.max(hi, values[j]);
      if (Math.abs(values[best] - values[j]) > gate(best, j)) continue;
      const w = 1 / sigmas[j] ** 2;
      weight += w;
      sum += w * values[j];
    }
    map.height[c] = sum / weight;
    map.sigma[c] = 1 / Math.sqrt(weight);
    map.support[c] = bestCount;
    map.spread[c] = hi - lo;
    map.status[c] = bestCount === n ? STATUS.consistent : STATUS.conflict;
  }
  return map;
}

function emptyMap(cells: number, labels: string[]): FusedMap {
  return {
    height: new Float64Array(cells).fill(NaN),
    sigma: new Float64Array(cells).fill(NaN),
    support: new Uint8Array(cells),
    sources: new Uint8Array(cells),
    status: new Uint8Array(cells),
    spread: new Float64Array(cells).fill(NaN),
    origin: new Uint8Array(cells).fill(255),
    labels,
  };
}

/** Strategy 1 — 直視 + 斜視: keep the direct-view result, fill its holes from the oblique fusion. */
export function fuseDirectWithOblique(
  direct: readonly FusionSource[],
  oblique: readonly FusionSource[],
  tolerance: number,
): FusedMap {
  const base = robustFuse(direct, tolerance),
    fill = robustFuse(oblique, tolerance);
  const cells = Math.max(base.height.length, fill.height.length);
  const map = emptyMap(cells, ["直視", "斜視補洞"]);
  for (let c = 0; c < cells; c++) {
    const from = Number.isFinite(base.height[c])
      ? base
      : Number.isFinite(fill.height[c])
        ? fill
        : null;
    if (!from) continue;
    map.height[c] = from.height[c];
    map.sigma[c] = from.sigma[c];
    map.support[c] = from.support[c];
    map.sources[c] = from.sources[c];
    map.status[c] = from.status[c];
    map.spread[c] = from.spread[c];
    map.origin[c] = from === base ? 0 : 1;
  }
  return map;
}

/** Strategy 2 — 單一斜視: one pair on its own, e.g. for a feature only it sees well. */
export function singlePair(source: FusionSource): FusedMap {
  return robustFuse([source], Infinity, source.id);
}

/** Strategy 3 — 斜視 + 斜視: consensus fusion of oblique pairs from different directions. */
export const fuseOblique = (
  oblique: readonly FusionSource[],
  tolerance: number,
) => robustFuse(oblique, tolerance, "斜視融合");

export interface ConsistencyEntry {
  a: string;
  b: string;
  common: number;
  /** RMS of h_a − h_b over common cells, mm. */
  rms: number;
  medianAbs: number;
  /** Fraction of common cells with |h_a − h_b| > tolerance. */
  conflictRatio: number;
}

/** Cross-pair consistency: how much two pairs disagree where both measured. Truth-free. */
export function consistencyMatrix(
  sources: readonly FusionSource[],
  tolerance: number,
): ConsistencyEntry[] {
  const entries: ConsistencyEntry[] = [];
  for (let i = 0; i < sources.length; i++)
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i].height,
        b = sources[j].height,
        diffs: number[] = [];
      for (let c = 0; c < a.length; c++)
        if (Number.isFinite(a[c]) && Number.isFinite(b[c]))
          diffs.push(Math.abs(a[c] - b[c]));
      diffs.sort((x, y) => x - y);
      entries.push({
        a: sources[i].id,
        b: sources[j].id,
        common: diffs.length,
        rms: diffs.length
          ? Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length)
          : NaN,
        medianAbs: diffs.length
          ? diffs[Math.floor((diffs.length - 1) / 2)]
          : NaN,
        conflictRatio: diffs.length
          ? diffs.filter((d) => d > tolerance).length / diffs.length
          : NaN,
      });
    }
  return entries;
}
