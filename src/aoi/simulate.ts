import { buildTraceScene } from "../sandbox/lightTransport";
import type { ErrorStats } from "../sandbox/analysis";
import { errorStats } from "../sandbox/analysis";
import {
  cameraPinhole,
  enumeratePairs,
  makeGrid,
  projectorPinhole,
  validateAoiConfig,
  type AoiConfig,
  type GridSpec,
  type PairClass,
  type PairInfo,
} from "./rig";
import { pairTheory, type PairTheory } from "./sensitivity";
import { buildAoiScene } from "./scene";
import { pairSeed, renderPair, traceCamera, type CameraTrace } from "./render";
import {
  binToGrid,
  codingOf,
  reconstructPair,
  type HeightMap,
} from "./reconstruct";
import {
  buildTruthMap,
  evaluatePair,
  scoreHeightMap,
  type HeightScore,
  type PairEvaluation,
  type TruthMap,
} from "./evaluate";
import {
  CELL_STATUS,
  consistencyMatrix,
  fuseDirectWithOblique,
  fuseOblique,
  singlePair,
  type ConsistencyEntry,
  type FusedMap,
  type FusionSource,
} from "./fusion";

const now = () => performance.now();

export interface PairRun {
  pair: PairInfo;
  theory: PairTheory;
  map: HeightMap;
  /** Valid reconstructed world points (x, y, z) in mm. */
  points: Float32Array;
  image: {
    width: number;
    height: number;
    frame: Float32Array;
    modulation: Float32Array;
    valid: Uint8Array;
  };
  evaluation: PairEvaluation;
  timing: {
    /** Camera ray tracing, shared by all pairs of the same camera. */
    traceMs: number;
    renderMs: number;
    reconstructMs: number;
    evaluateMs: number;
  };
}

export interface AoiRun {
  config: AoiConfig;
  grid: GridSpec;
  truth: TruthMap;
  pairs: PairRun[];
  timing: { sceneMs: number; truthMs: number; totalMs: number };
}

/** Calibration-only characterisation of every pair (no scene, no truth). */
export function theoryForAll(config: AoiConfig) {
  validateAoiConfig(config);
  const cameras = config.cameras.map((d) =>
      cameraPinhole(d, config.cameraWidth),
    ),
    projectors = config.projectors.map((d) =>
      projectorPinhole(d, config.projectorWidth),
    );
  return enumeratePairs(config).map((pair) => ({
    pair,
    theory: pairTheory(
      config,
      pair,
      cameras[pair.cameraIndex],
      projectors[pair.projectorIndex],
    ),
  }));
}

export function runAoi(
  config: AoiConfig,
  pairIds: readonly string[] | null = null,
  onProgress?: (fraction: number, label: string) => void,
): AoiRun {
  const start = now();
  const theories = theoryForAll(config);
  const selected = theories.filter(
    ({ pair }) => !pairIds || pairIds.includes(pair.id),
  );
  if (!selected.length) throw new RangeError("No pair selected");
  const grid = makeGrid(config);
  const world = buildAoiScene(config);
  const scene = buildTraceScene(world.meshes);
  const sceneMs = now() - start;
  try {
    const t0 = now();
    const truth = buildTruthMap(scene, grid);
    const truthMs = now() - t0;
    const coding = codingOf(config);
    const traces = new Map<number, { trace: CameraTrace; ms: number }>();
    const pairs: PairRun[] = [];
    selected.forEach(({ pair, theory }, index) => {
      onProgress?.(index / selected.length, pair.id);
      const cameraDevice = config.cameras[pair.cameraIndex],
        projectorDevice = config.projectors[pair.projectorIndex],
        camera = cameraPinhole(cameraDevice, config.cameraWidth),
        projector = projectorPinhole(projectorDevice, config.projectorWidth);
      let cached = traces.get(pair.cameraIndex);
      if (!cached) {
        const t = now();
        const trace = traceCamera(scene, camera, config.pixelGrid);
        cached = { trace, ms: now() - t };
        traces.set(pair.cameraIndex, cached);
      }
      let t = now();
      const captures = renderPair(
        scene,
        cached.trace,
        camera,
        projector,
        cameraDevice,
        projectorDevice,
        config,
        pairSeed(config.seed, pair.cameraIndex, pair.projectorIndex),
      );
      const renderMs = now() - t;
      t = now();
      // Explicit field-only payload: truth and visibility never cross this boundary.
      const reconstruction = reconstructPair(
        {
          width: captures.width,
          height: captures.height,
          frames: captures.frames,
          clipped: captures.clipped,
        },
        camera,
        projector,
        coding,
      );
      const map = binToGrid(reconstruction, grid);
      const reconstructMs = now() - t;
      t = now();
      const evaluation = evaluatePair(
        scene,
        grid,
        truth,
        map,
        reconstruction,
        captures.clipped,
        camera,
        projector,
        cameraDevice,
        projectorDevice,
        config,
      );
      const evaluateMs = now() - t;
      const points = new Float32Array(3 * reconstruction.validCount);
      let k = 0;
      for (let i = 0; i < reconstruction.valid.length; i++)
        if (reconstruction.valid[i]) {
          points.set(reconstruction.points.subarray(3 * i, 3 * i + 3), 3 * k);
          k++;
        }
      pairs.push({
        pair,
        theory,
        map,
        points,
        image: {
          width: captures.width,
          height: captures.height,
          frame: Float32Array.from(captures.frames[0]),
          modulation: Float32Array.from(reconstruction.modulation),
          valid: reconstruction.valid,
        },
        evaluation,
        timing: { traceMs: cached.ms, renderMs, reconstructMs, evaluateMs },
      });
    });
    onProgress?.(1, "");
    return {
      config,
      grid,
      truth,
      pairs,
      timing: { sceneMs, truthMs, totalMs: now() - start },
    };
  } finally {
    scene.dispose();
    world.dispose();
  }
}

