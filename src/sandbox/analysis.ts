import type { WorldScan } from "./scanner";
import { SURFACE_NAMES, type PcbPin } from "./pcb";

export interface ErrorStats {
  count: number;
  rmse: number;
  mae: number;
  /** Mean signed error; positive means reconstructed farther than truth. */
  bias: number;
  median: number;
  p95: number;
  max: number;
}

export const FAILURE_CAUSES = [
  ["background", "背景（沒有表面）"],
  ["unlit", "Projector 未直接照明"],
  ["clipped", "亮度飽和 clipping"],
  ["lowModulation", "條紋調變過低"],
  ["geometry", "三角量測無效"],
] as const;
export type FailureCause = (typeof FAILURE_CAUSES)[number][0];

export interface SurfaceReport {
  surface: number;
  name: string;
  visible: number;
  valid: number;
  accurate: number;
  stats: ErrorStats | null;
}

export interface PinReport extends PcbPin {
  visible: number;
  valid: number;
  accurate: number;
  status: "success" | "partial" | "failed" | "hidden";
}

export interface ScanAnalysis {
  /** Signed camera-Z error per pixel, NaN where no valid reconstruction. */
  errors: Float64Array;
  tolerance: number;
  overall: ErrorStats | null;
  accurate: number;
  bySurface: SurfaceReport[];
  causes: Record<FailureCause, number>;
  histogram: { range: number; counts: number[] };
  pins: PinReport[] | null;
}

const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];

export function errorStats(errors: ArrayLike<number>): ErrorStats | null {
  const signed = Array.from(errors).filter(Number.isFinite);
  if (!signed.length) return null;
  const abs = signed.map(Math.abs).sort((a, b) => a - b);
  const n = signed.length;
  return {
    count: n,
    rmse: Math.sqrt(signed.reduce((s, e) => s + e * e, 0) / n),
    mae: abs.reduce((s, e) => s + e, 0) / n,
    bias: signed.reduce((s, e) => s + e, 0) / n,
    median: quantile(abs, 0.5),
    p95: quantile(abs, 0.95),
    max: abs[n - 1],
  };
}

/** Evaluation-only summary: reads truth, so it must never feed reconstruction. */
export function analyzeScan(
  scan: WorldScan,
  tolerance: number,
  pins: readonly PcbPin[] | null = null,
  bins = 24,
): ScanAnalysis {
  const { capture, reconstruction } = scan;
  const count = capture.width * capture.height;
  const errors = new Float64Array(count).fill(NaN);
  const causes = Object.fromEntries(
    FAILURE_CAUSES.map(([key]) => [key, 0]),
  ) as Record<FailureCause, number>;
  for (let i = 0; i < count; i++) {
    if (reconstruction.valid[i]) {
      errors[i] = reconstruction.depth[i] - capture.truthDepth[i];
      continue;
    }
    if (!capture.cameraHit[i]) causes.background++;
    else if (capture.clipped[i]) causes.clipped++;
    else if (!reconstruction.phase.valid[i])
      causes[capture.shadowMask[i] ? "unlit" : "lowModulation"]++;
    else causes.geometry++;
  }
  const ok = (i: number) =>
    Number.isFinite(errors[i]) && Math.abs(errors[i]) <= tolerance;
  const bySurface: SurfaceReport[] = [];
  SURFACE_NAMES.forEach((name, surface) => {
    let visible = 0,
      valid = 0,
      accurate = 0;
    const own: number[] = [];
    for (let i = 0; i < count; i++) {
      if (capture.surface[i] !== surface) continue;
      visible++;
      if (!Number.isFinite(errors[i])) continue;
      valid++;
      own.push(errors[i]);
      if (ok(i)) accurate++;
    }
    if (visible)
      bySurface.push({
        surface,
        name,
        visible,
        valid,
        accurate,
        stats: errorStats(own),
      });
  });
  const overall = errorStats(errors);
  let accurate = 0;
  for (let i = 0; i < count; i++) if (ok(i)) accurate++;
  // Symmetric histogram range; values beyond it are folded into the end bins.
  const range = Math.max(tolerance, overall?.p95 ?? 0, 1e-6);
  const counts = new Array<number>(bins).fill(0);
  for (const e of errors) {
    if (!Number.isFinite(e)) continue;
    const t = Math.floor(((e + range) / (2 * range)) * bins);
    counts[Math.max(0, Math.min(bins - 1, t))]++;
  }
  return {
    errors,
    tolerance,
    overall,
    accurate,
    bySurface,
    causes,
    histogram: { range, counts },
    pins: pins
      ? pins.map((pin) => {
          let visible = 0,
            valid = 0,
            good = 0;
          for (let i = 0; i < count; i++) {
            if (capture.pinId[i] !== pin.id) continue;
            visible++;
            if (Number.isFinite(errors[i])) valid++;
            if (ok(i)) good++;
          }
          const status: PinReport["status"] = !visible
            ? "hidden"
            : good >= Math.max(1, visible / 2)
              ? "success"
              : good > 0
                ? "partial"
                : "failed";
          return { ...pin, visible, valid, accurate: good, status };
        })
      : null,
  };
}
