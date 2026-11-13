import { cellCenter, type AoiConfig } from "./rig";
import { REASONS } from "./evaluate";
import { CELL_STATUS } from "./fusion";
import type {
  AoiRun,
  PairRun,
  StrategyResult,
  StrategyScore,
  SweepRow,
} from "./simulate";
import type { ConsistencyEntry } from "./fusion";
import type { PairTheory } from "./sensitivity";
import type { PairInfo } from "./rig";

export const AOI_MODEL = "aoi-multiview-n-step-phase-shifting";
export const AOI_SCHEMA = 1;
export const DISCLAIMER =
  "Simulation of general N-step phase shifting (NOT Micro Phase Shifting). Idealised pinhole calibration, direct illumination only; results are not AOI machine performance. Ground truth is used for evaluation only.";

const cell = (n: number) =>
  Number.isFinite(n) ? String(Number(n.toPrecision(10))) : "";

/** Per-cell CSV in the unified board frame (x = world X, y = world Z, height = world Y, mm). */
export function aoiCsv(
  run: Pick<AoiRun, "grid" | "truth" | "pairs">,
  config: AoiConfig,
  strategies: readonly StrategyResult[],
): string {
  const { grid, truth, pairs } = run;
  const header = [
    "board_x_mm",
    "board_y_mm",
    "truth_height_mm",
    "truth_range_mm",
    "truth_slot",
    ...pairs.flatMap((p) => [
      `h_${p.pair.id}_mm`,
      `sigma_${p.pair.id}_mm`,
      `reason_${p.pair.id}`,
    ]),
    ...strategies.flatMap((s) => [`h_${s.id}_mm`, `status_${s.id}`]),
  ];
  const lines = [
    `# model=${AOI_MODEL}; ${DISCLAIMER}`,
    "# truth_* columns are evaluation-only and never enter reconstruction or fusion",
    "# config=" + JSON.stringify(config),
    header.join(","),
  ];
  for (let c = 0; c < grid.nx * grid.ny; c++) {
    const [x, y] = cellCenter(grid, c);
    lines.push(
      [
        cell(x),
        cell(y),
        cell(truth.mean[c]),
        cell(truth.range[c]),
        truth.slot[c] === 255 ? "" : truth.slot[c],
        ...pairs.flatMap((p) => [
          cell(p.map.height[c]),
          cell(p.map.sigma[c]),
          REASONS[p.evaluation.reasons[c]][0],
        ]),
        ...strategies.flatMap((s) => [
          cell(s.map.height[c]),
          CELL_STATUS[s.map.status[c]][0],
        ]),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

const finite = (n: number) => (Number.isFinite(n) ? n : null);
const stats = (
  s: { rmse: number; mae: number; bias: number; count: number } | null,
) => s && { count: s.count, rmse: s.rmse, mae: s.mae, bias: s.bias };

/** Summary JSON: config, calibration-only theory, simulated metrics; no per-cell arrays. */
export function aoiJson(input: {
  config: AoiConfig;
  theory: { pair: PairInfo; theory: PairTheory }[];
  run: AoiRun | null;
  strategies: { result: StrategyResult; score: StrategyScore }[];
  consistency: ConsistencyEntry[];
  sweep: SweepRow[];
}): string {
  const { config, theory, run, strategies, consistency, sweep } = input;
  const pairResult = (p: PairRun) => ({
    pair: p.pair.id,
    kind: p.pair.kind,
    coverage: p.evaluation.coverage,
    failureRatio: p.evaluation.failureRatio,
    grossCells: p.evaluation.grossCells,
    surfaceCells: p.evaluation.surfaceCells,
    error: stats(p.evaluation.stats),
    flatError: stats(p.evaluation.flatStats),
    bySlot: p.evaluation.bySlot.map((s) => ({ ...s, stats: stats(s.stats) })),
    reasons: Object.fromEntries(
      REASONS.map(([key], i) => [key, p.evaluation.reasonCounts[i]]),
    ),
    timingMs: p.timing,
  });
  return JSON.stringify(
    {
      schemaVersion: AOI_SCHEMA,
      model: AOI_MODEL,
      disclaimer: DISCLAIMER,
      units: { length: "mm", phase: "rad", sensitivity: "rad/mm" },
      frame:
        "board x = world X, board y = world Z, height = world Y (reference plane = 0)",
      config,
      theory: theory.map(({ pair, theory: t }) => ({
        pair: pair.id,
        kind: pair.kind,
        deltaAzimuth: pair.deltaAzimuth,
        cameraTilt: pair.cameraTilt,
        projectorTilt: pair.projectorTilt,
        boardPeriod: t.boardPeriod,
        parallelSensitivity: t.parallelSensitivity,
        geometricSensitivity: t.geometricSensitivity,
        heightPer2Pi: t.heightPer2Pi,
        codingRange: finite(t.codingRange),
        window: t.window.map(finite),
        sigmaHeight: finite(t.sigmaHeight),
        orderErrorProbability: t.orderErrorProbability,
        depthOfField: t.depthOfField.map(finite),
        maxFrequencySingle: t.maxFrequencySingle,
        maxFrequencyDual: t.maxFrequencyDual,
      })),
      simulation: run && {
        grid: run.grid,
        timingMs: run.timing,
        pairs: run.pairs.map(pairResult),
        fusion: strategies.map(({ result, score }) => ({
          strategy: result.id,
          name: result.name,
          pairs: result.pairIds,
          coverage: score.coverage,
          failureRatio: score.failureRatio,
          grossCells: score.grossCells,
          error: stats(score.stats),
          flatError: stats(score.flatStats),
          byStatus: score.byStatus.map((s) => ({
            ...s,
            stats: stats(s.stats),
          })),
          timingMs: result.ms,
        })),
        consistency,
      },
      sweep,
    },
    (_, value) =>
      typeof value === "number" && !Number.isFinite(value) ? null : value,
    2,
  );
}

export function sweepCsv(rows: readonly SweepRow[], variable: string): string {
  const keys = [
    "value",
    "id",
    "kind",
    "rmse",
    "mae",
    "bias",
    "coverage",
    "failureRatio",
    "grossRatio",
    "medianHeight",
    "truthHeight",
    "theoryRange",
    "theorySigma",
    "ms",
  ] as const;
  return (
    [
      `# model=${AOI_MODEL}; sweep variable=${variable}; ${DISCLAIMER}`,
      keys.join(","),
      ...rows.map((r) =>
        keys
          .map((k) => (typeof r[k] === "number" ? cell(r[k] as number) : r[k]))
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}