export interface FusionOptions {
  direct: string[];
  oblique: string[];
  single: string | null;
}

export function defaultFusionOptions(
  pairs: readonly PairInfo[],
): FusionOptions {
  const oblique = pairs.filter((p) => p.kind !== "direct");
  return {
    direct: pairs.filter((p) => p.kind === "direct").map((p) => p.id),
    oblique: oblique.map((p) => p.id),
    single:
      (oblique.find((p) => p.kind === "opposite") ?? oblique[0])?.id ?? null,
  };
}

export const STRATEGIES = [
  ["directOblique", "① 直視 + 斜視補洞"],
  ["single", "② 單一斜視"],
  ["oblique", "③ 斜視 + 斜視融合"],
] as const;
export type StrategyId = (typeof STRATEGIES)[number][0];

export interface StrategyResult {
  id: StrategyId;
  name: string;
  map: FusedMap;
  pairIds: string[];
  ms: number;
}

const sourceOf = (run: Pick<PairRun, "pair" | "map">): FusionSource => ({
  id: run.pair.id,
  kind: run.pair.kind,
  height: run.map.height,
  sigma: run.map.sigma,
});

/** Run the three strategies on whichever pairs have results. Inputs are height maps only. */
export function runStrategies(
  pairs: readonly Pick<PairRun, "pair" | "map">[],
  options: FusionOptions,
  tolerance: number,
): { strategies: StrategyResult[]; consistency: ConsistencyEntry[] } {
  const pick = (ids: readonly string[]) =>
    pairs.filter((p) => ids.includes(p.pair.id)).map(sourceOf);
  const direct = pick(options.direct),
    oblique = pick(options.oblique),
    single = options.single ? pick([options.single]) : [];
  const strategies: StrategyResult[] = [];
  const time = (id: StrategyId, ids: string[], build: () => FusedMap) => {
    const t = now();
    const map = build();
    strategies.push({
      id,
      name: STRATEGIES.find(([k]) => k === id)![1],
      map,
      pairIds: ids,
      ms: now() - t,
    });
  };
  if (direct.length || oblique.length)
    time(
      "directOblique",
      [...direct, ...oblique].map((s) => s.id),
      () => fuseDirectWithOblique(direct, oblique, tolerance),
    );
  if (single.length)
    time("single", [single[0].id], () => singlePair(single[0]));
  if (oblique.length)
    time(
      "oblique",
      oblique.map((s) => s.id),
      () => fuseOblique(oblique, tolerance),
    );
  return {
    strategies,
    consistency: consistencyMatrix(pairs.map(sourceOf), tolerance),
  };
}

export interface StrategyScore extends HeightScore {
  errors: Float64Array;
  /** Does the truth-free consistency status predict the actual error? */
  byStatus: {
    status: number;
    name: string;
    cells: number;
    stats: ErrorStats | null;
  }[];
}

