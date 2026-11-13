import type { WorldReconstruction } from "../sandbox/scanner";
import { cellOf, type GridSpec } from "./rig";

/** Per-cell height on the unified board grid (truth-free). */
export interface HeightMap {
  /** Median reconstructed world height (Y) of the points in the cell, NaN when empty. */
  height: Float64Array;
  /** Predicted σ of that median, mm. */
  sigma: Float64Array;
  count: Uint16Array;
}

export function binToGrid(
  reconstruction: Pick<WorldReconstruction, "valid" | "points" | "sigmaHeight">,
  grid: GridSpec,
): HeightMap {
  const cells = grid.nx * grid.ny;
  const buckets: number[][] = Array.from({ length: cells }, () => []);
  const variance = new Float64Array(cells);
  const { valid, points, sigmaHeight } = reconstruction;
  for (let i = 0; i < valid.length; i++) {
    if (!valid[i]) continue;
    const cell = cellOf(grid, points[3 * i], points[3 * i + 2]);
    if (cell < 0) continue;
    buckets[cell].push(points[3 * i + 1]);
    variance[cell] += sigmaHeight[i] ** 2;
  }
  const map: HeightMap = {
    height: new Float64Array(cells).fill(NaN),
    sigma: new Float64Array(cells).fill(NaN),
    count: new Uint16Array(cells),
  };
  for (let c = 0; c < cells; c++) {
    const values = buckets[c];
    const n = values.length;
    if (!n) continue;
    values.sort((a, b) => a - b);
    map.height[c] =
      n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2;
    // Median of n samples: efficiency factor √(π/2) on the σ of the mean.
    map.sigma[c] =
      Math.sqrt(Math.PI / 2) * (Math.sqrt(variance[c] / n) / Math.sqrt(n));
    map.count[c] = Math.min(65535, n);
  }
  return map;
}
