import { useEffect, useMemo, useRef, useState } from "react";
import { Box, FileJson, Play, Sheet } from "lucide-react";
import { Field, Tabs } from "../sandbox/controls";
import { InfoHeading } from "../sandbox/Info";
import { downloadBlob } from "../lib/images";
import {
  WORLD_LIMITS,
  validateWorldConfig,
  type NumericKey,
  type WorldConfig,
} from "../sandbox/scanner";
import { SURFACE_NAMES } from "../sandbox/pcb";
import type { OverlayCloud } from "../sandbox/WorldView";
import {
  cellCenter,
  enumeratePairs,
  PAIR_CLASS_NAMES,
  PAIR_CLASSES,
  type GridSpec,
} from "./rig";
import { REASONS, type TruthMap } from "./evaluate";
import {
  defaultFusionOptions,
  runStrategies,
  scoreStrategy,
  strategyLabel,
  SWEEP_VARIABLES,
  theoryForAll,
  type FusionOptions,
  type PairRun,
  type SweepRow,
  type SweepVariable,
} from "./simulate";
import { aoiCsv, aoiJson, sweepCsv } from "./export";
import type { AoiRequest, AoiResponse } from "./aoi.worker";
import { t } from "../i18n";
import "./aoi.css";

/** Inputs that change a multi-view run; the active pair, GI and analysis-only gates do not. */
const simulationKey = (c: WorldConfig) => {
  const {
    references: _r,
    targetRange: _t,
    consistencyTolerance: _c,
    activeCamera: _a,
    activeProjector: _p,
    interreflection: _i,
    bounces: _b,
    giSamples: _g,
    ...rest
  } = c;
  return JSON.stringify(rest);
};

const fmt = (n: number, d = 3) =>
  Number.isFinite(n)
    ? n.toFixed(d)
    : n === Infinity
      ? "∞"
      : n === -Infinity
        ? "−∞"
        : "—";
const um = (mm: number) =>
  Number.isFinite(mm) ? `${(mm * 1000).toFixed(1)}` : "—";
const pct = (x: number) =>
  Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : "—";

const STATUS_COLORS = ["#0b121c", "#e8d36a", "#5ee4bd", "#ff5c8a"];
const ORIGIN_COLORS = ["#7cc4ff", "#ffb86b"];
type MapMode = "reason" | "height" | "error" | "status" | "spread" | "origin";