/** Evaluation only. Gross threshold: half the smallest Δh per 2π among contributing pairs. */
export function scoreStrategy(
  result: StrategyResult,
  pairs: readonly Pick<PairRun, "pair" | "theory">[],
  truth: TruthMap,
  tolerance: number,
): StrategyScore {
  const per2Pi = Math.min(
    ...pairs
      .filter((p) => result.pairIds.includes(p.pair.id))
      .map((p) => p.theory.heightPer2Pi),
  );
  const score = scoreHeightMap(result.map.height, truth, tolerance, per2Pi / 2);
  return {
    ...score,
    byStatus: CELL_STATUS.map(([, name], status) => {
      const own: number[] = [];
      for (let c = 0; c < score.errors.length; c++)
        if (result.map.status[c] === status && Number.isFinite(score.errors[c]))
          own.push(score.errors[c]);
      return { status, name, cells: own.length, stats: errorStats(own) };
    }).filter((s) => s.status > 0),
  };
}

export const SWEEP_VARIABLES = [
  ["fringeFrequency", "細條紋頻率 f₁（週期數）"],
  ["periodRatio", "週期比 p₂/p₁（雙週期）"],
  ["noiseSigma", "Camera 雜訊 σ"],
  ["planeHeight", "平面高度 mm（平面場景）"],
  ["windowBottom", "相位視窗底部 mm"],
] as const;
export type SweepVariable = (typeof SWEEP_VARIABLES)[number][0];

export interface SweepRow {
  value: number;
  id: string;
  kind: PairClass | "fusion";
  rmse: number;
  mae: number;
  bias: number;
  coverage: number;
  failureRatio: number;
  grossRatio: number;
  /** Median measured height over measured cells, mm. */
  medianHeight: number;
  /** Median truth height over surface cells (evaluation), mm. */
  truthHeight: number;
  theoryRange: number;
  theorySigma: number;
  ms: number;
}

const median = (values: ArrayLike<number>) => {
  const v = Array.from(values)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : NaN;
};

/** Batch comparison: rerun the selected pairs and the three strategies for each value. */
export function runSweep(
  config: AoiConfig,
  pairIds: readonly string[] | null,
  variable: SweepVariable,
  values: readonly number[],
  options: FusionOptions,
  onProgress?: (fraction: number, label: string) => void,
): SweepRow[] {
  const rows: SweepRow[] = [];
  values.forEach((value, index) => {
    const variant = { ...config, [variable]: value };
    const run = runAoi(variant, pairIds, (f, label) =>
      onProgress?.(
        (index + f) / values.length,
        `${variable}=${value} · ${label}`,
      ),
    );
    const truthHeight = median(run.truth.mean);
    for (const p of run.pairs) {
      const e = p.evaluation;
      rows.push({
        value,
        id: p.pair.id,
        kind: p.pair.kind,
        rmse: e.stats?.rmse ?? NaN,
        mae: e.stats?.mae ?? NaN,
        bias: e.stats?.bias ?? NaN,
        coverage: e.coverage,
        failureRatio: e.failureRatio,
        grossRatio: e.surfaceCells ? e.grossCells / e.surfaceCells : NaN,
        medianHeight: median(p.map.height),
        truthHeight,
        theoryRange: p.theory.codingRange,
        theorySigma: p.theory.sigmaHeight,
        ms: p.timing.renderMs + p.timing.reconstructMs,
      });
    }
    const { strategies } = runStrategies(
      run.pairs,
      options,
      variant.consistencyTolerance,
    );
    for (const s of strategies) {
      const score = scoreStrategy(s, run.pairs, run.truth, variant.tolerance);
      rows.push({
        value,
        id: s.name,
        kind: "fusion",
        rmse: score.stats?.rmse ?? NaN,
        mae: score.stats?.mae ?? NaN,
        bias: score.stats?.bias ?? NaN,
        coverage: score.coverage,
        failureRatio: score.failureRatio,
        grossRatio: score.surfaceCells
          ? score.grossCells / score.surfaceCells
          : NaN,
        medianHeight: median(s.map.height),
        truthHeight,
        theoryRange: NaN,
        theorySigma: NaN,
        ms: s.ms,
      });
    }
  });
  onProgress?.(1, "");
  return rows;
}
