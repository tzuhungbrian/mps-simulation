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
  SWEEP_VARIABLES,
  theoryForAll,
  type FusionOptions,
  type PairRun,
  type SweepRow,
  type SweepVariable,
} from "./simulate";
import { aoiCsv, aoiJson, sweepCsv } from "./export";
import type { AoiRequest, AoiResponse } from "./aoi.worker";
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
      placeholder="未提供"
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
        {label}：±{fmt(scale, 3)} mm，範圍外 {outside} 格
      </figcaption>
    </figure>
  );
}

const MAIN_TABS = [
  ["range", "Pair 與量測範圍"],
  ["maps", "有效量測圖"],
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
      "尚未執行多視角模擬；理論值已依目前設定即時計算。",
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
        if (reply.label) setStatus(`多視角模擬中：${reply.label}`);
        return;
      }
      next.terminate();
      worker.current = null;
      setBusy(false);
      if (reply.type === "error") {
        setStatus("多視角模擬失敗，沒有用真值補出結果。");
        setMessage(reply.message);
      } else onDone(reply);
    };
    next.onerror = (event) => {
      if (token !== generation.current) return;
      setBusy(false);
      setStatus("多視角模擬失敗。");
      setMessage(event.message || "Worker 錯誤");
    };
    next.postMessage(request);
  };

  const runPairs = (ids: string[]) => {
    if (!ids.length) return setMessage("請至少選擇一組 Pair。");
    const snapshot = config,
      snapshotKey = key;
    setStatus(`多視角模擬中：${ids.length} 組 Pair…`);
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
        `完成 ${run.pairs.length} 組 Pair（${(run.timing.totalMs / 1000).toFixed(1)} s，Worker 內模擬時間）。`,
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
      return setMessage("請輸入 1–24 個數值，以逗號分隔。");
    for (const value of values)
      try {
        validateWorldConfig({ ...config, [sweepVariable]: value });
      } catch (error) {
        return setMessage(
          `數值 ${value} 無效：${error instanceof Error ? error.message : error}`,
        );
      }
    const variable = sweepVariable;
    setStatus("批次比較中…");
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
          `批次比較完成：${values.length} 個數值 × ${chosen.length} 組 Pair。`,
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
      "已匯出 JSON：設定、理論值、模擬指標、Fusion 與批次比較；ground truth 只出現在評估指標。",
    );
  };
  const exportCsv = () => {
    if (!results || stale || !fusion)
      return setMessage("請先以目前設定執行模擬再匯出 CSV。");
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
    setMessage("已匯出每格 CSV（統一世界座標，mm）；truth_* 欄位僅供評估。");
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
    return p ? `${id}（${PAIR_CLASS_NAMES[p.kind]}）` : id;
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
      label: s.result.name,
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
      <aside className="sandbox-tools" aria-label="多視角分析設定">
        <div className="sandbox-panel-body">
          <InfoHeading title="多視角分析">
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
          </InfoHeading>
          <p className="sandbox-note aoi-disclaimer">
            一般 N 步 Phase Shifting（非 Micro Phase Shifting）· 理想模擬 ≠ 實機
            AOI 性能
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
              執行選取（{chosen.length}）
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
                關閉
              </button>
            </p>
          )}
          <h3 className="sandbox-group">統一世界座標格網（中心＝瞄準點）</h3>
          {field("roiWidth", "ROI 寬（x）", { step: 0.5, unit: "mm" })}
          {field("roiHeight", "ROI 高（y）", { step: 0.5, unit: "mm" })}
          {field("cellSize", "格寬", { step: 0.01, unit: "mm" })}
          <h3 className="sandbox-group">分類、評估與 Fusion</h3>
          {field("directTiltLimit", "直視門檻（Camera 傾角）", {
            step: 1,
            digits: 0,
            unit: "°",
          })}
          {field("tolerance", "準確容許誤差", {
            step: 0.005,
            digits: 3,
            unit: "mm",
          })}
          {field("consistencyTolerance", "一致性門檻", {
            step: 0.005,
            digits: 3,
            unit: "mm",
          })}
          {field("targetRange", "需求量測範圍", { step: 0.1, unit: "mm" })}
          <InfoHeading title="AOI 提供的參考數值">
            <p>
              輸入 AOI 廠商規格或實機量測的數值，<strong>只用於並列比較</strong>
              ，不會進入任何模擬、重建或
              Fusion，也不會讓模擬結果過期。空白表示未提供。
            </p>
          </InfoHeading>
          {PAIR_CLASSES.map((kind) => (
            <div className="aoi-device" key={kind}>
              <div className="aoi-device-head">
                <strong>{PAIR_CLASS_NAMES[kind]}</strong>
              </div>
              <div className="aoi-device-grid">
                <label>
                  <span>每 2π 高度 mm</span>
                  <OptionalNumber
                    label={`${PAIR_CLASS_NAMES[kind]} 參考每 2π 高度`}
                    value={config.references[kind].heightPer2Pi}
                    onChange={(v) => setReference(kind, { heightPer2Pi: v })}
                  />
                </label>
                <label>
                  <span>量測範圍 mm</span>
                  <OptionalNumber
                    label={`${PAIR_CLASS_NAMES[kind]} 參考量測範圍`}
                    value={config.references[kind].range}
                    onChange={(v) => setReference(kind, { range: v })}
                  />
                </label>
                <label>
                  <span>感度（直視=1）</span>
                  <OptionalNumber
                    label={`${PAIR_CLASS_NAMES[kind]} 參考感度比`}
                    value={config.references[kind].sensitivityRatio}
                    onChange={(v) =>
                      setReference(kind, { sensitivityRatio: v })
                    }
                  />
                </label>
                <label>
                  <span>高度雜訊（直視=1）</span>
                  <OptionalNumber
                    label={`${PAIR_CLASS_NAMES[kind]} 參考高度雜訊比`}
                    value={config.references[kind].noiseRatio}
                    onChange={(v) => setReference(kind, { noiseRatio: v })}
                  />
                </label>
              </div>
              <input
                className="aoi-note-input"
                aria-label={`${PAIR_CLASS_NAMES[kind]} 來源備註`}
                placeholder="來源（規格書 / 實機量測 / 日期）"
                value={config.references[kind].note}
                onChange={(e) => setReference(kind, { note: e.target.value })}
              />
            </div>
          ))}
        </div>
      </aside>

      <main className="aoi-main">
        <Tabs
          label="多視角結果分頁"
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
              設定已變更：模擬結果對應舊設定，請重新執行。理論值已即時更新。
            </p>
          )}
          {mainTab === "range" && (
            <>
              <InfoHeading title="數值來源" level={2}>
                <p>
                  <strong>理論（平行近似）</strong>：|dφ/dh| = (2π/p)·|tanθp −
                  tanθc·cosΔα|，p 為瞄準點基準面上的條紋週期。
                  <strong>幾何模型</strong>：以 pinhole
                  校正參數精確微分；在瞄準點與平行近似相等，離軸後因透視而變化（「幾何
                  ROI 範圍」為 ROI
                  四角與中心的最小–最大值）。兩者皆只用校正資訊。
                </p>
                <p>
                  <strong>模擬</strong>：光線追蹤合成曝光 → 解相位 → 三角量測 →
                  與真值比較。<strong>AOI 參考值</strong>
                  ：使用者輸入的實機/規格數字，僅並列比較。理想模擬（直接光、完美校正）的精度不代表實際
                  AOI 性能。高度皆相對於基準面（世界 Y = {fmt(
                    reference,
                    2,
                  )}{" "}
                  mm）。
                </p>
              </InfoHeading>
              <table className="aoi-table" data-testid="aoi-class-table">
                <thead>
                  <tr>
                    <th>類別</th>
                    <th>Pair 數</th>
                    <th>感度（直視=1）幾何 / 參考</th>
                    <th>每 2π 高度 理論/幾何 mm</th>
                    <th>編碼量測範圍 mm</th>
                    <th>理論 σh µm</th>
                    <th>模擬平坦區 RMSE µm</th>
                    <th>高度雜訊（直視=1）1/感度 / 理論 σh / 模擬 / 參考</th>
                    <th>AOI 參考 每 2π / 範圍 mm</th>
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
                      <td>{c.runs ? um(c.simRmse) : "未執行"}</td>
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
                              （幾何/參考{" "}
                              {fmt(
                                c.per2Pi /
                                  config.references[c.kind].heightPer2Pi!,
                                2,
                              )}
                              ）
                            </small>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <InfoHeading title="各 Pair 靈敏度與量測範圍" level={2}>
                <p>
                  f₁,max：在「需求量測範圍」{config.targetRange} mm 下，單週期 /
                  目前編碼（含 p₂/p₁）可用的最高條紋頻率；頻率越高 σh 越小（σh ∝
                  1/f₁），這就是範圍與精度的取捨。P(級次錯)
                  為高斯雜訊下兩組週期或 temporal 解纏的理論失敗機率。景深為
                  Camera 模糊 ≤ 2 px 且 Projector MTF ≥ 0.5
                  的高度區間（需設定光圈）。
                </p>
              </InfoHeading>
              <div className="aoi-table-actions">
                <button
                  onClick={() => setSelected(new Set(pairs.map((p) => p.id)))}
                >
                  全選
                </button>
                <button onClick={() => setSelected(new Set())}>全不選</button>
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
                    只選{PAIR_CLASS_NAMES[kind]}
                  </button>
                ))}
              </div>
              <div className="aoi-table-scroll">
                <table className="aoi-table" data-testid="aoi-pair-table">
                  <thead>
                    <tr>
                      <th>選</th>
                      <th>Pair</th>
                      <th>類別</th>
                      <th>θc / θp / Δα °</th>
                      <th>板面週期 mm</th>
                      <th>|dφ/dh| 平行近似 / 幾何 ROI 範圍 rad/mm</th>
                      <th>每 2π mm</th>
                      <th>量測範圍 mm</th>
                      <th>σh µm</th>
                      <th>P(級次錯)</th>
                      <th>景深 mm</th>
                      <th>f₁,max 單週期/目前編碼</th>
                      <th>模擬 RMSE µm / 覆蓋</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {theory.map(({ pair, theory: t }) => {
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
                              aria-label={`選取 ${pair.id}`}
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
                          <td>{fmt(t.boardPeriod, 3)}</td>
                          <td>
                            {fmt(t.parallelSensitivity, 2)} /{" "}
                            {fmt(t.sensitivitySpan[0], 2)}–
                            {fmt(t.sensitivitySpan[1], 2)}
                          </td>
                          <td>{fmt(t.heightPer2Pi, 3)}</td>
                          <td>
                            {fmt(t.codingRange, 2)}
                            {t.effectiveRange[1] - t.effectiveRange[0] <
                              t.codingRange - 1e-9 && (
                              <small className="aoi-warn"> 景深限縮</small>
                            )}
                          </td>
                          <td>{um(t.sigmaHeight)}</td>
                          <td>
                            {t.orderErrorProbability
                              ? t.orderErrorProbability.toExponential(1)
                              : "0"}
                          </td>
                          <td>
                            {fmt(t.depthOfField[0], 1)}…
                            {fmt(t.depthOfField[1], 1)}
                          </td>
                          <td>
                            {fmt(t.maxFrequencySingle, 1)} /{" "}
                            {fmt(t.maxFrequencyCoded, 1)}
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
                              執行
                            </button>
                            <button
                              className="aoi-mini"
                              title="在 3D 沙盒設為目前 Pair"
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
                    {pairLabel(focusTheory.pair.id)}
                    ：兩組週期的週期比與量測範圍（f₁ = {config.fringeFrequency}
                    ）
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
                          ["粗/細 範圍 mm", (r) => fmt(r.coarseRange, 2)],
                          [
                            "粗/細 P(級次錯)",
                            (r) => r.coarseOrderError.toExponential(1),
                          ],
                          ["外差 範圍 mm", (r) => fmt(r.dualRange, 2)],
                          [
                            "外差 P(級次錯)",
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
                尚未執行模擬。請在「Pair 與量測範圍」勾選 Pair
                後按「執行選取」。
              </p>
            ) : (
              <>
                <InfoHeading
                  title="各 Pair 有效量測圖（統一世界座標，俯視）"
                  level={2}
                >
                  <p>
                    板面 {results.grid.nx}×{results.grid.ny} 格（
                    {results.config.cellSize}{" "}
                    mm），中心為瞄準點。失效原因由真值幾何判定（FOV、遮擋、陰影）或讀取該
                    Pair 自身像素（飽和、調變不足）；此圖
                    <strong>僅供評估</strong>，不回饋到重建。
                  </p>
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
                        label={`${p.pair.id} ${PAIR_CLASS_NAMES[p.pair.kind]} · 覆蓋 ${pct(p.evaluation.coverage)}`}
                      />
                    </button>
                  ))}
                </div>
                {focusRun && focusHeights && (
                  <>
                    <h3 className="sandbox-group">
                      {pairLabel(focusRun.pair.id)} 詳細{" "}
                      <button
                        className="aoi-mini"
                        onClick={() => showPair(focusRun)}
                      >
                        <Box size={12} /> 在 3D 沙盒檢視
                      </button>
                    </h3>
                    <div className="aoi-detail">
                      <GridMap
                        grid={results.grid}
                        values={focusRun.evaluation.reasons}
                        mode="reason"
                        label="有效量測圖"
                      />
                      <GridMap
                        grid={results.grid}
                        values={focusHeights}
                        mode="height"
                        range={heightRange}
                        label={`重建高度（${fmt(heightRange[0], 2)}–${fmt(heightRange[1], 2)} mm）`}
                      />
                      <GridMap
                        grid={results.grid}
                        values={focusRun.evaluation.errors}
                        mode="error"
                        range={errorScale}
                        label={`高度誤差（±${fmt(errorScale[1], 3)} mm，評估）`}
                      />
                      <ImageCanvas
                        values={focusRun.image.frame}
                        width={focusRun.image.width}
                        height={focusRun.image.height}
                        label="Camera 影像 I₁（合成曝光）"
                      />
                      <ImageCanvas
                        values={focusRun.image.modulation}
                        width={focusRun.image.width}
                        height={focusRun.image.height}
                        gain={2}
                        label="調變 B（×2 顯示）"
                      />
                    </div>
                    <table
                      className="aoi-table compact"
                      data-testid="aoi-reason-table"
                    >
                      <thead>
                        <tr>
                          <th>原因</th>
                          <th>格數</th>
                          <th>比例（含無表面）</th>
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
                尚未執行模擬。Fusion 需要至少一組 Pair 的結果。
              </p>
            ) : (
              <>
                <InfoHeading title="Multi-view Fusion 策略" level={2}>
                  <p>
                    ① 直視 +
                    斜視：保留直視結果，只在直視失效的格以斜視共識補洞。②
                    單一斜視：特定局部特徵只信任一組斜視。③ 斜視 +
                    斜視：取與最多 Pair 一致（|Δh| ≤ max(門檻,
                    3σ)）的值，剔除離群後以 1/σ² 加權。
                  </p>
                  <p>
                    σ 來自各 Pair 自身的調變 B、感測器雜訊規格與幾何 |dφ/dh|，
                    <strong>完全不使用真值</strong>
                    。下表的誤差欄才使用真值評估。
                  </p>
                </InfoHeading>
                <div className="aoi-fusion-options">
                  {(["direct", "oblique"] as const).map((group) => (
                    <fieldset key={group}>
                      <legend>
                        {group === "direct"
                          ? "① 的直視 Pair"
                          : "①③ 的斜視 Pair"}
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
                    <legend>② 單一斜視 Pair</legend>
                    <select
                      aria-label="單一斜視 Pair"
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
                      <th>策略</th>
                      <th>Pair 數</th>
                      <th>覆蓋</th>
                      <th>RMSE µm</th>
                      <th>MAE µm</th>
                      <th>Bias µm</th>
                      <th>平坦區 RMSE µm</th>
                      <th>失效比例</th>
                      <th>粗大誤差格</th>
                      <th>一致 / 矛盾 / 單一 格 RMSE µm</th>
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
                          <button className="aoi-link">{result.name}</button>
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
                      label={`${strategy.result.name}：融合高度`}
                      testId="aoi-fusion-height"
                    />
                    <GridMap
                      grid={results.grid}
                      values={strategy.score.errors}
                      mode="error"
                      range={errorScale}
                      label="高度誤差（評估）"
                    />
                    <GridMap
                      grid={results.grid}
                      values={strategy.result.map.status}
                      mode="status"
                      label="一致性：黃=單一 綠=一致 紅=矛盾"
                    />
                    <GridMap
                      grid={results.grid}
                      values={strategy.result.map.spread}
                      mode="spread"
                      range={[0, config.consistencyTolerance * 3]}
                      label={`Pair 間高度差 max−min（0–${fmt(config.consistencyTolerance * 3, 2)} mm）`}
                    />
                    {strategy.result.id === "directOblique" && (
                      <GridMap
                        grid={results.grid}
                        values={strategy.result.map.origin}
                        mode="origin"
                        label="來源：藍=直視 橙=斜視補洞"
                      />
                    )}
                  </div>
                )}
                <InfoHeading title="Cross-pair Consistency Check" level={2}>
                  <p>
                    兩兩比較 Pair 在共同有效格的高度差（不使用真值）。RMS
                    大或矛盾比例高表示至少一方不可靠（級次錯誤、混疊、鏡面或遮擋邊緣）。上表「一致
                    / 矛盾」格的實際 RMSE 可驗證這個檢查是否真的預測誤差。
                  </p>
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
                        <th>共同格</th>
                        <th>RMS Δh µm</th>
                        <th>中位 |Δh| µm</th>
                        <th>&gt; 門檻比例</th>
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
                <p className="sandbox-no-result">尚未執行模擬。</p>
              ) : (
                <>
                  <InfoHeading title="Benchmark（統一世界座標，mm）" level={2}>
                    <p>
                      誤差 = 每格重建高度（像素點中位數）−
                      真值格內平均高度。平坦區排除格內真值起伏 ≥
                      2×容許誤差的邊緣格。失效比例 = 1 − 準確格 /
                      有表面格。粗大誤差 = |e| ≥ 半個每 2π
                      高度（級次錯或混疊）。時間為瀏覽器 Worker 內的模擬時間，
                      <strong>不是 AOI 節拍</strong>。
                    </p>
                  </InfoHeading>
                  <div className="aoi-table-scroll">
                    <table className="aoi-table" data-testid="aoi-benchmark">
                      <thead>
                        <tr>
                          <th>項目</th>
                          <th>類別</th>
                          <th>覆蓋</th>
                          <th>RMSE µm</th>
                          <th>MAE µm</th>
                          <th>Bias µm</th>
                          <th>平坦區 RMSE µm</th>
                          <th>失效比例</th>
                          <th>粗大誤差格</th>
                          <th>各表面 RMSE µm（覆蓋）</th>
                          <th>時間 ms</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ...results.pairs.map((p) => ({
                            id: p.pair.id,
                            kind: PAIR_CLASS_NAMES[p.pair.kind],
                            score: p.evaluation,
                            ms: `${(p.timing.renderMs + p.timing.reconstructMs).toFixed(0)} +${p.timing.traceMs.toFixed(0)} 共用`,
                            fusion: false,
                          })),
                          ...(fusion?.strategies.map(({ result, score }) => ({
                            id: result.name,
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
                                .map(
                                  (s) =>
                                    `${SURFACE_NAMES[s.slot]} ${um(s.stats?.rmse ?? NaN)}（${pct(s.cells ? s.measured / s.cells : NaN)}）`,
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
                      label={`${focusRun.pair.id} 誤差分布`}
                    />
                  )}
                  {strategy && (
                    <Histogram
                      errors={strategy.score.errors}
                      scale={errorScale[1]}
                      label={`${strategy.result.name} 誤差分布`}
                    />
                  )}
                </>
              )}
              <InfoHeading title="批次比較（固定 seed）" level={2}>
                <p>
                  對勾選的 Pair 逐一套用數值重跑完整流程與三種 Fusion。平面場景
                  + 掃描「物體高度 Y」可看到每組 Pair
                  超出量測範圍時的混疊鋸齒；掃描 f₁ 或 p₂/p₁
                  可比較範圍與精度的取捨。
                </p>
              </InfoHeading>
              <div className="aoi-sweep">
                <select
                  aria-label="批次變數"
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
                  aria-label="批次數值"
                  value={sweepValues}
                  onChange={(e) => setSweepValues(e.target.value)}
                />
                <button
                  onClick={runSweep}
                  disabled={busy}
                  data-testid="aoi-run-sweep"
                >
                  <Play size={14} />
                  執行批次（{chosen.length} Pair）
                </button>
                <button onClick={exportSweep} disabled={!sweep}>
                  <Sheet size={14} />
                  批次 CSV
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
                        <th>項目</th>
                        <th>RMSE µm</th>
                        <th>覆蓋</th>
                        <th>粗大誤差比例</th>
                        <th>中位高度 / 真值 mm</th>
                        <th>理論範圍 mm</th>
                        <th>理論 σh µm</th>
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
                            {r.kind === "fusion" ? r.id : pairLabel(r.id)}
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
