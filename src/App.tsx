import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  FileJson,
  FlaskConical,
  Focus,
  Info,
  Layers3,
  MousePointer2,
  RotateCcw,
  Save,
  ScanLine,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Waves,
  X,
} from "lucide-react";
import {
  DEFAULT_CONFIG,
  runSimulation,
  TAU,
  type SimulationConfig,
} from "./core/simulation";
import LineChart from "./components/LineChart";
import LearningExperience from "./components/LearningExperience";
import {
  createCsv,
  loadParameters,
  parseParameters,
  saveParameters,
  serializeParameters,
} from "./lib/io";
import { downloadBlob, exportPng, rasterize } from "./lib/images";
const PatternScene = lazy(() => import("./components/PatternScene"));
const Sandbox = lazy(() => import("./sandbox/Sandbox"));
type LearningMode = "guided" | "explore" | "sandbox";
const LEARNING_MODES: readonly string[] = ["guided", "explore", "sandbox"];
const COLORS = ["#5ee4bd", "#b7a0fa", "#edbd79"];
type Tab = "lab" | "notes" | "limits";
function format(v: number, digits = 3) {
  return Number.isFinite(v) ? v.toFixed(digits) : "N/A";
}

function Raster({
  values,
  width,
  height,
  kind = "intensity",
  testId,
  onSelect,
  probe,
}: {
  values: ArrayLike<number>;
  width: number;
  height: number;
  kind?: "intensity" | "phase" | "valid";
  testId?: string;
  onSelect?: (x: number, y: number) => void;
  probe?: [number, number];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current,
      ctx = c?.getContext("2d");
    if (c && ctx) {
      c.width = width;
      c.height = height;
      ctx.drawImage(rasterize(values, width, height, kind), 0, 0);
    }
  }, [values, width, height, kind]);
  return (
    <div
      className={`raster-wrap ${onSelect ? "pickable" : ""}`}
      onPointerDown={(e) => {
        if (onSelect) {
          const r = e.currentTarget.getBoundingClientRect();
          onSelect(
            Math.min(
              width - 1,
              Math.floor(((e.clientX - r.left) / r.width) * width),
            ),
            Math.min(
              height - 1,
              Math.floor(((e.clientY - r.top) / r.height) * height),
            ),
          );
        }
      }}
    >
      <canvas
        ref={ref}
        data-testid={testId}
        aria-label={
          kind === "phase"
            ? "Wrapped Phase 彩色圖，暗色為無效像素"
            : kind === "valid"
              ? "有效像素遮罩"
              : "合成條紋量測影像"
        }
      />
      {probe && (
        <>
          <span
            className="raster-cross vertical-cross"
            style={{ left: `${((probe[0] + 0.5) / width) * 100}%` }}
          />
          <span
            className="raster-cross horizontal-cross"
            style={{ top: `${((probe[1] + 0.5) / height) * 100}%` }}
          />
          <span
            className="raster-point"
            style={{
              left: `${((probe[0] + 0.5) / width) * 100}%`,
              top: `${((probe[1] + 0.5) / height) * 100}%`,
            }}
          />
        </>
      )}
    </div>
  );
}
function SectionTitle({
  number,
  title,
  english,
  children,
}: {
  number: string;
  title: string;
  english: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div className="section-name">
        <span className="section-number">{number}</span>
        <h2>
          {title}
          <span>{english}</span>
        </h2>
      </div>
      {children}
    </div>
  );
}
function Control({
  label,
  english,
  symbol,
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
  hint,
  testId,
}: {
  label: string;
  english: string;
  symbol: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="control">
      <label htmlFor={english}>
        <span>
          {label} <i>{symbol}</i>
        </span>
        <output data-testid={testId}>
          {formatValue ? formatValue(value) : value.toFixed(2)}
        </output>
      </label>
      <input
        id={english}
        aria-label={english}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={
          {
            "--range-fill": `${((value - min) / (max - min)) * 100}%`,
          } as React.CSSProperties
        }
      />
      <div className="range-limits">
        <span>{Number.isInteger(min) ? min : min.toFixed(2)}</span>
        <span>{Number.isInteger(max) ? max : max.toFixed(2)}</span>
      </div>
      {hint && <p className="control-hint">{hint}</p>}
    </div>
  );
}
function initialState(): { config: SimulationConfig; message: string } {
  try {
    const saved = loadParameters(localStorage);
    return {
      config: saved ?? { ...DEFAULT_CONFIG },
      message: saved ? "已還原此瀏覽器保存的參數。" : "",
    };
  } catch {
    return {
      config: { ...DEFAULT_CONFIG },
      message: "無法讀取保存的參數，已使用預設值；原資料未覆寫。",
    };
  }
}