function GridMap({
  grid,
  values,
  mode,
  range,
  testId,
  label,
}: {
  grid: GridSpec;
  values: ArrayLike<number>;
  mode: MapMode;
  /** height: [lo, hi]; error/spread: [0, scale]. */
  range?: [number, number];
  testId?: string;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = grid.nx;
    canvas.height = grid.ny;
    const image = ctx.createImageData(grid.nx, grid.ny);
    const hex = (h: string) =>
      [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [lo, hi] = range ?? [0, 1];
    for (let c = 0; c < grid.nx * grid.ny; c++) {
      const v = values[c];
      let rgb: number[];
      if (mode === "reason") rgb = hex(REASONS[v]?.[2] ?? "#000000");
      else if (mode === "status") rgb = hex(STATUS_COLORS[v] ?? "#000000");
      else if (mode === "origin")
        rgb = v === 255 ? [11, 18, 28] : hex(ORIGIN_COLORS[v] ?? "#ffffff");
      else if (!Number.isFinite(v)) rgb = [11, 18, 28];
      else if (mode === "height") {
        const t = Math.min(1, Math.max(0, (v - lo) / Math.max(1e-9, hi - lo)));
        rgb = [
          40 + 215 * t,
          60 + 150 * (1 - Math.abs(t - 0.5) * 2),
          230 - 200 * t,
        ];
      } else if (mode === "error") {
        const t = Math.max(-1, Math.min(1, v / Math.max(1e-9, hi)));
        rgb = [128 + 127 * t, 128 - 90 * Math.abs(t), 128 - 127 * t];
      } else {
        const t = Math.min(1, v / Math.max(1e-9, hi));
        rgb = [30 + 225 * t, 200 - 150 * t, 120 - 100 * t];
      }
      image.data.set([...rgb, 255], c * 4);
    }
    ctx.putImageData(image, 0, 0);
  }, [grid, values, mode, range]);
  return (
    <figure className="aoi-map">
      <canvas
        ref={ref}
        data-testid={testId}
        aria-label={label}
        style={{ aspectRatio: `${grid.nx} / ${grid.ny}` }}
      />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function ImageCanvas({
  values,
  width,
  height,
  label,
  gain = 1,
}: {
  values: Float32Array;
  width: number;
  height: number;
  label: string;
  gain?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = width;
    canvas.height = height;
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < values.length; i++) {
      const g = Math.round(255 * Math.min(1, Math.max(0, values[i] * gain)));
      image.data.set([g, g, g, 255], 4 * i);
    }
    ctx.putImageData(image, 0, 0);
  }, [values, width, height, gain]);
  return (
    <figure className="aoi-map">
      <canvas
        ref={ref}
        aria-label={label}
        style={{ aspectRatio: `${width} / ${height}` }}
      />
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function OptionalNumber({
  value,
  label,
  onChange,
}: {
  value: number | null;
  label: string;
  onChange: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      aria-label={label}
      className="aoi-number"
      placeholder={t("未提供", "Not provided")}
      min={0}
      value={draft ?? (value === null ? "" : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        const text = e.target.value.trim(),
          v = Number(text);
        onChange(
          text === ""
            ? null
            : Number.isFinite(v) && v >= 0 && v <= 1000
              ? v
              : value,
        );
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function Histogram({
  errors,
  scale,
  label,
}: {
  errors: Float64Array;
  scale: number;
  label: string;
}) {
  const bins = 31;
  const counts = new Array<number>(bins).fill(0);
  let outside = 0;
  for (const e of errors) {
    if (!Number.isFinite(e)) continue;
    const t = Math.floor(((e + scale) / (2 * scale)) * bins);
    if (t < 0 || t >= bins) outside++;
    else counts[t]++;
  }
  const peak = Math.max(1, ...counts);
  return (
    <figure className="aoi-histogram">
      <svg viewBox={`0 0 ${bins * 10} 60`} role="img" aria-label={label}>
        {counts.map((n, i) => (
          <rect
            key={i}
            x={i * 10 + 1}
            width={8}
            y={60 - (58 * n) / peak}
            height={(58 * n) / peak}
            fill={i === (bins - 1) / 2 ? "#8de2c6" : "#5b8db8"}
          />
        ))}
      </svg>
      <figcaption>
        {t(
          <>
            {label}：±{fmt(scale, 3)} mm，範圍外 {outside} 格
          </>,
          <>
            {label}: ±{fmt(scale, 3)} mm, {outside} cells out of range
          </>,
        )}
      </figcaption>
    </figure>
  );
}

const MAIN_TABS = [
  ["range", t("Pair 與量測範圍", "Pairs and measurement range")],
  ["maps", t("有效量測圖", "Valid-measurement maps")],
  ["fusion", "Fusion"],
  ["bench", "Benchmark"],
] as const;

interface Results {
  key: string;
  config: WorldConfig;
  grid: GridSpec;
  truth: TruthMap;
  pairs: PairRun[];
  timing: { sceneMs: number; truthMs: number; totalMs: number };
}

/** Multi-view analysis of the sandbox scene: every camera × projector pair, range theory, fusion. */
export default function MultiViewPage({
  config,
  update,
  onShow,
}: {
  config: WorldConfig;
  update: (patch: Partial<WorldConfig>) => void;
  /** Activate a pair and/or overlay a point cloud in the 3D sandbox view. */
  onShow: (
    overlay: (OverlayCloud & { label: string }) | null,
    pair?: { cameraId: string; projectorId: string },
  ) => void;
}) {
  const [results, setResults] = useState<Results | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [status, setStatus] = useState(
      t(
        "尚未執行多視角模擬；理論值已依目前設定即時計算。",
        "Multi-view simulation not run yet; theory values update live with the current settings.",
      ),
    ),
    [message, setMessage] = useState(""),
    [mainTab, setMainTab] = useState<(typeof MAIN_TABS)[number][0]>("range"),
    [selected, setSelected] = useState<Set<string> | null>(null),
    [focus, setFocus] = useState<string | null>(null),
    [fusionChoice, setFusionChoice] = useState<FusionOptions | null>(null),
    [strategyFocus, setStrategyFocus] = useState<string>("oblique"),
    [sweepVariable, setSweepVariable] =
      useState<SweepVariable>("fringeFrequency"),
    [sweepValues, setSweepValues] = useState("8, 12, 16, 24, 32"),
    [sweep, setSweep] = useState<{
      variable: SweepVariable;
      rows: SweepRow[];
    } | null>(null);
  const worker = useRef<Worker | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      worker.current?.terminate();
    },
    [],
  );

  const reference = config.referenceHeight;
  const pairs = useMemo(() => enumeratePairs(config), [config]);
  const theory = useMemo(() => {
    try {
      return theoryForAll(config);
    } catch {
      return [];
    }
  }, [config]);
  const key = useMemo(() => simulationKey(config), [config]);
  const stale = !!results && results.key !== key;
  const chosen = useMemo(
    () =>
      selected
        ? pairs.filter((p) => selected.has(p.id)).map((p) => p.id)
        : pairs.map((p) => p.id),
    [selected, pairs],
  );
  const runById = useMemo(
    () => new Map(results?.pairs.map((p) => [p.pair.id, p]) ?? []),
    [results],
  );
  const focusRun = (focus && runById.get(focus)) || results?.pairs[0] || null;

  const startWorker = (
    request: AoiRequest,
    onDone: (reply: AoiResponse) => void,
  ) => {
    const token = ++generation.current;
    worker.current?.terminate();
    const next = new Worker(new URL("./aoi.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = next;
    setBusy(true);
    setProgress(0);
    next.onmessage = (event: MessageEvent<AoiResponse>) => {
      if (token !== generation.current) return;
      const reply = event.data;
      if (reply.type === "progress") {
        setProgress(reply.fraction);
        if (reply.label)
          setStatus(
            t(
              `多視角模擬中：${reply.label}`,
              `Running multi-view simulation: ${reply.label}`,
            ),
          );
        return;
      }
      next.terminate();
      worker.current = null;
      setBusy(false);
      if (reply.type === "error") {
        setStatus(
          t(
            "多視角模擬失敗，沒有用真值補出結果。",
            "Multi-view simulation failed; no results were filled in from ground truth.",
          ),
        );
        setMessage(reply.message);
      } else onDone(reply);
    };
    next.onerror = (event) => {
      if (token !== generation.current) return;
      setBusy(false);
      setStatus(t("多視角模擬失敗。", "Multi-view simulation failed."));
      setMessage(event.message || t("Worker 錯誤", "Worker error"));
    };
    next.postMessage(request);
  };

  const runPairs = (ids: string[]) => {
    if (!ids.length)
      return setMessage(
        t("請至少選擇一組 Pair。", "Select at least one pair."),
      );
    const snapshot = config,
      snapshotKey = key;
    setStatus(
      t(
        `多視角模擬中：${ids.length} 組 Pair…`,
        `Running multi-view simulation: ${ids.length} pairs…`,
      ),
    );
    startWorker({ type: "run", config: snapshot, pairIds: ids }, (reply) => {
      if (reply.type !== "run") return;
      const run = reply.run;
      setResults((previous) => {
        // Same simulation inputs: merge so single-pair runs accumulate.
        const kept =
          previous && previous.key === snapshotKey
            ? previous.pairs.filter((p) => !ids.includes(p.pair.id))
            : [];
        const order = enumeratePairs(snapshot).map((p) => p.id);
        return {
          key: snapshotKey,
          config: snapshot,
          grid: run.grid,
          truth: run.truth,
          pairs: [...kept, ...run.pairs].sort(
            (a, b) => order.indexOf(a.pair.id) - order.indexOf(b.pair.id),
          ),
          timing: run.timing,
        };
      });
      setFocus((f) => f ?? run.pairs[0]?.pair.id ?? null);
      setStatus(
        t(
          `完成 ${run.pairs.length} 組 Pair（${(run.timing.totalMs / 1000).toFixed(1)} s，Worker 內模擬時間）。`,
          `Finished ${run.pairs.length} pairs (${(run.timing.totalMs / 1000).toFixed(1)} s of simulation time in the worker).`,
        ),
      );
    });
  };

  const fusionOptions = useMemo(() => {
    const ids = new Set(pairs.map((p) => p.id));
    const base = fusionChoice ?? defaultFusionOptions(pairs);
    return {
      direct: base.direct.filter((id) => ids.has(id)),
      oblique: base.oblique.filter((id) => ids.has(id)),
      single:
        base.single && ids.has(base.single)
          ? base.single
          : defaultFusionOptions(pairs).single,
    };
  }, [fusionChoice, pairs]);

  const runSweep = () => {
    const values = sweepValues
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);
    if (!values.length || values.length > 24)
      return setMessage(
        t(
          "請輸入 1–24 個數值，以逗號分隔。",
          "Enter 1–24 comma-separated values.",
        ),
      );
    for (const value of values)
      try {
        validateWorldConfig({ ...config, [sweepVariable]: value });
      } catch (error) {
        return setMessage(
          t(
            `數值 ${value} 無效：${error instanceof Error ? error.message : error}`,
            `Invalid value ${value}: ${error instanceof Error ? error.message : error}`,
          ),
        );
      }
    const variable = sweepVariable;
    setStatus(t("批次比較中…", "Running batch comparison…"));
    startWorker(
      {
        type: "sweep",
        config,
        pairIds: chosen,
        variable,
        values,
        options: fusionOptions,
      },
      (reply) => {
        if (reply.type !== "sweep") return;
        setSweep({ variable, rows: reply.rows });
        setStatus(
          t(
            `批次比較完成：${values.length} 個數值 × ${chosen.length} 組 Pair。`,
            `Batch comparison done: ${values.length} values × ${chosen.length} pairs.`,
          ),
        );
      },
    );
  };

  const fusion = useMemo(() => {
    if (!results) return null;
    const { strategies, consistency } = runStrategies(
      results.pairs,
      fusionOptions,
      config.consistencyTolerance,
    );
    return {
      consistency,
      strategies: strategies.map((result) => ({
        result,
        score: scoreStrategy(
          result,
          results.pairs,
          results.truth,
          results.config.tolerance,
        ),
      })),
    };
  }, [results, fusionOptions, config.consistencyTolerance]);
  const strategy =
    fusion?.strategies.find((s) => s.result.id === strategyFocus) ??
    fusion?.strategies[0] ??
    null;

  /** Display heights relative to the reference plane of the run. */
  const runReference = results?.config.referenceHeight ?? reference;
  const heightRange = useMemo<[number, number]>(() => {
    if (!results) return [0, 1];
    let lo = Infinity,
      hi = -Infinity;
    for (const v of results.truth.mean)
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    const ref = results.config.referenceHeight;
    return Number.isFinite(lo)
      ? [lo - ref, Math.max(hi, lo + 0.1) - ref]
      : [0, 1];
  }, [results]);
  const errorScale = useMemo<[number, number]>(
    () => [0, Math.max(config.tolerance * 2, 0.01)],
    [config.tolerance],
  );
  const focusHeights = useMemo(
    () => focusRun?.map.height.map((v) => v - runReference) ?? null,
    [focusRun, runReference],
  );
  const strategyHeights = useMemo(
    () => strategy?.result.map.height.map((v) => v - runReference) ?? null,
    [strategy, runReference],
  );
  const worldRange = (): [number, number] => [
    heightRange[0] + runReference,
    heightRange[1] + runReference,
  ];

  const classSummary = PAIR_CLASSES.map((kind) => {
    const list = theory.filter((t) => t.pair.kind === kind);
    const runs = list
      .map((t) => runById.get(t.pair.id))
      .filter((r): r is PairRun => !!r);
    const mean = (values: number[]) =>
      values.length ? values.reduce((s, v) => s + v, 0) / values.length : NaN;
    return {
      kind,
      count: list.length,
      per2Pi: mean(list.map((t) => t.theory.heightPer2Pi)),
      parallel: mean(list.map((t) => t.theory.parallelHeightPer2Pi)),
      sensitivity: mean(
        list.map((t) => Math.abs(t.theory.geometricSensitivity)),
      ),
      range: mean(list.map((t) => t.theory.codingRange)),
      sigma: mean(list.map((t) => t.theory.sigmaHeight)),
      simRmse: mean(
        runs
          .map((r) => r.evaluation.flatStats?.rmse ?? NaN)
          .filter(Number.isFinite),
      ),
      runs: runs.length,
    };
  });
  const directClass = classSummary.find((c) => c.kind === "direct")!;
  const ratio = (a: number, b: number) => (b > 0 ? a / b : NaN);

  const exportJson = () => {
    downloadBlob(
      new Blob(
        [
          aoiJson({
            config,
            theory,
            run: results && !stale ? { ...results } : null,
            strategies: !stale && fusion ? fusion.strategies : [],
            consistency: !stale && fusion ? fusion.consistency : [],
            sweep: sweep?.rows ?? [],
          }),
        ],
        { type: "application/json" },
      ),
      "aoi-multiview-benchmark.json",
    );
    setMessage(
      t(
        "已匯出 JSON：設定、理論值、模擬指標、Fusion 與批次比較；ground truth 只出現在評估指標。",
        "Exported JSON: settings, theory values, simulation metrics, fusion and batch comparison; ground truth appears only in the evaluation metrics.",
      ),
    );
  };
  const exportCsv = () => {
    if (!results || stale || !fusion)
      return setMessage(
        t(
          "請先以目前設定執行模擬再匯出 CSV。",
          "Run the simulation with the current settings before exporting CSV.",
        ),
      );
    downloadBlob(
      new Blob(
        [
          "\uFEFF" +
            aoiCsv(
              results,
              results.config,
              fusion.strategies.map((s) => s.result),
            ),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      "aoi-multiview-cells.csv",
    );
    setMessage(
      t(
        "已匯出每格 CSV（統一世界座標，mm）；truth_* 欄位僅供評估。",
        "Exported per-cell CSV (unified world coordinates, mm); truth_* columns are for evaluation only.",
      ),
    );
  };
  const exportSweep = () => {
    if (!sweep) return;
    downloadBlob(
      new Blob(["\uFEFF" + sweepCsv(sweep.rows, sweep.variable)], {
        type: "text/csv;charset=utf-8",
      }),
      "aoi-multiview-sweep.csv",
    );
  };
  const pairLabel = (id: string) => {
    const p = pairs.find((x) => x.id === id);
    return p
      ? t(
          `${id}（${PAIR_CLASS_NAMES[p.kind]}）`,
          `${id} (${PAIR_CLASS_NAMES[p.kind]})`,
        )
      : id;
  };
  const showPair = (run: PairRun) =>
    onShow(
      { label: run.pair.id, points: run.points, range: worldRange() },
      { cameraId: run.pair.cameraId, projectorId: run.pair.projectorId },
    );
  const showStrategy = (id: string) => {
    const s = fusion?.strategies.find((x) => x.result.id === id);
    if (!s || !results) return;
    const list: number[] = [];
    s.result.map.height.forEach((h, c) => {
      if (!Number.isFinite(h)) return;
      const [x, y] = cellCenter(results.grid, c);
      list.push(x, h, y);
    });
    onShow({
      label: strategyLabel(s.result.name),
      points: Float32Array.from(list),
      range: worldRange(),
    });
  };
  const focusTheory =
    theory.find((t) => t.pair.id === (focusRun?.pair.id ?? focus)) ?? theory[0];
  const field = (
    k: NumericKey,
    label: string,
    extra: Partial<Parameters<typeof Field>[0]> = {},
  ) => (
    <Field
      key={k}
      label={label}
      value={config[k]}
      min={WORLD_LIMITS[k][0]}
      max={WORLD_LIMITS[k][1]}
      onChange={(value) => update({ [k]: value })}
      {...extra}
    />
  );
  const setReference = (
    kind: (typeof PAIR_CLASSES)[number],
    patch: Partial<WorldConfig["references"]["direct"]>,
  ) =>
    update({
      references: {
        ...config.references,
        [kind]: { ...config.references[kind], ...patch },
      },
    });

  return (
    <div className="aoi-workspace aoi-shell">
      <aside
        className="sandbox-tools"
        aria-label={t("多視角分析設定", "Multi-view analysis settings")}
      >
        <div className="sandbox-panel-body">
          <InfoHeading title={t("多視角分析", "Multi-view analysis")}>
            {t(
              <>
                <p>
                  分析的是 3D 沙盒<strong>同一個場景</strong>：所有 Camera ×
                  Projector 組合。設備、條紋、材質與物體請在「3D
                  沙盒」分頁調整（含「AOI
                  檢測擺位」預設）；這裡只放分析用設定。所有設定共用復原／重做與保存。
                </p>
                <p>
                  一般 <strong>N 步 Phase Shifting</strong>，不是 Micro Phase
                  Shifting；多視角模擬只計直接光（互反射在 3D
                  沙盒單組掃描中）。模擬結果不代表實機 AOI 性能。
                </p>
              </>,
              <>
                <p>
                  This analyzes <strong>the same scene</strong> as the 3D
                  sandbox: every camera × projector combination. Adjust devices,
                  fringes, materials and objects in the “3D sandbox” tab
                  (including the “AOI inspection layout” preset); only analysis
                  settings live here. All settings share undo/redo and saving.
                </p>
                <p>
                  Standard <strong>N-step phase shifting</strong>, not Micro
                  Phase Shifting; the multi-view simulation counts direct light
                  only (interreflection is in the single-pair scan of the 3D
                  sandbox). Simulated results do not represent real AOI
                  performance.
                </p>
              </>,
            )}
          </InfoHeading>
          <p className="sandbox-note aoi-disclaimer">
            {t(
              <>
                一般 N 步 Phase Shifting（非 Micro Phase Shifting）· 理想模擬 ≠
                實機 AOI 性能
              </>,
              <>
                Standard N-step phase shifting (not Micro Phase Shifting) ·
                ideal simulation ≠ real AOI performance
              </>,
            )}
          </p>
          <p
            className={`sandbox-note aoi-run-status ${busy ? "busy" : ""}`}
            data-testid="aoi-status"
            role="status"
          >
            {status}
            {busy && ` ${Math.round(progress * 100)}%`}
          </p>
          <div className="aoi-actions">
            <button
              className="sandbox-scan-button"
              onClick={() => runPairs(chosen)}
              disabled={busy}
              data-testid="aoi-run-selected"
            >
              <Play size={15} />
              {t(
                <>執行選取（{chosen.length}）</>,
                <>Run selected ({chosen.length})</>,
              )}
            </button>
            <button onClick={exportJson} data-testid="aoi-export-json">
              <FileJson size={15} />
              JSON
            </button>
            <button
              onClick={exportCsv}
              disabled={!results || stale}
              data-testid="aoi-export-csv"
            >
              <Sheet size={15} />
              CSV
            </button>
          </div>
          {message && (
            <p className="sandbox-note aoi-warn" role="alert">
              {message}{" "}
              <button className="aoi-mini" onClick={() => setMessage("")}>
                {t("關閉", "Close")}
              </button>
            </p>
          )}
          <h3 className="sandbox-group">
            {t(
              "統一世界座標格網（中心＝瞄準點）",
              "Unified world grid (center = aim point)",
            )}
          </h3>
          {field("roiWidth", t("ROI 寬（x）", "ROI width (x)"), {
            step: 0.5,
            unit: "mm",
          })}
          {field("roiHeight", t("ROI 高（y）", "ROI height (y)"), {
            step: 0.5,
            unit: "mm",
          })}
          {field("cellSize", t("格寬", "Cell size"), {
            step: 0.01,
            unit: "mm",
          })}
          <h3 className="sandbox-group">
            {t("分類、評估與 Fusion", "Classification, evaluation and fusion")}
          </h3>
          {field(
            "directTiltLimit",
            t("直視門檻（Camera 傾角）", "Direct-view threshold (camera tilt)"),
            {
              step: 1,
              digits: 0,
              unit: "°",
            },
          )}
          {field("tolerance", t("準確容許誤差", "Accuracy tolerance"), {
            step: 0.005,
            digits: 3,
            unit: "mm",
          })}
          {field(
            "consistencyTolerance",
            t("一致性門檻", "Consistency threshold"),
            {
              step: 0.005,
              digits: 3,
              unit: "mm",
            },
          )}
          {field(
            "targetRange",
            t("需求量測範圍", "Required measurement range"),
            {
              step: 0.1,
              unit: "mm",
            },
          )}
          <InfoHeading title={t("AOI 提供的參考數值", "AOI reference values")}>
            {t(
              <p>
                輸入 AOI 廠商規格或實機量測的數值，
                <strong>只用於並列比較</strong>
                ，不會進入任何模擬、重建或
                Fusion，也不會讓模擬結果過期。空白表示未提供。
              </p>,
              <p>
                Enter values from AOI vendor specs or hardware measurements.
                They are <strong>for side-by-side comparison only</strong>: they
                never enter any simulation, reconstruction or fusion, and they
                do not make simulation results stale. Leave blank if not
                provided.
              </p>,
            )}
          </InfoHeading>
          {PAIR_CLASSES.map((kind) => (
            <div className="aoi-device" key={kind}>
              <div className="aoi-device-head">
                <strong>{PAIR_CLASS_NAMES[kind]}</strong>
              </div>
              <div className="aoi-device-grid">
                <label>
                  <span>{t("每 2π 高度 mm", "Height per 2π mm")}</span>
                  <OptionalNumber
                    label={t(
                      `${PAIR_CLASS_NAMES[kind]} 參考每 2π 高度`,
                      `${PAIR_CLASS_NAMES[kind]} reference height per 2π`,
                    )}
                    value={config.references[kind].heightPer2Pi}
                    onChange={(v) => setReference(kind, { heightPer2Pi: v })}
                  />
                </label>
                <label>
                  <span>{t("量測範圍 mm", "Measurement range mm")}</span>
                  <OptionalNumber
                    label={t(
                      `${PAIR_CLASS_NAMES[kind]} 參考量測範圍`,
                      `${PAIR_CLASS_NAMES[kind]} reference measurement range`,
                    )}
                    value={config.references[kind].range}
                    onChange={(v) => setReference(kind, { range: v })}
                  />
                </label>
                <label>
                  <span>{t("感度（直視=1）", "Sensitivity (direct = 1)")}</span>
                  <OptionalNumber
                    label={t(
                      `${PAIR_CLASS_NAMES[kind]} 參考感度比`,
                      `${PAIR_CLASS_NAMES[kind]} reference sensitivity ratio`,
                    )}
                    value={config.references[kind].sensitivityRatio}
                    onChange={(v) =>
                      setReference(kind, { sensitivityRatio: v })
                    }
                  />
                </label>
                <label>
                  <span>
                    {t("高度雜訊（直視=1）", "Height noise (direct = 1)")}
                  </span>
                  <OptionalNumber
                    label={t(
                      `${PAIR_CLASS_NAMES[kind]} 參考高度雜訊比`,
                      `${PAIR_CLASS_NAMES[kind]} reference height-noise ratio`,
                    )}
                    value={config.references[kind].noiseRatio}
                    onChange={(v) => setReference(kind, { noiseRatio: v })}
                  />
                </label>
              </div>
              <input
                className="aoi-note-input"
                aria-label={t(
                  `${PAIR_CLASS_NAMES[kind]} 來源備註`,
                  `${PAIR_CLASS_NAMES[kind]} source note`,
                )}
                placeholder={t(
                  "來源（規格書 / 實機量測 / 日期）",
                  "Source (datasheet / hardware measurement / date)",
                )}
                value={config.references[kind].note}
                onChange={(e) => setReference(kind, { note: e.target.value })}
              />
            </div>
          ))}
        </div>
      </aside>

      <main className="aoi-main">
        <Tabs
          label={t("多視角結果分頁", "Multi-view result tabs")}
          tabs={MAIN_TABS}
          value={mainTab}
          onChange={setMainTab}
        />
        <span
          className="sandbox-progress"
          hidden={!busy}
          style={{ transform: `scaleX(${progress})` }}
        />
        <div className={`aoi-main-body ${stale ? "stale" : ""}`}>
          {stale && (
            <p className="aoi-stale" role="note">
              {t(
                "設定已變更：模擬結果對應舊設定，請重新執行。理論值已即時更新。",
                "Settings changed: the simulation results match the old settings, so run again. Theory values are already updated.",
              )}
            </p>
          )}
          {mainTab === "range" && (
            <>
              <InfoHeading
                title={t("數值來源", "Where the numbers come from")}
                level={2}
              >
                {t(
                  <>
                    <p>
                      <strong>理論（平行近似）</strong>：|dφ/dh| = (2π/p)·|tanθp
                      − tanθc·cosΔα|，p 為瞄準點基準面上的條紋週期。
                      <strong>幾何模型</strong>：以 pinhole
                      校正參數精確微分；在瞄準點與平行近似相等，離軸後因透視而變化（「幾何
                      ROI 範圍」為 ROI
                      四角與中心的最小–最大值）。兩者皆只用校正資訊。
                    </p>
                    <p>
                      <strong>模擬</strong>：光線追蹤合成曝光 → 解相位 →
                      三角量測 → 與真值比較。<strong>AOI 參考值</strong>
                      ：使用者輸入的實機/規格數字，僅並列比較。理想模擬（直接光、完美校正）的精度不代表實際
                      AOI 性能。高度皆相對於基準面（世界 Y = {fmt(
                        reference,
                        2,
                      )}{" "}
                      mm）。
                    </p>
                  </>,
                  <>
                    <p>
                      <strong>Theory (parallel approximation)</strong>: |dφ/dh|
                      = (2π/p)·|tanθp − tanθc·cosΔα|, where p is the fringe
                      period on the reference plane at the aim point.{" "}
                      <strong>Geometric model</strong>: exact derivative from
                      the pinhole calibration parameters; it equals the parallel
                      approximation at the aim point and varies off-axis because
                      of perspective (“geometric ROI range” is the min–max over
                      the ROI corners and center). Both use calibration data
                      only.
                    </p>
                    <p>
                      <strong>Simulation</strong>: ray-traced synthetic exposure
                      → phase decoding → triangulation → comparison with ground
                      truth. <strong>AOI reference values</strong>: hardware or
                      spec numbers you enter, for side-by-side comparison only.
                      The accuracy of an ideal simulation (direct light, perfect
                      calibration) does not represent real AOI performance. All
                      heights are relative to the reference plane (world Y ={" "}
                      {fmt(reference, 2)} mm).
                    </p>
                  </>,
                )}
              </InfoHeading>
              <table className="aoi-table" data-testid="aoi-class-table">
                <thead>
                  <tr>
                    <th>{t("類別", "Class")}</th>
                    <th>{t("Pair 數", "Pairs")}</th>
                    <th>
                      {t(
                        "感度（直視=1）幾何 / 參考",
                        "Sensitivity (direct = 1) geometric / reference",
                      )}
                    </th>
                    <th>
                      {t(
                        "每 2π 高度 理論/幾何 mm",
                        "Height per 2π theory/geometric mm",
                      )}
                    </th>
                    <th>
                      {t("編碼量測範圍 mm", "Coded measurement range mm")}
                    </th>
                    <th>{t("理論 σh µm", "Theoretical σh µm")}</th>
                    <th>
                      {t("模擬平坦區 RMSE µm", "Simulated flat-area RMSE µm")}
                    </th>
                    <th>
                      {t(
                        "高度雜訊（直視=1）1/感度 / 理論 σh / 模擬 / 參考",
                        "Height noise (direct = 1) 1/sensitivity / theoretical σh / simulated / reference",
                      )}
                    </th>
                    <th>
                      {t(
                        "AOI 參考 每 2π / 範圍 mm",
                        "AOI reference per 2π / range mm",
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {classSummary.map((c) => (
                    <tr key={c.kind}>
                      <td>{PAIR_CLASS_NAMES[c.kind]}</td>
                      <td>{c.count}</td>
                      <td>
                        {fmt(ratio(c.sensitivity, directClass.sensitivity), 2)}{" "}
                        / {config.references[c.kind].sensitivityRatio ?? "—"}
                      </td>
                      <td>
                        {fmt(c.parallel, 2)} / {fmt(c.per2Pi, 2)}
                      </td>
                      <td>{fmt(c.range, 2)}</td>
                      <td>{um(c.sigma)}</td>
                      <td>{c.runs ? um(c.simRmse) : t("未執行", "Not run")}</td>
                      <td>
                        {fmt(ratio(directClass.sensitivity, c.sensitivity), 2)}{" "}
                        / {fmt(ratio(c.sigma, directClass.sigma), 2)} /{" "}
                        {c.runs && directClass.runs
                          ? fmt(ratio(c.simRmse, directClass.simRmse), 2)
                          : "—"}{" "}
                        / {config.references[c.kind].noiseRatio ?? "—"}
                      </td>
                      <td>
                        {config.references[c.kind].heightPer2Pi ?? "—"} /{" "}
                        {config.references[c.kind].range ?? "—"}
                        {config.references[c.kind].heightPer2Pi !== null &&
                          Number.isFinite(c.per2Pi) && (
                            <small>
                              {" "}
                              {t("（幾何/參考", "(geometric/reference")}{" "}
                              {fmt(
                                c.per2Pi /
                                  config.references[c.kind].heightPer2Pi!,
                                2,
                              )}
                              {t("）", ")")}
                            </small>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <InfoHeading
                title={t(
                  "各 Pair 靈敏度與量測範圍",
                  "Per-pair sensitivity and measurement range",
                )}
                level={2}
              >
                {t(
                  <p>
                    f₁,max：在「需求量測範圍」{config.targetRange} mm 下，單週期
                    / 目前編碼（含 p₂/p₁）可用的最高條紋頻率；頻率越高 σh
                    越小（σh ∝ 1/f₁），這就是範圍與精度的取捨。P(級次錯)
                    為高斯雜訊下兩組週期或 temporal 解纏的理論失敗機率。景深為
                    Camera 模糊 ≤ 2 px 且 Projector MTF ≥ 0.5
                    的高度區間（需設定光圈）。
                  </p>,
                  <p>
                    f₁,max: the highest fringe frequency usable for a single
                    period / the current coding (including p₂/p₁) at the
                    “required measurement range” of {config.targetRange} mm.
                    Higher frequency means smaller σh (σh ∝ 1/f₁): this is the
                    trade-off between range and accuracy. P(order error) is the
                    theoretical failure probability of dual-period or temporal
                    unwrapping under Gaussian noise. Depth of field is the
                    height interval where camera blur ≤ 2 px and projector MTF ≥
                    0.5 (requires an aperture setting).
                  </p>,
                )}
              </InfoHeading>
              <div className="aoi-table-actions">
                <button
                  onClick={() => setSelected(new Set(pairs.map((p) => p.id)))}
                >
                  {t("全選", "Select all")}
                </button>
                <button onClick={() => setSelected(new Set())}>
                  {t("全不選", "Select none")}
                </button>
                {PAIR_CLASSES.map((kind) => (
                  <button
                    key={kind}
                    onClick={() =>
                      setSelected(
                        new Set(
                          pairs.filter((p) => p.kind === kind).map((p) => p.id),
                        ),
                      )
                    }
                  >
                    {t(
                      <>只選{PAIR_CLASS_NAMES[kind]}</>,
                      <>Only {PAIR_CLASS_NAMES[kind]}</>,
                    )}
                  </button>
                ))}
              </div>
              <div className="aoi-table-scroll">
                <table className="aoi-table" data-testid="aoi-pair-table">
                  <thead>
                    <tr>
                      <th>{t("選", "Select")}</th>
                      <th>Pair</th>
                      <th>{t("類別", "Class")}</th>
                      <th>θc / θp / Δα °</th>
                      <th>{t("板面週期 mm", "Board period mm")}</th>
                      <th>
                        {t(
                          "|dφ/dh| 平行近似 / 幾何 ROI 範圍 rad/mm",
                          "|dφ/dh| parallel approx. / geometric ROI range rad/mm",
                        )}
                      </th>
                      <th>{t("每 2π mm", "Per 2π mm")}</th>
                      <th>{t("量測範圍 mm", "Measurement range mm")}</th>
                      <th>σh µm</th>
                      <th>{t("P(級次錯)", "P(order error)")}</th>
                      <th>{t("景深 mm", "Depth of field mm")}</th>
                      <th>
                        {t(
                          "f₁,max 單週期/目前編碼",
                          "f₁,max single period/current coding",
                        )}
                      </th>
                      <th>
                        {t(
                          "模擬 RMSE µm / 覆蓋",
                          "Simulated RMSE µm / coverage",
                        )}
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {theory.map(({ pair, theory: th }) => {
                      const run = runById.get(pair.id);
                      return (
                        <tr
                          key={pair.id}
                          className={
                            focusRun?.pair.id === pair.id ? "focus" : ""
                          }
                        >
                          <td>
                            <input
                              type="checkbox"
                              aria-label={t(
                                `選取 ${pair.id}`,
                                `Select ${pair.id}`,
                              )}
                              checked={selected ? selected.has(pair.id) : true}
                              onChange={(e) => {
                                const next = new Set(
                                  selected ?? pairs.map((p) => p.id),
                                );
                                if (e.target.checked) next.add(pair.id);
                                else next.delete(pair.id);
                                setSelected(next);
                              }}
                            />
                          </td>
                          <td>
                            <button
                              className="aoi-link"
                              onClick={() => setFocus(pair.id)}
                            >
                              {pair.id}
                            </button>
                          </td>
                          <td>{PAIR_CLASS_NAMES[pair.kind]}</td>
                          <td>
                            {pair.cameraTilt.toFixed(0)} /{" "}
                            {pair.projectorTilt.toFixed(0)} /{" "}
                            {pair.deltaAzimuth.toFixed(0)}
                          </td>
                          <td>{fmt(th.boardPeriod, 3)}</td>
                          <td>
                            {fmt(th.parallelSensitivity, 2)} /{" "}
                            {fmt(th.sensitivitySpan[0], 2)}–
                            {fmt(th.sensitivitySpan[1], 2)}
                          </td>
                          <td>{fmt(th.heightPer2Pi, 3)}</td>
                          <td>
                            {fmt(th.codingRange, 2)}
                            {th.effectiveRange[1] - th.effectiveRange[0] <
                              th.codingRange - 1e-9 && (
                              <small className="aoi-warn">
                                {t(" 景深限縮", " limited by depth of field")}
                              </small>
                            )}
                          </td>
                          <td>{um(th.sigmaHeight)}</td>
                          <td>
                            {th.orderErrorProbability
                              ? th.orderErrorProbability.toExponential(1)
                              : "0"}
                          </td>
                          <td>
                            {fmt(th.depthOfField[0], 1)}…
                            {fmt(th.depthOfField[1], 1)}
                          </td>
                          <td>
                            {fmt(th.maxFrequencySingle, 1)} /{" "}
                            {fmt(th.maxFrequencyCoded, 1)}
                          </td>
                          <td>
                            {run
                              ? `${um(run.evaluation.stats?.rmse ?? NaN)} / ${pct(run.evaluation.coverage)}`
                              : "—"}
                          </td>
                          <td className="aoi-row-actions">
                            <button
                              className="aoi-mini"
                              disabled={busy}
                              onClick={() => runPairs([pair.id])}
                              data-testid={`aoi-run-${pair.id}`}
                            >
                              {t("執行", "Run")}
                            </button>
                            <button
                              className="aoi-mini"
                              title={t(
                                "在 3D 沙盒設為目前 Pair",
                                "Set as the active pair in the 3D sandbox",
                              )}
                              onClick={() =>
                                run
                                  ? showPair(run)
                                  : onShow(null, {
                                      cameraId: pair.cameraId,
                                      projectorId: pair.projectorId,
                                    })
                              }
                              data-testid={`aoi-show-${pair.id}`}
                            >
                              <Box size={12} /> 3D
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {focusTheory && (
                <>
                  <h3 className="sandbox-group">
                    {t(
                      <>
                        {pairLabel(focusTheory.pair.id)}
                        ：兩組週期的週期比與量測範圍（f₁ ={" "}
                        {config.fringeFrequency}）
                      </>,
                      <>
                        {pairLabel(focusTheory.pair.id)}: period ratio and
                        measurement range for two periods (f₁ ={" "}
                        {config.fringeFrequency})
                      </>,
                    )}
                  </h3>
                  <table className="aoi-table compact">
                    <thead>
                      <tr>
                        <th>p₂/p₁</th>
                        {focusTheory.theory.ratios.map((r) => (
                          <th key={r.ratio}>{r.ratio}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          [
                            t("粗/細 範圍 mm", "Coarse/fine range mm"),
                            (r) => fmt(r.coarseRange, 2),
                          ],
                          [
                            t("粗/細 P(級次錯)", "Coarse/fine P(order error)"),
                            (r) => r.coarseOrderError.toExponential(1),
                          ],
                          [
                            t("外差 範圍 mm", "Heterodyne range mm"),
                            (r) => fmt(r.dualRange, 2),
                          ],
                          [
                            t("外差 P(級次錯)", "Heterodyne P(order error)"),
                            (r) => r.dualOrderError.toExponential(1),
                          ],
                        ] as const satisfies readonly (readonly [
                          string,
                          (
                            r: (typeof focusTheory.theory.ratios)[number],
                          ) => string,
                        ])[]
                      ).map(([title, cell]) => (
                        <tr key={title}>
                          <td>{title}</td>
                          {focusTheory.theory.ratios.map((r) => (
                            <td key={r.ratio}>{cell(r)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}

          {mainTab === "maps" &&
            (!results ? (
              <p className="sandbox-no-result">
                {t(
                  <>
                    尚未執行模擬。請在「Pair 與量測範圍」勾選 Pair
                    後按「執行選取」。
                  </>,
                  <>
                    No simulation run yet. Check pairs in “Pairs and measurement
                    range”, then press “Run selected”.
                  </>,
                )}
              </p>
            ) : (
              <>
                <InfoHeading
                  title={t(
                    "各 Pair 有效量測圖（統一世界座標，俯視）",
                    "Valid-measurement map per pair (unified world coordinates, top view)",
                  )}
                  level={2}
                >
                  {t(
                    <p>
                      板面 {results.grid.nx}×{results.grid.ny} 格（
                      {results.config.cellSize}{" "}
                      mm），中心為瞄準點。失效原因由真值幾何判定（FOV、遮擋、陰影）或讀取該
                      Pair 自身像素（飽和、調變不足）；此圖
                      <strong>僅供評估</strong>，不回饋到重建。
                    </p>,
                    <p>
                      Board grid of {results.grid.nx}×{results.grid.ny} cells (
                      {results.config.cellSize} mm), centered on the aim point.
                      Failure reasons come from the ground-truth geometry (FOV,
                      occlusion, shadow) or from the pair’s own pixels
                      (saturation, low modulation); this map is{" "}
                      <strong>for evaluation only</strong> and never feeds back
                      into reconstruction.
                    </p>,
                  )}
                </InfoHeading>
                <div className="aoi-legend">
                  {REASONS.map(([k, name, color]) => (
                    <span key={k}>
                      <i style={{ background: color }} />
                      {name}
                    </span>
                  ))}
                </div>
                <div className="aoi-map-grid">
                  {results.pairs.map((p) => (
                    <button
                      key={p.pair.id}
                      className={`aoi-map-card ${focusRun?.pair.id === p.pair.id ? "focus" : ""}`}
                      onClick={() => setFocus(p.pair.id)}
                    >
                      <GridMap
                        grid={results.grid}
                        values={p.evaluation.reasons}
                        mode="reason"
                        testId={`aoi-valid-map-${p.pair.id}`}
                        label={t(
                          `${p.pair.id} ${PAIR_CLASS_NAMES[p.pair.kind]} · 覆蓋 ${pct(p.evaluation.coverage)}`,
                          `${p.pair.id} ${PAIR_CLASS_NAMES[p.pair.kind]} · coverage ${pct(p.evaluation.coverage)}`,
                        )}
                      />
                    </button>
                  ))}
                </div>
                {focusRun && focusHeights && (
                  <>
                    <h3 className="sandbox-group">
                      {pairLabel(focusRun.pair.id)} {t("詳細", "details")}{" "}
                      <button
                        className="aoi-mini"
                        onClick={() => showPair(focusRun)}
                      >
                        <Box size={12} />{" "}
                        {t("在 3D 沙盒檢視", "View in 3D sandbox")}
                      </button>
                    </h3>
                    <div className="aoi-detail">
                      <GridMap
                        grid={results.grid}
                        values={focusRun.evaluation.reasons}
                        mode="reason"
                        label={t("有效量測圖", "Valid-measurement map")}
                      />
                      <GridMap
                        grid={results.grid}
                        values={focusHeights}
                        mode="height"
                        range={heightRange}
                        label={t(
                          `重建高度（${fmt(heightRange[0], 2)}–${fmt(heightRange[1], 2)} mm）`,
                          `Reconstructed height (${fmt(heightRange[0], 2)}–${fmt(heightRange[1], 2)} mm)`,
                        )}
                      />
                      <GridMap
                        grid={results.grid}
                        values={focusRun.evaluation.errors}
                        mode="error"
                        range={errorScale}
                        label={t(
                          `高度誤差（±${fmt(errorScale[1], 3)} mm，評估）`,
                          `Height error (±${fmt(errorScale[1], 3)} mm, evaluation)`,
                        )}
                      />
                      <ImageCanvas
                        values={focusRun.image.frame}
                        width={focusRun.image.width}
                        height={focusRun.image.height}
                        label={t(
                          "Camera 影像 I₁（合成曝光）",
                          "Camera image I₁ (synthetic exposure)",
                        )}
                      />
                      <ImageCanvas
                        values={focusRun.image.modulation}
                        width={focusRun.image.width}
                        height={focusRun.image.height}
                        gain={2}
                        label={t(
                          "調變 B（×2 顯示）",
                          "Modulation B (shown ×2)",
                        )}
                      />
                    </div>
                    <table
                      className="aoi-table compact"
                      data-testid="aoi-reason-table"
                    >
                      <thead>
                        <tr>
                          <th>{t("原因", "Reason")}</th>
                          <th>{t("格數", "Cells")}</th>
                          <th>
                            {t("比例（含無表面）", "Share (incl. no surface)")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {REASONS.map(([k, name, color], i) =>
                          focusRun.evaluation.reasonCounts[i] ? (
                            <tr key={k}>
                              <td>
                                <i
                                  className="aoi-swatch"
                                  style={{ background: color }}
                                />
                                {name}
                              </td>
                              <td>{focusRun.evaluation.reasonCounts[i]}</td>
                              <td>
                                {pct(
                                  focusRun.evaluation.reasonCounts[i] /
                                    (results.grid.nx * results.grid.ny),
                                )}
                              </td>
                            </tr>
                          ) : null,
                        )}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            ))}

          {mainTab === "fusion" &&
            (!results || !fusion ? (
              <p className="sandbox-no-result">
                {t(
                  "尚未執行模擬。Fusion 需要至少一組 Pair 的結果。",
                  "No simulation run yet. Fusion needs results from at least one pair.",
                )}
              </p>
            ) : (
              <>
                <InfoHeading
                  title={t(
                    "Multi-view Fusion 策略",
                    "Multi-view fusion strategies",
                  )}
                  level={2}
                >
                  {t(
                    <>
                      <p>
                        ① 直視 +
                        斜視：保留直視結果，只在直視失效的格以斜視共識補洞。②
                        單一斜視：特定局部特徵只信任一組斜視。③ 斜視 +
                        斜視：取與最多 Pair 一致（|Δh| ≤ max(門檻,
                        3σ)）的值，剔除離群後以 1/σ² 加權。
                      </p>
                      <p>
                        σ 來自各 Pair 自身的調變 B、感測器雜訊規格與幾何
                        |dφ/dh|，
                        <strong>完全不使用真值</strong>
                        。下表的誤差欄才使用真值評估。
                      </p>
                    </>,
                    <>
                      <p>
                        ① Direct + oblique: keep the direct-view result and fill
                        only the cells where direct view fails with the oblique
                        consensus. ② Single oblique: trust a single oblique pair
                        for a specific local feature. ③ Oblique + oblique: take
                        the value that agrees with the most pairs (|Δh| ≤
                        max(threshold, 3σ)), drop outliers, then weight by 1/σ².
                      </p>
                      <p>
                        σ comes from each pair’s own modulation B, the sensor
                        noise spec and the geometric |dφ/dh|, and{" "}
                        <strong>never uses ground truth</strong>. Only the error
                        columns in the table below use ground truth for
                        evaluation.
                      </p>
                    </>,
                  )}
                </InfoHeading>
                <div className="aoi-fusion-options">
                  {(["direct", "oblique"] as const).map((group) => (
                    <fieldset key={group}>
                      <legend>
                        {group === "direct"
                          ? t("① 的直視 Pair", "Direct pairs for ①")
                          : t("①③ 的斜視 Pair", "Oblique pairs for ①③")}
                      </legend>
                      {results.pairs
                        .filter((p) =>
                          group === "direct"
                            ? p.pair.kind === "direct"
                            : p.pair.kind !== "direct",
                        )
                        .map((p) => (
                          <label key={p.pair.id} className="sandbox-toggle">
                            <input
                              type="checkbox"
                              checked={fusionOptions[group].includes(p.pair.id)}
                              onChange={(e) =>
                                setFusionChoice({
                                  ...fusionOptions,
                                  [group]: e.target.checked
                                    ? [...fusionOptions[group], p.pair.id]
                                    : fusionOptions[group].filter(
                                        (id) => id !== p.pair.id,
                                      ),
                                })
                              }
                            />
                            {pairLabel(p.pair.id)}
                          </label>
                        ))}
                    </fieldset>
                  ))}
                  <fieldset>
                    <legend>
                      {t("② 單一斜視 Pair", "② Single oblique pair")}
                    </legend>
                    <select
                      aria-label={t("單一斜視 Pair", "Single oblique pair")}
                      value={fusionOptions.single ?? ""}
                      onChange={(e) =>
                        setFusionChoice({
                          ...fusionOptions,
                          single: e.target.value || null,
                        })
                      }
                    >
                      {results.pairs
                        .filter((p) => p.pair.kind !== "direct")
                        .map((p) => (
                          <option key={p.pair.id} value={p.pair.id}>
                            {pairLabel(p.pair.id)}
                          </option>
                        ))}
                    </select>
                  </fieldset>
                </div>
                <table className="aoi-table" data-testid="aoi-fusion-table">
                  <thead>
                    <tr>
                      <th>{t("策略", "Strategy")}</th>
                      <th>{t("Pair 數", "Pairs")}</th>
                      <th>{t("覆蓋", "Coverage")}</th>
                      <th>RMSE µm</th>
                      <th>MAE µm</th>
                      <th>Bias µm</th>
                      <th>{t("平坦區 RMSE µm", "Flat-area RMSE µm")}</th>
                      <th>{t("失效比例", "Failure ratio")}</th>
                      <th>{t("粗大誤差格", "Gross-error cells")}</th>
                      <th>
                        {t(
                          "一致 / 矛盾 / 單一 格 RMSE µm",
                          "Consistent / conflict / single cell RMSE µm",
                        )}
                      </th>
                      <th>ms</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {fusion.strategies.map(({ result, score }) => (
                      <tr
                        key={result.id}
                        className={
                          strategy?.result.id === result.id ? "focus" : ""
                        }
                        onClick={() => setStrategyFocus(result.id)}
                      >
                        <td>
                          <button className="aoi-link">
                            {strategyLabel(result.name)}
                          </button>
                        </td>
                        <td>{result.pairIds.length}</td>
                        <td>{pct(score.coverage)}</td>
                        <td>{um(score.stats?.rmse ?? NaN)}</td>
                        <td>{um(score.stats?.mae ?? NaN)}</td>
                        <td>{um(score.stats?.bias ?? NaN)}</td>
                        <td>{um(score.flatStats?.rmse ?? NaN)}</td>
                        <td>{pct(score.failureRatio)}</td>
                        <td>{score.grossCells}</td>
                        <td>
                          {[2, 3, 1]
                            .map((s) =>
                              score.byStatus.find((b) => b.status === s),
                            )
                            .map((b) =>
                              b && b.cells
                                ? `${um(b.stats?.rmse ?? NaN)}(${b.cells})`
                                : "—",
                            )
                            .join(" / ")}
                        </td>
                        <td>{result.ms.toFixed(1)}</td>
                        <td>
                          <button
                            className="aoi-mini"
                            onClick={(e) => {
                              e.stopPropagation();
                              showStrategy(result.id);
                            }}
                          >
                            <Box size={12} /> 3D
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {strategy && strategyHeights && (
                  <div className="aoi-detail">
                    <GridMap
                      grid={results.grid}
                      values={strategyHeights}
                      mode="height"
                      range={heightRange}
                      label={t(
                        `${strategyLabel(strategy.result.name)}：融合高度`,
                        `${strategyLabel(strategy.result.name)}: fused height`,
                      )}
                      testId="aoi-fusion-height"
                    />
                    <GridMap
                      grid={results.grid}
                      values={strategy.score.errors}
                      mode="error"
                      range={errorScale}
                      label={t("高度誤差（評估）", "Height error (evaluation)")}
                    />
                    <GridMap
                      grid={results.grid}
                      values={strategy.result.map.status}
                      mode="status"
                      label={t(
                        "一致性：黃=單一 綠=一致 紅=矛盾",
                        "Consistency: yellow = single, green = consistent, red = conflict",
                      )}
                    />
                    <GridMap
                      grid={results.grid}
                      values={strategy.result.map.spread}
                      mode="spread"
                      range={[0, config.consistencyTolerance * 3]}
                      label={t(
                        `Pair 間高度差 max−min（0–${fmt(config.consistencyTolerance * 3, 2)} mm）`,
                        `Height spread between pairs, max−min (0–${fmt(config.consistencyTolerance * 3, 2)} mm)`,
                      )}
                    />
                    {strategy.result.id === "directOblique" && (
                      <GridMap
                        grid={results.grid}
                        values={strategy.result.map.origin}
                        mode="origin"
                        label={t(
                          "來源：藍=直視 橙=斜視補洞",
                          "Source: blue = direct, orange = oblique hole filling",
                        )}
                      />
                    )}
                  </div>
                )}
                <InfoHeading title="Cross-pair Consistency Check" level={2}>
                  {t(
                    <p>
                      兩兩比較 Pair 在共同有效格的高度差（不使用真值）。RMS
                      大或矛盾比例高表示至少一方不可靠（級次錯誤、混疊、鏡面或遮擋邊緣）。上表「一致
                      / 矛盾」格的實際 RMSE 可驗證這個檢查是否真的預測誤差。
                    </p>,
                    <p>
                      Compares the height difference of every two pairs over
                      their common valid cells (no ground truth). A large RMS or
                      a high conflict ratio means at least one side is
                      unreliable (wrong fringe order, aliasing, specular
                      reflection or occlusion edges). The actual RMSE of the
                      “consistent / conflict” cells in the table above verifies
                      whether this check really predicts error.
                    </p>,
                  )}
                </InfoHeading>
                <div className="aoi-table-scroll">
                  <table
                    className="aoi-table compact"
                    data-testid="aoi-consistency"
                  >
                    <thead>
                      <tr>
                        <th>Pair A</th>
                        <th>Pair B</th>
                        <th>{t("共同格", "Common cells")}</th>
                        <th>RMS Δh µm</th>
                        <th>{t("中位 |Δh| µm", "Median |Δh| µm")}</th>
                        <th>
                          {t(<>&gt; 門檻比例</>, <>Share &gt; threshold</>)}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {fusion.consistency
                        .filter((e) => e.common > 0)
                        .sort((a, b) => b.conflictRatio - a.conflictRatio)
                        .slice(0, 60)
                        .map((e) => (
                          <tr
                            key={`${e.a}-${e.b}`}
                            className={e.conflictRatio > 0.2 ? "bad" : ""}
                          >
                            <td>{pairLabel(e.a)}</td>
                            <td>{pairLabel(e.b)}</td>
                            <td>{e.common}</td>
                            <td>{um(e.rms)}</td>
                            <td>{um(e.medianAbs)}</td>
                            <td>{pct(e.conflictRatio)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            ))}

          {mainTab === "bench" && (
            <>
              {!results ? (
                <p className="sandbox-no-result">
                  {t("尚未執行模擬。", "No simulation run yet.")}
                </p>
              ) : (
                <>
                  <InfoHeading
                    title={t(
                      "Benchmark（統一世界座標，mm）",
                      "Benchmark (unified world coordinates, mm)",
                    )}
                    level={2}
                  >
                    {t(
                      <p>
                        誤差 = 每格重建高度（像素點中位數）−
                        真值格內平均高度。平坦區排除格內真值起伏 ≥
                        2×容許誤差的邊緣格。失效比例 = 1 − 準確格 /
                        有表面格。粗大誤差 = |e| ≥ 半個每 2π
                        高度（級次錯或混疊）。時間為瀏覽器 Worker 內的模擬時間，
                        <strong>不是 AOI 節拍</strong>。
                      </p>,
                      <p>
                        Error = reconstructed height per cell (median of pixel
                        points) − mean ground-truth height in the cell. Flat
                        areas exclude edge cells whose ground truth varies by ≥
                        2× tolerance. Failure ratio = 1 − accurate cells /
                        surface cells. Gross error = |e| ≥ half the height per
                        2π (wrong order or aliasing). Times are simulation times
                        inside the browser worker,{" "}
                        <strong>not AOI cycle time</strong>.
                      </p>,
                    )}
                  </InfoHeading>
                  <div className="aoi-table-scroll">
                    <table className="aoi-table" data-testid="aoi-benchmark">
                      <thead>
                        <tr>
                          <th>{t("項目", "Item")}</th>
                          <th>{t("類別", "Class")}</th>
                          <th>{t("覆蓋", "Coverage")}</th>
                          <th>RMSE µm</th>
                          <th>MAE µm</th>
                          <th>Bias µm</th>
                          <th>{t("平坦區 RMSE µm", "Flat-area RMSE µm")}</th>
                          <th>{t("失效比例", "Failure ratio")}</th>
                          <th>{t("粗大誤差格", "Gross-error cells")}</th>
                          <th>
                            {t(
                              "各表面 RMSE µm（覆蓋）",
                              "RMSE per surface µm (coverage)",
                            )}
                          </th>
                          <th>{t("時間 ms", "Time ms")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ...results.pairs.map((p) => ({
                            id: p.pair.id,
                            kind: PAIR_CLASS_NAMES[p.pair.kind],
                            score: p.evaluation,
                            ms: t(
                              `${(p.timing.renderMs + p.timing.reconstructMs).toFixed(0)} +${p.timing.traceMs.toFixed(0)} 共用`,
                              `${(p.timing.renderMs + p.timing.reconstructMs).toFixed(0)} +${p.timing.traceMs.toFixed(0)} shared`,
                            ),
                            fusion: false,
                          })),
                          ...(fusion?.strategies.map(({ result, score }) => ({
                            id: strategyLabel(result.name),
                            kind: "Fusion",
                            score,
                            ms: result.ms.toFixed(1),
                            fusion: true,
                          })) ?? []),
                        ].map((row) => (
                          <tr
                            key={row.id}
                            className={row.fusion ? "fusion" : ""}
                          >
                            <td>{row.id}</td>
                            <td>{row.kind}</td>
                            <td>{pct(row.score.coverage)}</td>
                            <td>{um(row.score.stats?.rmse ?? NaN)}</td>
                            <td>{um(row.score.stats?.mae ?? NaN)}</td>
                            <td>{um(row.score.stats?.bias ?? NaN)}</td>
                            <td>{um(row.score.flatStats?.rmse ?? NaN)}</td>
                            <td>{pct(row.score.failureRatio)}</td>
                            <td>{row.score.grossCells}</td>
                            <td className="aoi-slots">
                              {row.score.bySlot
                                .map((s) =>
                                  t(
                                    `${SURFACE_NAMES[s.slot]} ${um(s.stats?.rmse ?? NaN)}（${pct(s.cells ? s.measured / s.cells : NaN)}）`,
                                    `${SURFACE_NAMES[s.slot]} ${um(s.stats?.rmse ?? NaN)} (${pct(s.cells ? s.measured / s.cells : NaN)})`,
                                  ),
                                )
                                .join(" · ")}
                            </td>
                            <td>{row.ms}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {focusRun && (
                    <Histogram
                      errors={focusRun.evaluation.errors}
                      scale={errorScale[1]}
                      label={t(
                        `${focusRun.pair.id} 誤差分布`,
                        `${focusRun.pair.id} error distribution`,
                      )}
                    />
                  )}
                  {strategy && (
                    <Histogram
                      errors={strategy.score.errors}
                      scale={errorScale[1]}
                      label={t(
                        `${strategyLabel(strategy.result.name)} 誤差分布`,
                        `${strategyLabel(strategy.result.name)} error distribution`,
                      )}
                    />
                  )}
                </>
              )}
              <InfoHeading
                title={t(
                  "批次比較（固定 seed）",
                  "Batch comparison (fixed seed)",
                )}
                level={2}
              >
                {t(
                  <p>
                    對勾選的 Pair 逐一套用數值重跑完整流程與三種
                    Fusion。平面場景 + 掃描「物體高度 Y」可看到每組 Pair
                    超出量測範圍時的混疊鋸齒；掃描 f₁ 或 p₂/p₁
                    可比較範圍與精度的取捨。
                  </p>,
                  <p>
                    Reruns the full pipeline and all three fusion strategies for
                    each value on the checked pairs. A plane scene + sweeping
                    “object height Y” shows the aliasing sawtooth of each pair
                    once it leaves its measurement range; sweeping f₁ or p₂/p₁
                    compares the trade-off between range and accuracy.
                  </p>,
                )}
              </InfoHeading>
              <div className="aoi-sweep">
                <select
                  aria-label={t("批次變數", "Batch variable")}
                  value={sweepVariable}
                  onChange={(e) =>
                    setSweepVariable(e.target.value as SweepVariable)
                  }
                >
                  {SWEEP_VARIABLES.map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t("批次數值", "Batch values")}
                  value={sweepValues}
                  onChange={(e) => setSweepValues(e.target.value)}
                />
                <button
                  onClick={runSweep}
                  disabled={busy}
                  data-testid="aoi-run-sweep"
                >
                  <Play size={14} />
                  {t(
                    <>執行批次（{chosen.length} Pair）</>,
                    <>Run batch ({chosen.length} pairs)</>,
                  )}
                </button>
                <button onClick={exportSweep} disabled={!sweep}>
                  <Sheet size={14} />
                  {t("批次 CSV", "Batch CSV")}
                </button>
              </div>
              {sweep && (
                <div className="aoi-table-scroll">
                  <table
                    className="aoi-table compact"
                    data-testid="aoi-sweep-table"
                  >
                    <thead>
                      <tr>
                        <th>
                          {
                            SWEEP_VARIABLES.find(
                              ([id]) => id === sweep.variable,
                            )?.[1]
                          }
                        </th>
                        <th>{t("項目", "Item")}</th>
                        <th>RMSE µm</th>
                        <th>{t("覆蓋", "Coverage")}</th>
                        <th>{t("粗大誤差比例", "Gross-error ratio")}</th>
                        <th>
                          {t(
                            "中位高度 / 真值 mm",
                            "Median height / ground truth mm",
                          )}
                        </th>
                        <th>{t("理論範圍 mm", "Theoretical range mm")}</th>
                        <th>{t("理論 σh µm", "Theoretical σh µm")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sweep.rows.map((r, i) => (
                        <tr
                          key={i}
                          className={r.kind === "fusion" ? "fusion" : ""}
                        >
                          <td>{r.value}</td>
                          <td>
                            {r.kind === "fusion"
                              ? strategyLabel(r.id)
                              : pairLabel(r.id)}
                          </td>
                          <td>{um(r.rmse)}</td>
                          <td>{pct(r.coverage)}</td>
                          <td>{pct(r.grossRatio)}</td>
                          <td>
                            {fmt(r.medianHeight, 3)} / {fmt(r.truthHeight, 3)}
                          </td>
                          <td>{fmt(r.theoryRange, 2)}</td>
                          <td>{um(r.theorySigma)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
