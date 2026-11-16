import { solveLinear } from "./linalg";

export interface LmProblem {
  /** Full residual vector for parameters p. */
  residuals: (p: readonly number[]) => Float64Array;
  /** Optional sparsity: residual slice [start, values] that parameter i can change. */
  localResiduals?: (
    p: readonly number[],
    i: number,
  ) => { start: number; values: Float64Array } | null;
  maxIterations?: number;
}

export interface LmResult {
  params: number[];
  cost: number;
  iterations: number;
}

/** Levenberg–Marquardt with forward-difference Jacobian (Marquardt diagonal scaling). */
export function levenbergMarquardt(
  problem: LmProblem,
  initial: readonly number[],
): LmResult {
  const n = initial.length;
  let p = [...initial];
  let r = problem.residuals(p);
  let cost = sumSq(r);
  let lambda = 1e-3;
  let iterations = 0;
  const maxIterations = problem.maxIterations ?? 60;
  for (; iterations < maxIterations; iterations++) {
    const columns: { start: number; values: Float64Array }[] = [];
    for (let i = 0; i < n; i++) {
      const h = 1e-6 * Math.max(1, Math.abs(p[i]));
      const q = [...p];
      q[i] += h;
      const local = problem.localResiduals?.(q, i);
      const start = local ? local.start : 0;
      const values = local ? local.values : problem.residuals(q);
      const d = new Float64Array(values.length);
      for (let k = 0; k < values.length; k++)
        d[k] = (values[k] - r[start + k]) / h;
      columns.push({ start, values: d });
    }
    const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const g = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const ci = columns[i];
      let s = 0;
      for (let k = 0; k < ci.values.length; k++)
        s += ci.values[k] * r[ci.start + k];
      g[i] = s;
      for (let j = i; j < n; j++) {
        const cj = columns[j];
        const lo = Math.max(ci.start, cj.start),
          hi = Math.min(
            ci.start + ci.values.length,
            cj.start + cj.values.length,
          );
        let t = 0;
        for (let k = lo; k < hi; k++)
          t += ci.values[k - ci.start] * cj.values[k - cj.start];
        A[i][j] = A[j][i] = t;
      }
    }
    let accepted = false;
    for (let attempt = 0; attempt < 12 && !accepted; attempt++) {
      const damped = A.map((row, i) =>
        row.map((v, j) => (i === j ? v + lambda * (v + 1e-12) : v)),
      );
      const delta = solveLinear(
        damped,
        g.map((v) => -v),
      );
      if (!delta) {
        lambda *= 10;
        continue;
      }
      const next = p.map((v, i) => v + delta[i]);
      const rNext = problem.residuals(next);
      const costNext = sumSq(rNext);
      if (Number.isFinite(costNext) && costNext < cost) {
        const improvement = (cost - costNext) / Math.max(cost, 1e-300);
        p = next;
        r = rNext;
        cost = costNext;
        lambda = Math.max(lambda / 10, 1e-12);
        accepted = true;
        if (improvement < 1e-12)
          return { params: p, cost, iterations: iterations + 1 };
      } else lambda *= 10;
    }
    if (!accepted) break;
  }
  return { params: p, cost, iterations };
}

export function sumSq(r: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i] * r[i];
  return s;
}