export default function App() {
  // The multi-view analysis lives inside the sandbox; ?workspace=aoi opens that tab.
  const [initialSandboxView] = useState(() =>
    new URLSearchParams(location.search).get("workspace") === "aoi"
      ? ("multiview" as const)
      : ("sandbox" as const),
  );
  const [learningMode, setLearningMode] = useState<LearningMode>(() => {
    const requested = new URLSearchParams(location.search).get("workspace");
    if (requested === "aoi") return "sandbox";
    if (requested && LEARNING_MODES.includes(requested))
      return requested as LearningMode;
    try {
      const saved = sessionStorage.getItem("structured-light.view-mode");
      return saved && LEARNING_MODES.includes(saved)
        ? (saved as LearningMode)
        : "sandbox";
    } catch {
      return "sandbox";
    }
  });
  const changeMode = (mode: LearningMode) => {
    setLearningMode(mode);
    const url = new URL(location.href);
    if (mode === "sandbox") url.searchParams.set("workspace", mode);
    else url.searchParams.delete("workspace");
    history.replaceState(null, "", url);
    try {
      sessionStorage.setItem("structured-light.view-mode", mode);
    } catch {
      /* Optional view preference: the in-memory mode still works. */
    }
  };
  const [initial] = useState(initialState),
    [config, setConfig] = useState(initial.config),
    [message, setMessage] = useState(initial.message),
    [tab, setTab] = useState<Tab>("lab"),
    [view, setView] = useState<"captures" | "scene">("captures"),
    [mapView, setMapView] = useState<"phase" | "valid">("phase"),
    [probeFraction, setProbeFraction] = useState(0.37),
    [probeRowFraction, setProbeRowFraction] = useState(0.5),
    [showUnwrap, setShowUnwrap] = useState(true),
    [dirty, setDirty] = useState(false),
    [importError, setImportError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const importGeneration = useRef(0);
  const result = useMemo(() => runSimulation(config), [config]);
  const probeX = Math.round(probeFraction * (config.width - 1)),
    probeY = Math.round(probeRowFraction * (config.height - 1)),
    index = probeY * config.width + probeX;
  const row = probeY * config.width;
  const intensitySeries = result.captures.frames.map((f, k) => ({
    values: f.subarray(row, row + config.width),
    color: COLORS[k],
    label: `I${k + 1}`,
  }));
  const phaseSeries = [
    {
      values: result.phase.wrapped.subarray(row, row + config.width),
      color: "#b7a0fa",
      label: "Wrapped Phase",
    },
    ...(showUnwrap
      ? [
          {
            values: result.unwrapped.subarray(row, row + config.width),
            color: "#5ee4bd",
            label: "Relative Unwrapped",
          },
        ]
      : []),
  ];
  const bounds = useMemo(() => {
    let min = -Math.PI,
      max = Math.PI;
    if (showUnwrap)
      for (const n of result.unwrapped.subarray(row, row + config.width)) {
        if (Number.isFinite(n)) {
          min = Math.min(min, n);
          max = Math.max(max, n);
        }
      }
    return { min: min - 0.15, max: max + 0.15 };
  }, [result, row, config.width, showUnwrap]);
  const estimatedPhi = result.phase.wrapped[index],
    estimatedA = result.phase.mean[index],
    estimatedB = result.phase.modulation[index];
  const fitted = Float64Array.from({ length: 241 }, (_, i) =>
    Number.isFinite(estimatedPhi)
      ? estimatedA + estimatedB * Math.cos((TAU * i) / 240 + estimatedPhi)
      : NaN,
  );
  const update = <K extends keyof SimulationConfig>(
    key: K,
    value: SimulationConfig[K],
  ) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setDirty(true);
    setMessage("");
  };
  const choosePixel = (x: number, y: number) => {
    setProbeFraction(Math.max(0, x / (config.width - 1)));
    setProbeRowFraction(
      config.height === 1 ? 0 : Math.max(0, y / (config.height - 1)),
    );
  };
  const notify = (s: string) => {
    setImportError("");
    setMessage(s);
  };
  const save = () => {
    try {
      saveParameters(localStorage, config);
      const readback = loadParameters(localStorage);
      if (JSON.stringify(readback) !== JSON.stringify(config))
        throw new Error("readback mismatch");
      setDirty(false);
      notify("已保存參數至此瀏覽器。跨裝置請使用 JSON 匯出。");
    } catch {
      setImportError("保存失敗：瀏覽器儲存空間不可用。可改用 JSON 匯出。");
    }
  };
  const exportJson = () => {
    downloadBlob(
      new Blob([serializeParameters(config)], { type: "application/json" }),
      "structured-light-parameters.json",
    );
    notify("已匯出可重現的 JSON 參數。");
  };
  const exportCsv = () => {
    downloadBlob(
      new Blob(["\uFEFF" + createCsv(config, result)], {
        type: "text/csv;charset=utf-8",
      }),
      "structured-light-data.csv",
    );
    notify(
      `已匯出全部 ${config.width * config.height} 個像素的 CSV；相位單位為 rad。`,
    );
  };
  const reset = () => {
    setConfig({ ...DEFAULT_CONFIG });
    setDirty(true);
    setProbeFraction(0.37);
    setProbeRowFraction(0.5);
    notify("已重設目前實驗；不會覆寫已保存的參數。");
  };
  if (tab === "lab" && learningMode === "sandbox")
    return (
      <Suspense
        fallback={<div className="scene-loading">正在建立 3D 沙盒…</div>}
      >
        <Sandbox
          onGuide={() => changeMode("guided")}
          onExplore={() => changeMode("explore")}
          initialView={initialSandboxView}
        />
      </Suspense>
    );
  if (tab === "lab" && learningMode === "guided")
    return (
      <LearningExperience
        config={config}
        result={result}
        probeX={probeX}
        probeY={probeY}
        onApplyConfig={(next) => {
          importGeneration.current++;
          setConfig(next);
          setDirty(true);
          setMessage("");
          setImportError("");
        }}
        onSelectX={setProbeFraction}
        onChoosePixel={choosePixel}
        onExplore={() => changeMode("explore")}
        onSandbox={() => changeMode("sandbox")}
        onReadNotes={() => setTab("notes")}
        onReadLimits={() => setTab("limits")}
      />
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("lab");
          }}
        >
          <span className="brand-icon">
            <ScanLine size={23} />
          </span>
          <span>
            Structured
            <span className="brand-second">
              Light Lab<span className="brand-dot">.</span>
            </span>
          </span>
        </a>
        <div className="sidebar-label">LEARNING WORKSPACE</div>
        <nav className="main-nav" aria-label="主導覽">
          <button
            className={tab === "lab" ? "active" : ""}
            onClick={() => setTab("lab")}
          >
            <FlaskConical size={18} />
            互動實驗<span className="nav-shortcut">01</span>
          </button>
          <button
            className={tab === "notes" ? "active" : ""}
            onClick={() => setTab("notes")}
          >
            <BookOpen size={18} />
            原理筆記
          </button>
          <button
            className={tab === "limits" ? "active" : ""}
            onClick={() => setTab("limits")}
          >
            <ShieldCheck size={18} />
            實作邊界
          </button>
        </nav>
        <div className="sidebar-label roadmap-label">DEVELOPMENT ROADMAP</div>
        <div className="roadmap">
          <button
            className="roadmap-item current"
            onClick={() => setTab("lab")}
          >
            <span className="roadmap-step">01</span>
            <span>
              <strong>Phase Shifting</strong>
              <small>三步相移與數學模型</small>
            </span>
            <span className="live-dot" />
          </button>
          {[
            [Box, "02", "Virtual 3D Scanner", "3D 沙盒 · 基礎版已支援"],
            [Layers3, "03", "Micro Phase Shifting", "Gupta & Nayar · F+2"],
            [Activity, "04", "Non-ideal Effects", "物理效應與誤差分析"],
          ].map(([Icon, n, title, sub]) => {
            const I = Icon as typeof Box;
            return (
              <button
                className={
                  n === "02"
                    ? "roadmap-item sandbox-ready"
                    : "roadmap-item future"
                }
                key={String(n)}
                onClick={() => {
                  if (n === "02") {
                    setTab("lab");
                    changeMode("sandbox");
                  } else setTab("limits");
                }}
                title={
                  n === "02"
                    ? "進入 3D 沙盒（已知校正基礎版）"
                    : "尚未實作，查看開發範圍"
                }
              >
                <span className="roadmap-step">{n as string}</span>
                <span>
                  <strong>{title as string}</strong>
                  <small>{sub as string}</small>
                </span>
                <I size={14} />
              </button>
            );
          })}
        </div>
        <div className="sidebar-bottom">
          <div className="model-badge">
            <span className="live-dot" />
            MVP 1 <span>數學實驗</span>
          </div>
          <p>
            先理解 phase，
            <br />
            再走進三維空間。
          </p>
          <div className="sidebar-version">
            <Code2 size={13} />
            <span>LOCAL EXPERIMENT · v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            工作空間
            <ChevronRight size={13} />
            <span>三步 Phase Shifting</span>
          </div>
          <div className="top-meta">
            <span className="linear-pill">
              <span />
              Linear response
            </span>
            <span className="local-label">本機運算 · 無資料上傳</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="mint">EXPERIMENT 01</span>
                <span className="tiny-divider" />
                THE FOUNDATION
              </div>
              <h1>
                {tab === "lab"
                  ? "從三張條紋，讀懂相位。"
                  : tab === "notes"
                    ? "讓每一個符號，都有意義。"
                    : "知道模型沒有做什麼，同樣重要。"}
              </h1>
              <p>
                {tab === "lab"
                  ? "調整光強、移動探針，觀察 Sinusoidal Fringe 如何成為可量測的 Phase。"
                  : tab === "notes"
                    ? "從 intensity、相移到解包裹，一次理解一個環節。"
                    : "可驗證的結果，建立在清楚的假設與限制之上。"}
              </p>
            </div>
            <button
              className="help-button"
              onClick={() => {
                setTab("lab");
                changeMode("guided");
              }}
              aria-label="一步一步學"
            >
              <CircleHelp size={18} />
              <span>一步一步學</span>
              <ArrowRight size={14} />
            </button>
          </div>
          {tab === "lab" ? (
            <>
              <div className="experiment-toolbar">
                <div className="experiment-title">
                  <Waves size={18} />
                  <strong>Three-step Phase Shifting</strong>
                  <span className="subtle-badge">3 frames · 120°</span>
                </div>
                <div className="toolbar-actions">
                  <button onClick={save}>
                    <Save size={14} />
                    保存參數{dirty && <span className="unsaved-dot" />}
                  </button>
                  <button
                    onClick={() => file.current?.click()}
                    title="匯入 JSON 參數"
                    aria-label="匯入參數"
                  >
                    <Upload size={14} />
                  </button>
                  <button
                    onClick={exportJson}
                    title="匯出 JSON 參數"
                    aria-label="匯出 JSON 參數"
                  >
                    <FileJson size={15} />
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    onClick={() =>
                      void exportPng(config, result, probeX, probeY)
                        .then(() => notify("已匯出 PNG 實驗快照。"))
                        .catch((e) => setImportError(String(e)))
                    }
                  >
                    <ArrowDownToLine size={14} />
                    PNG
                  </button>
                  <button onClick={exportCsv}>
                    <ArrowDownToLine size={14} />
                    CSV
                  </button>
                </div>
              </div>
              <div className="lab-layout">
                <div className="experiment-content">
                  <section className="card captures-card">
                    <SectionTitle
                      number="01"
                      title="投影與取樣"
                      english="FRINGE PATTERNS"
                    >
                      <div className="segmented" aria-label="影像檢視">
                        <button
                          className={view === "captures" ? "selected" : ""}
                          onClick={() => setView("captures")}
                        >
                          <ScanLine size={13} />
                          2D 量測
                        </button>
                        <button
                          className={view === "scene" ? "selected" : ""}
                          onClick={() => setView("scene")}
                        >
                          <Box size={13} />
                          WebGL 示意
                        </button>
                      </div>
                    </SectionTitle>
                    {view === "captures" ? (
                      <div className="capture-grid">
                        {result.captures.frames.map((frame, k) => (
                          <div className="capture-tile" key={k}>
                            <div className="capture-label">
                              <span>
                                <span
                                  className="color-dot"
                                  style={{ background: COLORS[k] }}
                                />
                                I<sub>{k + 1}</sub>
                              </span>
                              <span>δ = {k * 120}°</span>
                            </div>
                            <Raster
                              values={frame}
                              width={config.width}
                              height={config.height}
                              testId={`capture-${k}`}
                              onSelect={choosePixel}
                              probe={[probeX, probeY]}
                            />
                            <div className="capture-footer">
                              <span>
                                {k === 0 ? "0" : k === 1 ? "2π/3" : "4π/3"}
                              </span>
                              <span>
                                {config.width} × {config.height} px
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Suspense
                        fallback={
                          <div className="scene-loading">載入 Three.js…</div>
                        }
                      >
                        <PatternScene
                          frame={result.captures.frames[0]}
                          width={config.width}
                          height={config.height}
                        />
                      </Suspense>
                    )}
                    <div className="card-footnote">
                      <Info size={13} />
                      <span>
                        理想化、逐點線性 intensity 合成；不是 Camera–Projector
                        幾何成像。
                      </span>
                      <span className="push-right mono">
                        I<sub>k</sub> = A + B cos(φ + δ<sub>k</sub>)
                      </span>
                    </div>
                  </section>
                  <section className="card intensity-card">
                    <SectionTitle
                      number="02"
                      title="一維光強曲線"
                      english="INTENSITY PROFILE"
                    >
                      <span className="chart-instruction">
                        <MousePointer2 size={13} />
                        拖曳曲線以移動探針
                      </span>
                    </SectionTitle>
                    <div className="chart-meta">
                      <div className="legend">
                        {COLORS.map((color, k) => (
                          <span key={k}>
                            <i style={{ background: color }} />I
                            <sub>{k + 1}</sub>
                            <small>{k * 120}°</small>
                          </span>
                        ))}
                      </div>
                      <span className="axis-title">Intensity [0, 1]</span>
                    </div>
                    <LineChart
                      series={intensitySeries}
                      min={0}
                      max={1}
                      selected={probeFraction}
                      onSelect={setProbeFraction}
                      testId="intensity-chart"
                    />
                    <div className="chart-bottom">
                      <span>Camera / Projector 共用的一維座標（簡化）</span>
                      <span>x / (W − 1)</span>
                    </div>
                    <div className="probe-strip">
                      <div className="probe-position">
                        <Focus size={16} />
                        <span>像素探針</span>
                        <strong data-testid="probe-value">x = {probeX}</strong>
                        <span className="muted mono">y = {probeY}</span>
                      </div>
                      <div className="probe-intensities">
                        {result.captures.frames.map((frame, k) => (
                          <span key={k} style={{ color: COLORS[k] }}>
                            I<sub>{k + 1}</sub> <b>{format(frame[index])}</b>
                          </span>
                        ))}
                      </div>
                      <span
                        className={`valid-label ${result.phase.valid[index] ? "" : "invalid"}`}
                      >
                        {result.phase.valid[index] ? (
                          <>
                            <Check size={12} />
                            VALID
                          </>
                        ) : (
                          <>INVALID</>
                        )}
                      </span>
                    </div>
                  </section>
                  <section className="card phase-card">
                    <SectionTitle
                      number="03"
                      title="從量測解出相位"
                      english="PHASE RECOVERY"
                    >
                      <button
                        className="text-button"
                        onClick={() => setTab("notes")}
                      >
                        查看推導
                        <ArrowRight size={13} />
                      </button>
                    </SectionTitle>
                    <div className="phase-upper">
                      <div className="phase-map-area">
                        <div className="map-title">
                          <span>
                            {mapView === "phase"
                              ? "Wrapped Phase"
                              : "Validity mask"}
                          </span>
                          <div className="segmented mini">
                            <button
                              className={mapView === "phase" ? "selected" : ""}
                              onClick={() => setMapView("phase")}
                            >
                              Phase
                            </button>
                            <button
                              className={mapView === "valid" ? "selected" : ""}
                              onClick={() => setMapView("valid")}
                            >
                              Valid
                            </button>
                          </div>
                        </div>
                        <Raster
                          values={
                            mapView === "phase"
                              ? result.phase.wrapped
                              : result.phase.valid
                          }
                          width={config.width}
                          height={config.height}
                          kind={mapView}
                          testId="phase-map"
                          onSelect={choosePixel}
                          probe={[probeX, probeY]}
                        />
                        <div className="phase-colorbar">
                          <span>{mapView === "phase" ? "−π" : "無效"}</span>
                          <div
                            className={
                              mapView === "phase" ? "colorbar" : "validbar"
                            }
                          />
                          <span>{mapView === "phase" ? "+π" : "有效"}</span>
                        </div>
                      </div>
                      <div className="equation-area">
                        <span className="equation-label">
                          三步解算 · 僅使用 I₁、I₂、I₃
                        </span>
                        <div className="equation">
                          φ̂ = atan2 <span className="equation-paren">(</span>
                          <span className="atan2-args">
                            <span>√3 (I₃ − I₂),</span>
                            <span>2I₁ − I₂ − I₃</span>
                          </span>
                          <span className="equation-paren">)</span>
                        </div>
                        <p>
                          此處為 atan2 的兩個輸入，不是單純取商。
                          <br />
                          保留象限，得到 <span className="mono">
                            [−π, π)
                          </span>{" "}
                          的 Wrapped Phase。
                        </p>
                        <div className="estimated-value">
                          <span>目前探針 φ̂</span>
                          <strong data-testid="estimated-phase">
                            {format(estimatedPhi)}
                            <small>rad</small>
                          </strong>
                        </div>
                        <div
                          className="probe-radiometry"
                          aria-label="由 captures 估計的光強參數"
                        >
                          <span>
                            Â ={" "}
                            <b data-testid="estimated-mean">
                              {format(estimatedA)}
                            </b>
                          </span>
                          <span>
                            B̂ ={" "}
                            <b data-testid="estimated-modulation">
                              {format(estimatedB)}
                            </b>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="phase-chart-head">
                      <div className="legend">
                        <span>
                          <i style={{ background: "#b7a0fa" }} />
                          Wrapped Phase
                        </span>
                        <span>
                          <i style={{ background: "#5ee4bd" }} />
                          Relative Unwrapped
                        </span>
                      </div>
                      <label className="switch-label">
                        <input
                          type="checkbox"
                          checked={showUnwrap}
                          onChange={(e) => setShowUnwrap(e.target.checked)}
                        />
                        <span className="switch" />
                        顯示 1D Unwrap
                      </label>
                    </div>
                    <LineChart
                      series={phaseSeries}
                      min={bounds.min}
                      max={bounds.max}
                      selected={probeFraction}
                      onSelect={setProbeFraction}
                      compact
                      testId="phase-chart"
                    />
                    <div className="card-footnote warning">
                      <Info size={13} />
                      <span>
                        Spatial Unwrap 僅恢復連續區段的相對
                        phase；未知整數週期仍存在，不能當作絕對深度。
                      </span>
                    </div>
                  </section>
                  <section className="card temporal-card">
                    <SectionTitle
                      number="04"
                      title="固定一點，看三次相移"
                      english="TEMPORAL SAMPLING"
                    >
                      <span className="subtle-badge">
                        探針 x={probeX} · y={probeY}
                      </span>
                    </SectionTitle>
                    <div className="temporal-layout">
                      <div>
                        <LineChart
                          series={[
                            {
                              values: fitted,
                              color: "#7690aa",
                              label: "Estimated temporal response",
                              dashed: true,
                            },
                          ]}
                          min={0}
                          max={1}
                          compact
                          xLabels={["0°", "90°", "180°", "270°", "360°"]}
                          markers={result.captures.frames.map((f, k) => ({
                            x: k / 3,
                            y: f[index],
                            color: COLORS[k],
                          }))}
                        />
                        <div className="chart-bottom">
                          <span>虛線：由三筆量測擬合，不是額外曝光</span>
                          <span>相移 δ</span>
                        </div>
                      </div>
                      <div className="temporal-copy">
                        <Waves size={22} />
                        <h3>
                          空間位置不動，
                          <br />
                          只改變 Projector 的相移。
                        </h3>
                        <p>
                          三次 intensity 的差異，告訴我們這個像素落在條紋的哪個
                          phase，而非它有多亮。
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
                <aside className="parameters">
                  <section className="card parameters-card">
                    <div className="parameter-title">
                      <Settings2 size={16} />
                      <h2>實驗參數</h2>
                      <button
                        onClick={reset}
                        title="重設預設值"
                        aria-label="重設預設值"
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                    <div className="parameter-section-label">
                      PROJECTED SIGNAL
                    </div>
                    <Control
                      label="條紋頻率"
                      english="Fringe frequency"
                      symbol="f"
                      value={config.frequency}
                      min={0.25}
                      max={Math.min(32, (config.width - 1) / 2 - 0.25)}
                      step={0.25}
                      onChange={(v) => update("frequency", v)}
                      formatValue={(v) => v.toFixed(2).replace(/0$/, "")}
                      testId="frequency-value"
                      hint="橫跨影像的週期數 · cycles / width"
                    />
                    <Control
                      label="初始相位"
                      english="Phase offset"
                      symbol="φ₀"
                      value={config.phaseOffset}
                      min={-TAU}
                      max={TAU}
                      step={0.01}
                      onChange={(v) => update("phaseOffset", v)}
                      formatValue={(v) => `${v.toFixed(2)} rad`}
                    />
                    <Control
                      label="平均光強"
                      english="Mean intensity"
                      symbol="A"
                      value={config.mean}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={(v) => update("mean", v)}
                    />
                    <Control
                      label="調變振幅"
                      english="Modulation amplitude"
                      symbol="B"
                      value={config.amplitude}
                      min={0}
                      max={0.5}
                      step={0.01}
                      onChange={(v) => update("amplitude", v)}
                    />
                    <div className="parameter-divider" />
                    <div className="parameter-section-label">
                      SYNTHETIC SENSOR{" "}
                      <span className="mini-tag">簡化模型</span>
                    </div>
                    <Control
                      label="Gaussian Noise"
                      english="Noise sigma"
                      symbol="σ"
                      value={config.noiseSigma}
                      min={0}
                      max={0.15}
                      step={0.005}
                      onChange={(v) => update("noiseSigma", v)}
                      formatValue={(v) => v.toFixed(3)}
                      hint="獨立加性雜訊；非完整 sensor noise"
                    />
                    <div className="seed-control">
                      <label htmlFor="seed">
                        固定隨機種子 <span>Seed</span>
                      </label>
                      <div>
                        <input
                          id="seed"
                          type="number"
                          min={0}
                          max={4294967295}
                          value={config.seed}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (
                              Number.isInteger(n) &&
                              n >= 0 &&
                              n <= 4294967295
                            )
                              update("seed", n);
                          }}
                        />
                        <button
                          title="使用下一個種子"
                          aria-label="下一個種子"
                          onClick={() =>
                            update("seed", (config.seed + 1) >>> 0)
                          }
                        >
                          <RotateCcw size={13} />
                        </button>
                      </div>
                    </div>
                    <details className="advanced">
                      <summary>
                        <SlidersHorizontal size={13} />
                        進階解算設定
                        <ChevronRight size={12} />
                      </summary>
                      <Control
                        label="有效振幅門檻"
                        english="Minimum modulation"
                        symbol="Bmin"
                        value={config.minModulation}
                        min={0}
                        max={0.3}
                        step={0.005}
                        onChange={(v) => update("minModulation", v)}
                        formatValue={(v) => v.toFixed(3)}
                      />
                      <label className="resolution-label">
                        影像寬度
                        <select
                          aria-label="Image width"
                          value={config.width}
                          onChange={(e) =>
                            update("width", Number(e.target.value))
                          }
                        >
                          {[...new Set([256, 512, 1024, config.width])]
                            .sort((a, b) => a - b)
                            .map((w) => (
                              <option key={w} value={w}>
                                {w} px
                              </option>
                            ))}
                        </select>
                      </label>
                    </details>
                    <div className="sensor-note">
                      <Info size={13} />
                      <p>
                        Intensity 會硬截斷至 [0,
                        1]；任一張達到上下限的像素將被判為無效。沒有 Gamma
                        或量化。
                      </p>
                    </div>
                  </section>
                  <section className="card metrics-card">
                    <div className="metrics-title">
                      <Activity size={15} />
                      <h2>量測品質</h2>
                      <span className="live-pill">LIVE</span>
                    </div>
                    <div className="metric">
                      <div>
                        <span>Circular Phase RMSE</span>
                        <CircleHelp size={12} />
                      </div>
                      <strong data-testid="rmse">
                        {result.metrics.rmse === null
                          ? "N/A"
                          : result.metrics.rmse < 1e-12
                            ? "< 10⁻¹²"
                            : result.metrics.rmse.toExponential(2)}
                      </strong>
                      <span className="metric-unit">
                        rad · 有效像素的 circular error
                      </span>
                    </div>
                    <div className="metric">
                      <div>
                        <span>Valid Pixel Ratio</span>
                        <span className="metric-small">
                          {result.metrics.validCount.toLocaleString()} /{" "}
                          {result.metrics.totalCount.toLocaleString()}
                        </span>
                      </div>
                      <strong data-testid="valid-ratio">
                        {(result.metrics.validRatio * 100).toFixed(1)}%
                      </strong>
                      <div className="quality-bar">
                        <span
                          style={{
                            width: `${result.metrics.validRatio * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <p className="metrics-note">
                      Reference Phase 僅用於誤差評估，沒有輸入 Decoder 或
                      Unwrap。
                    </p>
                    {result.metrics.validCount === 0 && (
                      <p className="no-valid" role="alert">
                        目前沒有有效像素
                      </p>
                    )}
                  </section>
                  <div className="learning-tip">
                    <span>
                      <BookOpen size={15} />
                      試試看
                    </span>
                    <p>
                      先把振幅 B 降低，再加入 Noise。為什麼亮度變化很小，Phase
                      卻開始不穩定？
                    </p>
                    <button
                      onClick={() => {
                        setConfig((c) => ({
                          ...c,
                          mean: 0.5,
                          amplitude: 0.06,
                          noiseSigma: 0.025,
                        }));
                        setDirty(true);
                        notify(
                          "已套用低振幅＋雜訊範例。比較 Circular RMSE，並觀察 phase 曲線。",
                        );
                      }}
                    >
                      套用這個實驗
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </aside>
              </div>
              <footer className="page-footer">
                <span>
                  <ShieldCheck size={13} />
                  Float64 數學解算 · 不使用 Ground Truth 重建
                </span>
                <button onClick={() => setTab("limits")}>
                  檢視假設、限制與後續階段
                  <ArrowRight size={13} />
                </button>
              </footer>
            </>
          ) : tab === "notes" ? (
            <Notes onBack={() => setTab("lab")} />
          ) : (
            <Limits onBack={() => setTab("lab")} />
          )}
        </main>
      </div>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const chosen = e.target.files?.[0];
          e.target.value = "";
          if (!chosen) return;
          const generation = ++importGeneration.current;
          try {
            if (chosen.size > 1_048_576) throw new Error("檔案超過 1 MB");
            const next = parseParameters(await chosen.text());
            if (generation !== importGeneration.current) return;
            setConfig(next);
            setDirty(true);
            notify("已匯入並驗證參數。尚未覆寫此瀏覽器保存的設定。");
          } catch (err) {
            if (generation !== importGeneration.current) return;
            setImportError(
              `匯入失敗，原參數未變更：${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }}
      />
      {(message || importError) && (
        <div
          className={`toast ${importError ? "error" : ""}`}
          role={importError ? "alert" : "status"}
        >
          {importError ? <Info size={17} /> : <Check size={17} />}
          <span>{importError || message}</span>
          <button
            aria-label="關閉通知"
            onClick={() => {
              setMessage("");
              setImportError("");
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function Notes({ onBack }: { onBack: () => void }) {
  return (
    <div className="reading-layout">
      <section className="card reading-card">
        <span className="eyebrow mint">THE MODEL</span>
        <h2>三張影像裡，藏著三個未知數。</h2>
        <p>
          在固定像素上，平均光強 A、調變振幅 B 與 phase φ 都未知。改變 Projector
          的 δ，取得三個 intensity，就能解出這三個量。
        </p>
        <div className="large-equation">Iₖ(x, y) = A + B cos(φ(x) + δₖ)</div>
        <dl className="symbol-grid">
          <div>
            <dt>A</dt>
            <dd>
              平均光強 / DC offset
              <br />
              <small>本 MVP 的空間均勻合成常數，不等同完整環境光模型。</small>
            </dd>
          </div>
          <div>
            <dt>B</dt>
            <dd>
              調變振幅 / Modulation
              <br />
              <small>條紋的明暗變化量。B 太低時，phase 會對 noise 敏感。</small>
            </dd>
          </div>
          <div>
            <dt>φ</dt>
            <dd>
              像素所在的條紋位置
              <br />
              <small>φ(x) = 2πfx/(W−1) + φ₀；不是物體高度。</small>
            </dd>
          </div>
          <div>
            <dt>δₖ</dt>
            <dd>
              已知的 Projector 相移
              <br />
              <small>三步分別為 0、2π/3、4π/3（0°、120°、240°）。</small>
            </dd>
          </div>
        </dl>
        <hr />
        <h3>01 / 先消除 A，再利用象限恢復 φ</h3>
        <div className="formula-block">
          N = √3(I₃ − I₂) = 3B sin φ<br />D = 2I₁ − I₂ − I₃ = 3B cos φ<br />
          φ̂ = wrap(atan2(N, D)) ∈ [−π, π)
          <br />Â = (I₁ + I₂ + I₃) / 3<br />
          B̂ = √(N² + D²) / 3
        </div>
        <p>
          <strong>atan2(N, D) 不等於 atan(N/D)。</strong>分子、分母的符號讓
          atan2 能辨識象限；一般除法會失去這些資訊。正負號也依照 cos(φ + δ)
          的相移慣例，不能直接套用不同曝光順序的公式。
        </p>
        <h3>02 / Wrapped 不等於不正確</h3>
        <p>
          −π 附近與 +π 附近的相位其實相鄰，因此評估用 circular difference：
          <code>atan2(sin(φ̂−φref), cos(φ̂−φref))</code>，而不是直接相減。RMSE =
          √mean(error²)，只計有效像素；沒有有效像素時回報 N/A，不回報 0。
        </p>
        <h3>03 / Unwrap 解的是連續性，不是深度</h3>
        <div className="formula-block">
          ψ₀ = φ̂₀
          <br />
          ψⱼ = ψⱼ₋₁ + wrap(φ̂ⱼ − φ̂ⱼ₋₁)
        </div>
        <p>
          逐列從第一個有效像素開始，假設相鄰真實 phase 差值絕對值小於
          π。跨過無效像素不補值，而是重新開始一個區段。每個區段仍有未知的 2π
          整數偏移，不能藉由 reference 或已知 f 偷補 fringe order。
        </p>
        <h3>04 / 噪聲為什麼會被放大？</h3>
        <p>
          低雜訊、未截斷、B 足夠大時，一階近似 <code>σφ ≈ √(2/3) σ / B</code>
          。這是有效像素的局部近似，不是所有情況的保證。低 B、強 Noise、phase
          unwrap 跳錯整個週期時，不再可靠。
        </p>
        <h3>05 / 從相位走到 3D，還缺哪些步驟？</h3>
        <p>
          先由多頻率或其他編碼解除絕對 fringe order，再將 phase 轉為 Projector
          pixel correspondence。Camera Calibration 估計內參 K（焦距、主點）與
          distortion；Camera–Projector Calibration 估計彼此的旋轉 R 與平移
          t。最後以 Camera ray 和 Projector plane/ray 三角量測得到 3D。3D
          沙盒目前已支援已知合成校正、單週期 correspondence
          與三角量測；由校正板估參數及多頻 Micro PS 尚未實作。
        </p>
        <div className="reading-notice">
          <Info size={18} />
          <p>
            這裡的 Camera 座標與 Projector 座標刻意共用同一個 x。這只是在學習
            phase 解算，不代表兩台設備在真實世界會看到同一個像素。
          </p>
        </div>
        <button className="primary-button" onClick={onBack}>
          回到互動實驗
          <ArrowRight size={15} />
        </button>
      </section>
      <aside className="reading-aside">
        <span className="sidebar-label">建議學習順序</span>
        {[
          "調整 A，觀察光強平移",
          "調整 B，觀察明暗對比",
          "調整 φ₀，觀察條紋位移",
          "拖曳探針，讀取三次曝光",
          "觀察 Wrapped 的 ±π 跳變",
          "開啟 Relative Unwrap",
          "降低 B、加入 Noise",
          "匯出 CSV，檢查實際數據",
        ].map((s, i) => (
          <div key={s}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            {s}
          </div>
        ))}
      </aside>
    </div>
  );
}
function Limits({ onBack }: { onBack: () => void }) {
  return (
    <div className="limits-layout">
      <section className="card reading-card">
        <div className="implementation-status">
          <span className="live-dot" />
          已實作 · MVP 1
        </div>
        <h2>先把數學鏈路做對。</h2>
        <p>
          一維自由實驗是 intensity / phase 教學模型，其 WebGL
          平面紋理不產生深度。 獨立的 3D
          沙盒則已提供已知校正、單週期投影、遮擋與三角量測；這仍不是完整四階段
          Scanner。
        </p>
        <div className="boundary-grid">
          <div>
            <Check size={18} />
            <h3>真實演算法</h3>
            <p>
              三步 intensity 解算、Â / B̂、Wrapped Phase、逐列相對 Spatial
              Unwrap、有效像素遮罩。
            </p>
          </div>
          <div>
            <Check size={18} />
            <h3>可重現與評估</h3>
            <p>
              Mulberry32 Seed、Box–Muller Gaussian、Circular RMSE、Valid Pixel
              Ratio、完整像素 CSV、PNG 與版本化 JSON。
            </p>
          </div>
          <div>
            <Info size={18} />
            <h3>刻意簡化</h3>
            <p>
              共用一維座標、均勻 A / B、線性 normalized intensity、獨立加性
              Gaussian Noise 與 [0,1] hard clipping。不是
              radiometry、Poisson/read noise、Gamma、量化或完整 saturation
              物理模型。
            </p>
          </div>
          <div>
            <ShieldCheck size={18} />
            <h3>Ground Truth 隔離</h3>
            <p>
              referencePhase 由 forward model 產生，只進入 evaluator
              與標記清楚的 CSV 欄位。Decoder 與 Unwrap 的函式不接受 Ground
              Truth。
            </p>
          </div>
        </div>
        <hr />
        <h3>Validity 的明確定義</h3>
        <p>
          一個像素只有在三次曝光皆有限值、未達 [0,1] 邊界且估計 B̂ &gt;
          門檻時才有效。Ratio 分母是全部像素，不是已選中的列；Phase RMSE
          只評估有效像素，沒有 3D RMSE。硬截斷資料會被保守排除，可能使有效像素
          RMSE 偏樂觀，所以必須與 Valid Ratio 一起看。
        </p>
        <h3>Unwrap 的可識別性限制</h3>
        <p>
          單頻只有相對 phase；有遮罩時各區段的週期偏移也不同。本版不報 Absolute
          Unwrapped RMSE，不以真實 f 或 reference 對齊，不將 phase
          偽裝成高度。即使 Circular RMSE 很低，Unwrap 仍可能跳錯 2π。
        </p>
        <button className="primary-button" onClick={onBack}>
          回到互動實驗
          <ArrowRight size={15} />
        </button>
      </section>
      <section className="card reading-card roadmap-details">
        <span className="eyebrow mint">開發範圍 / 已實作與後續</span>
        <h2>四階段，逐步建立可驗證模型。</h2>
        {[
          [
            "02",
            "Virtual 3D Scanner",
            "Pinhole Camera–Projector 內外參、ray–surface intersection、可見性與遮擋、GT depth 隔離、幾何三角量測；再加入 calibration 誤差。",
          ],
          [
            "03",
            "Micro Phase Shifting",
            "依 Gupta & Nayar（CVPR 2012）原文實作窄高頻帶 F+2 曝光、共享 offset / amplitude 假設、column correspondence 搜尋，並以相同曝光預算對比 Conventional PS。不是用三步 PS 換個名稱。",
          ],
          [
            "04",
            "Non-ideal Effects",
            "Defocus PSF、Interreflection / transport、空間變動 radiometry、sensor noise、Gamma、saturation 與量化；加入 depth RMSE、失效率、參數掃描與誤差傳播。",
          ],
        ].map(([n, title, body]) => (
          <article key={n}>
            <span>{n}</span>
            <div>
              <h3>
                {title}
                <small>{n === "02" ? "基礎沙盒已支援" : "尚未實作"}</small>
              </h3>
              <p>{body}</p>
            </div>
          </article>
        ))}
        <p className="source-note">
          研究參考：M. Gupta & S. K. Nayar, “Micro Phase Shifting,” CVPR
          2012。原文與實作計畫見專案 README。
        </p>
      </section>
    </div>
  );
}
