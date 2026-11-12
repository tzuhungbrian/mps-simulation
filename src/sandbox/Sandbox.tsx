import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  Maximize2,
  Minimize2,
  RotateCcw,
  Save,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import {
  DEFAULT_WORLD,
  PCB_SETUP,
  parseWorldConfig,
  validateWorldConfig,
  WORLD_LIMITS,
  type WorldConfig,
  type WorldScan,
} from "./scanner";
import { MATERIAL_PRESETS } from "./lightTransport";
import PointCloudPage from "./PointCloudPage";
import type { ScanRequest, ScanResponse } from "./scan.worker";
import WorldView, { type WorldViewApi } from "./WorldView";
import { downloadBlob, rasterize } from "../lib/images";
import { TAU } from "../core/simulation";
import "./sandbox.css";

type Scan = WorldScan;
type NumericKey = keyof typeof WORLD_LIMITS;
const KEY = "structured-light.sandbox.parameters.v3";
const MODEL = "calibrated-one-cycle-sandbox";
const SCHEMA = 3;
function loadWorld(): WorldConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_WORLD };
    const e = JSON.parse(raw);
    if (e.schemaVersion !== SCHEMA || e.model !== MODEL)
      return { ...DEFAULT_WORLD };
    return parseWorldConfig(e.config);
  } catch {
    return { ...DEFAULT_WORLD };
  }
}
function pack(config: WorldConfig) {
  return JSON.stringify(
    { schemaVersion: SCHEMA, model: MODEL, config },
    null,
    2,
  );
}
const f = (value: number, n = 3) =>
  Number.isFinite(value) ? value.toFixed(n) : "N/A";
const mm = (metres: number) =>
  metres < 0.000001 ? "＜ 0.001" : (metres * 1000).toFixed(3);

function Image({
  values,
  width,
  height,
  testId,
  onPick,
  probe,
  kind = "intensity",
  gain = 1,
  scale = 1,
  label,
}: {
  values: Float64Array;
  width: number;
  height: number;
  testId: string;
  onPick: (index: number) => void;
  probe: number;
  kind?: "intensity" | "phase" | "depth" | "error";
  /** Display multiplier for intensity images. */
  gain?: number;
  /** Symmetric colour range for error images, in metres. */
  scale?: number;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (kind === "depth" || kind === "error") {
      const image = ctx.createImageData(width, height);
      for (let i = 0; i < values.length; i++) {
        const d = values[i];
        let rgb: number[];
        if (!Number.isFinite(d)) rgb = [14, 23, 35];
        else if (kind === "error") {
          const t = Math.max(-1, Math.min(1, d / scale));
          rgb = [128 + 127 * t, 128 - 90 * Math.abs(t), 128 - 127 * t];
        } else {
          const t = Math.max(0, Math.min(1, (d - 1) / 9));
          rgb = [255 * (1 - t), 180 * (1 - Math.abs(t - 0.5)), 255 * t];
        }
        image.data.set([...rgb, 255], i * 4);
      }
      ctx.putImageData(image, 0, 0);
    } else
      ctx.drawImage(
        rasterize(
          gain === 1 ? values : values.map((v) => Math.min(1, v * gain)),
          width,
          height,
          kind,
        ),
        0,
        0,
      );
  }, [values, width, height, kind, gain, scale]);
  return (
    <div
      className="sandbox-image"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect(),
          x = Math.max(
            0,
            Math.min(
              width - 1,
              Math.floor(((e.clientX - r.left) / r.width) * width),
            ),
          ),
          y = Math.max(
            0,
            Math.min(
              height - 1,
              Math.floor(((e.clientY - r.top) / r.height) * height),
            ),
          );
        onPick(y * width + x);
      }}
    >
      <canvas
        ref={ref}
        data-testid={testId}
        aria-label={
          label ??
          (kind === "intensity"
            ? "Camera 實際合成量測；點擊查看像素深度"
            : kind === "depth"
              ? "由條紋解碼與三角量測得到的 Camera Z depth"
              : "解碼所得 Wrapped Phase")
        }
      />
      <span
        className="sandbox-image-probe"
        style={{
          left: `${(((probe % width) + 0.5) / width) * 100}%`,
          top: `${((Math.floor(probe / width) + 0.5) / height) * 100}%`,
        }}
      />
    </div>
  );
}

/** Label + typed value + range on one compact row. */
function Field({
  label,
  value,
  min,
  max,
  step = 0.05,
  unit = "",
  digits = 2,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  digits?: number;
  onChange: (value: number) => void;
  testId?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    const v = Number(text);
    if (text.trim() !== "" && Number.isFinite(v))
      onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <div className="sandbox-field">
      <span className="sandbox-field-label">{label}</span>
      <span className="sandbox-field-value">
        <input
          type="number"
          aria-label={`${label} 數值`}
          data-testid={testId}
          min={min}
          max={max}
          step={step}
          value={draft ?? value.toFixed(digits)}
          onChange={(e) => {
            const text = e.target.value,
              v = Number(text);
            setDraft(text);
            if (text.trim() !== "" && v >= min && v <= max) onChange(v);
          }}
          onBlur={(e) => {
            commit(e.target.value);
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setDraft(null);
          }}
        />
        {unit && <small>{unit}</small>}
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: readonly (readonly [T, string])[];
  value: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div className="sandbox-tabs" role="tablist" aria-label={label}>
      {tabs.map(([id, title]) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
        >
          {title}
        </button>
      ))}
    </div>
  );
}

const TOOL_TABS = [
  ["object", "物體"],
  ["rig", "裝置"],
  ["material", "材質"],
  ["more", "其他"],
] as const;
const RESULT_TABS = [
  ["captures", "三次曝光"],
  ["depth", "相位與深度"],
  ["transport", "光傳輸"],
] as const;

export default function Sandbox({
  onGuide,
  onExplore,
}: {
  onGuide: () => void;
  onExplore: () => void;
}) {
  const [config, setConfig] = useState(loadWorld),
    [scan, setScan] = useState<Scan | null>(null),
    [stale, setStale] = useState(true),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("正在準備第一組三步曝光…"),
    [message, setMessage] = useState(""),
    [probe, setProbe] = useState(0),
    [frame, setFrame] = useState(0),
    [showCloud, setShowCloud] = useState(false),
    [showRays, setShowRays] = useState(true),
    [focusSpace, setFocusSpace] = useState(false),
    [view, setView] = useState<"sandbox" | "analysis">("sandbox"),
    [scanConfig, setScanConfig] = useState<WorldConfig | null>(null),
    [progress, setProgress] = useState(0),
    [toolTab, setToolTab] = useState<(typeof TOOL_TABS)[number][0]>("object"),
    [resultTab, setResultTab] =
      useState<(typeof RESULT_TABS)[number][0]>("captures");
  const world = useRef<WorldViewApi>(null),
    file = useRef<HTMLInputElement>(null),
    latest = useRef(config),
    generation = useRef(0),
    importGeneration = useRef(0),
    worker = useRef<Worker | null>(null),
    probeRef = useRef(probe),
    userPicked = useRef(false),
    firstScan = useRef(true);
  latest.current = config;
  probeRef.current = probe;
  const stopWorker = () => {
    worker.current?.terminate();
    worker.current = null;
  };
  const update = useCallback((patch: Partial<WorldConfig>) => {
    const next = { ...latest.current, ...patch };
    try {
      validateWorldConfig(next);
    } catch (error) {
      setMessage(
        `此設定未套用：${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    latest.current = next;
    generation.current++;
    stopWorker();
    setBusy(false);
    setConfig(next);
    setStale(true);
    setStatus("場景已改，稍後自動重新掃描…");
    setMessage("");
  }, []);
  const finishScan = useCallback((next: Scan, used: WorldConfig) => {
    setScanConfig(used);
    setScan(next);
    setStale(false);
    const { width, height } = next.capture;
    // Keep a user-picked probe while it still lands on a valid pixel.
    if (!userPicked.current || !next.reconstruction.valid[probeRef.current]) {
      let chosen = -1,
        best = Infinity;
      for (let i = 0; i < next.reconstruction.valid.length; i++) {
        if (!next.reconstruction.valid[i]) continue;
        const distance =
          Math.abs((i % width) - width / 2) +
          Math.abs(Math.floor(i / width) - height / 2);
        if (distance < best) {
          best = distance;
          chosen = i;
        }
      }
      setProbe(chosen < 0 ? 0 : chosen);
    }
    setBusy(false);
    setStatus(`掃描完成：${width}×${height} Camera Captures 已解算深度。`);
  }, []);
  const performScan = useCallback(() => {
    const token = ++generation.current,
      snapshot = { ...latest.current };
    stopWorker();
    const fail = (text: string) => {
      stopWorker();
      setBusy(false);
      setStatus("掃描失敗，沒有以真值補出結果。");
      setMessage(text);
    };
    setBusy(true);
    setProgress(0);
    setStatus(
      snapshot.interreflection
        ? "掃描中：追蹤 Camera 射線與互反射路徑…"
        : "掃描中：追蹤 Camera 射線與 Projector 遮擋…",
    );
    const next = new Worker(new URL("./scan.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = next;
    next.onmessage = (event: MessageEvent<ScanResponse>) => {
      if (token !== generation.current) return;
      const reply = event.data;
      if (reply.type === "progress") setProgress(reply.fraction);
      else if (reply.type === "error") fail(reply.message);
      else {
        stopWorker();
        finishScan(reply.scan, snapshot);
      }
    };
    next.onerror = (event) => {
      if (token === generation.current) fail(event.message || "Worker 錯誤");
    };
    next.postMessage({ config: snapshot } satisfies ScanRequest);
  }, [finishScan]);
  useEffect(() => {
    const timer = setTimeout(performScan, firstScan.current ? 120 : 300);
    firstScan.current = false;
    return () => clearTimeout(timer);
  }, [config, performScan]);
  useEffect(
    () => () => {
      generation.current++;
      importGeneration.current++;
      worker.current?.terminate();
    },
    [],
  );
  const depthError = useMemo(
    () =>
      scan
        ? scan.reconstruction.depth.map(
            (d, i) => d - scan.capture.truthDepth[i],
          )
        : null,
    [scan],
  );
  const errorScale = useMemo(() => {
    if (!depthError) return 0.001;
    const magnitudes = Array.from(depthError, Math.abs)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    // 95th percentile keeps a few outliers from washing out the colour map.
    return Math.max(
      0.001,
      magnitudes[Math.floor(0.95 * (magnitudes.length - 1))] ?? 0,
    );
  }, [depthError]);
  const indirectPeak = scan
    ? scan.capture.indirect[frame].reduce((m, v) => Math.max(m, v), 0)
    : 0;
  const indirectGain =
    indirectPeak > 0 ? Math.min(50, Math.max(1, 0.8 / indirectPeak)) : 1;
  const depth = scan?.reconstruction.depth[probe] ?? NaN,
    valid = !!scan?.reconstruction.valid[probe],
    phase = scan?.reconstruction.phase.wrapped[probe] ?? NaN,
    projectorU = scan
      ? (scan.projector.width * (phase + Math.PI)) / TAU - 0.5
      : NaN;
  const field = (
    key: NumericKey,
    label: string,
    extra: Partial<Parameters<typeof Field>[0]> = {},
  ) => (
    <Field
      key={key}
      label={label}
      value={config[key]}
      min={WORLD_LIMITS[key][0]}
      max={WORLD_LIMITS[key][1]}
      onChange={(value) => update({ [key]: value })}
      {...extra}
    />
  );
  const imageProps = scan
    ? {
        width: scan.capture.width,
        height: scan.capture.height,
        probe,
        onPick: (index: number) => {
          userPicked.current = true;
          setProbe(index);
        },
      }
    : null;
  const save = () => {
    try {
      localStorage.setItem(KEY, pack(config));
      const readback = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (JSON.stringify(readback?.config) !== JSON.stringify(config))
        throw new Error("讀回不一致");
      setMessage("已保存沙盒參數；與一維數學實驗的設定分開保存。");
    } catch {
      setMessage("保存失敗，請改用 JSON 匯出。");
    }
  };
  const csv = () => {
    if (!scan) return;
    const lines = [
      "# model=calibrated-one-cycle-sandbox; coordinates=world_xyz_m; depth=camera_optical_Z_m; reference=evaluation_only",
      "# config=" + JSON.stringify(config),
      "camera_x,camera_y,I1,I2,I3,wrapped_rad,projector_column_px,reconstructed_x_m,reconstructed_y_m,reconstructed_z_m,depth_m,valid,reference_depth_m,projector_unlit_mask",
    ];
    const cell = (n: number) => (Number.isFinite(n) ? String(n) : "");
    for (let i = 0; i < scan.capture.width * scan.capture.height; i++) {
      const p = scan.reconstruction.points;
      lines.push(
        [
          i % scan.capture.width,
          Math.floor(i / scan.capture.width),
          ...scan.capture.frames.map((a) => cell(a[i])),
          cell(scan.reconstruction.phase.wrapped[i]),
          cell(
            (scan.projector.width *
              (scan.reconstruction.phase.wrapped[i] + Math.PI)) /
              TAU -
              0.5,
          ),
          cell(p[3 * i]),
          cell(p[3 * i + 1]),
          cell(p[3 * i + 2]),
          cell(scan.reconstruction.depth[i]),
          scan.reconstruction.valid[i],
          cell(scan.capture.truthDepth[i]),
          scan.capture.shadowMask[i],
        ].join(","),
      );
    }
    downloadBlob(
      new Blob(["\uFEFF" + lines.join("\r\n") + "\r\n"], {
        type: "text/csv;charset=utf-8",
      }),
      "sandbox-3d-reconstruction.csv",
    );
    setMessage(
      "已匯出所有像素。reference_depth_m 僅為評估真值，不是重建輸入。",
    );
  };
  return (
    <div className={`sandbox-shell ${focusSpace ? "focus-space" : ""}`}>
      <header className="sandbox-header">
        <div className="sandbox-brand">
          <ScanLine size={22} />
          <div>
            <h1>3D 掃描沙盒</h1>
            <small>結構光實驗室 · 三步 Phase Shifting</small>
          </div>
        </div>
        <div
          className="sandbox-view-switch"
          role="tablist"
          aria-label="沙盒頁面"
        >
          {(
            [
              ["sandbox", "3D 沙盒"],
              ["analysis", "點雲分析"],
            ] as const
          ).map(([id, title]) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
            >
              {title}
            </button>
          ))}
        </div>
        <p
          className={`sandbox-status ${busy ? "busy" : ""}`}
          data-testid="sandbox-status"
          role="status"
        >
          {busy ? <ScanLine size={16} /> : <Check size={16} />}
          <span>
            {status}
            {busy && ` ${Math.round(progress * 100)}%`}
          </span>
        </p>
        <div className="sandbox-header-actions">
          <button
            className="sandbox-scan-button"
            onClick={performScan}
            disabled={busy}
          >
            <RotateCcw size={16} />
            重新掃描
          </button>
          <button onClick={onGuide}>
            <ArrowLeft size={16} />
            一步一步學
          </button>
          <button onClick={onExplore}>
            一維自由實驗
            <ArrowRight size={16} />
          </button>
        </div>
        <span
          className="sandbox-progress"
          hidden={!busy}
          style={{ transform: `scaleX(${progress})` }}
        />
      </header>
      {view === "analysis" && (
        <PointCloudPage
          scan={scan}
          config={scanConfig ?? config}
          stale={stale}
        />
      )}
      <div className="sandbox-workspace" hidden={view !== "sandbox"}>
        <aside className="sandbox-tools" aria-label="場景參數">
          <Tabs
            label="場景參數分頁"
            tabs={TOOL_TABS}
            value={toolTab}
            onChange={setToolTab}
          />
          <div className="sandbox-panel-body">
            {toolTab === "object" && (
              <>
                <h3 className="sandbox-group">形狀</h3>
                <div className="sandbox-palette">
                  {(
                    [
                      ["sphere", "球體"],
                      ["box", "方塊"],
                      ["ramp", "斜板"],
                      ["vgroove", "V 型槽"],
                      ["pcb", "PCB 板"],
                    ] as const
                  ).map(([shape, title]) => (
                    <button
                      key={shape}
                      aria-pressed={config.shape === shape}
                      onClick={() => {
                        if (shape !== "pcb") return update({ shape });
                        update(PCB_SETUP);
                        setMessage(
                          "已套用 PCB 檢測擺位：俯拍 Camera 256×192、斜上方 Projector、像素面積積分；可自行調整。",
                        );
                      }}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                {config.shape === "pcb" && (
                  <p className="sandbox-note">
                    放大模型：板子 1.6×1.2 m、引腳寬約 2.2 cm。U1 QFP、U2
                    SOIC、J1 排針、R1/C1/C2 被動元件共 48
                    支引腳。板子用物體材質，晶片與引腳材質在「材質」分頁；逐引腳結果在「點雲分析」。
                  </p>
                )}
                {config.shape === "vgroove" &&
                  field("grooveAngle", "V 型槽夾角", {
                    step: 1,
                    unit: "°",
                    digits: 0,
                  })}
                <h3 className="sandbox-group">位置</h3>
                {field("x", "物體 X 位置", {
                  unit: "m",
                  testId: "sandbox-object-x",
                })}
                {field("y", "物體高度 Y", { unit: "m" })}
                {field("z", "物體 Z 位置", { unit: "m" })}
                <p className="sandbox-note">
                  也可以在 3D 視窗左鍵點物體，拖曳彩色箭頭移動。
                </p>
              </>
            )}
            {toolTab === "rig" && (
              <>
                {(
                  [
                    ["Camera", "cameraX", "cameraY", "cameraZ"],
                    ["Projector", "projectorX", "projectorY", "projectorZ"],
                  ] as const
                ).map(([device, ...keys]) => (
                  <section key={device}>
                    <h3 className="sandbox-group">{device} 位置</h3>
                    {keys.map((key, axis) =>
                      field(key, `${device} ${"XYZ"[axis]}`, { unit: "m" }),
                    )}
                  </section>
                ))}
                <h3 className="sandbox-group">Camera 鏡頭</h3>
                {field("cameraFov", "Camera FOV", {
                  step: 1,
                  unit: "°",
                  digits: 0,
                })}
                <label className="sandbox-preset">
                  <span>解析度</span>
                  <select
                    aria-label="Camera 解析度"
                    value={config.cameraWidth}
                    onChange={(e) =>
                      update({ cameraWidth: Number(e.target.value) })
                    }
                  >
                    {[96, 160, 256, 384].map((w) => (
                      <option key={w} value={w}>
                        {w}×{(w * 3) / 4}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="sandbox-preset">
                  <span>像素面積積分</span>
                  <select
                    aria-label="像素面積積分"
                    value={config.pixelGrid}
                    onChange={(e) =>
                      update({ pixelGrid: Number(e.target.value) })
                    }
                  >
                    <option value={1}>關閉（像素中心取樣）</option>
                    <option value={2}>2×2 子像素</option>
                    <option value={3}>3×3 子像素</option>
                  </select>
                </label>
                <p className="sandbox-note">
                  開啟面積積分後，跨在邊緣上的像素會混合兩個表面的條紋（混合像素），小細節在低解析度時會重建錯誤或消失。解析度越高掃描越久。
                </p>
                <p className="sandbox-note" data-testid="sandbox-baseline">
                  Baseline（兩光心距離）
                  {Math.hypot(
                    config.cameraX - config.projectorX,
                    config.cameraY - config.projectorY,
                    config.cameraZ - config.projectorZ,
                  ).toFixed(2)}{" "}
                  m。兩台裝置永遠對準物體中心，影像水平方向沿著
                  baseline，條紋因此橫跨 baseline 變化；也可在 3D
                  視窗點機身後拖曳。
                </p>
              </>
            )}
            {toolTab === "material" && (
              <>
                {(
                  [
                    [
                      config.shape === "pcb" ? "PCB 板" : "物體",
                      "objectAlbedo",
                      "objectSpecular",
                      "objectRoughness",
                    ],
                    ...(config.shape === "pcb"
                      ? ([
                          [
                            "晶片",
                            "chipAlbedo",
                            "chipSpecular",
                            "chipRoughness",
                          ],
                          ["引腳", "pinAlbedo", "pinSpecular", "pinRoughness"],
                        ] as const)
                      : []),
                    [
                      "地面",
                      "groundAlbedo",
                      "groundSpecular",
                      "groundRoughness",
                    ],
                  ] as const
                ).map(([title, albedo, specular, roughness]) => (
                  <section key={title}>
                    <h3 className="sandbox-group">{title}</h3>
                    <label className="sandbox-preset">
                      <span>材質預設</span>
                      <select
                        aria-label={`${title}材質預設`}
                        value={
                          MATERIAL_PRESETS.find(
                            (p) =>
                              p.albedo === config[albedo] &&
                              p.specular === config[specular] &&
                              p.roughness === config[roughness],
                          )?.id ?? ""
                        }
                        onChange={(e) => {
                          const p = MATERIAL_PRESETS.find(
                            (preset) => preset.id === e.target.value,
                          );
                          if (p)
                            update({
                              [albedo]: p.albedo,
                              [specular]: p.specular,
                              [roughness]: p.roughness,
                            });
                        }}
                      >
                        <option value="" disabled>
                          自訂
                        </option>
                        {MATERIAL_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {field(albedo, `${title}反射率 ρ`)}
                    {field(specular, `${title}鏡面強度`)}
                    {field(roughness, `${title}粗糙度`)}
                  </section>
                ))}
                <button
                  className="sandbox-reset"
                  onClick={() => {
                    const base =
                      config.shape === "pcb"
                        ? { ...DEFAULT_WORLD, ...PCB_SETUP }
                        : DEFAULT_WORLD;
                    update({
                      objectAlbedo: base.objectAlbedo,
                      objectSpecular: base.objectSpecular,
                      objectRoughness: base.objectRoughness,
                      groundAlbedo: base.groundAlbedo,
                      groundSpecular: base.groundSpecular,
                      groundRoughness: base.groundRoughness,
                      chipAlbedo: base.chipAlbedo,
                      chipSpecular: base.chipSpecular,
                      chipRoughness: base.chipRoughness,
                      pinAlbedo: base.pinAlbedo,
                      pinSpecular: base.pinSpecular,
                      pinRoughness: base.pinRoughness,
                    });
                  }}
                >
                  <RotateCcw size={16} />
                  重設材質參數
                </button>
                <h3 className="sandbox-group">間接光</h3>
                <label className="sandbox-toggle">
                  <input
                    type="checkbox"
                    checked={config.interreflection}
                    onChange={(e) =>
                      update({ interreflection: e.target.checked })
                    }
                  />
                  互反射（間接光）
                </label>
                {config.interreflection && (
                  <>
                    {field("bounces", "反射次數", {
                      step: 1,
                      unit: "次",
                      digits: 0,
                    })}
                    {field("giSamples", "每像素取樣路徑", {
                      step: 8,
                      unit: "條",
                      digits: 0,
                    })}
                  </>
                )}
                <p className="sandbox-note">
                  亮度 = 0.12 環境 + 直接光 + 間接光。鏡面為
                  GGX，低粗糙度會產生飽和高光而被 clipping；互反射以 Monte Carlo
                  路徑追蹤，取樣越多雜訊越少。金屬沒有漫射，只有鏡射方向附近的像素看得到條紋，其餘無法解碼——這正是實機掃描金屬的困難。
                </p>
              </>
            )}
            {toolTab === "more" && (
              <>
                <h3 className="sandbox-group">雜訊與可重現</h3>
                {field("noiseSigma", "Gaussian Noise σ", {
                  step: 0.001,
                  digits: 3,
                })}
                <label className="sandbox-inline-field">
                  Seed
                  <input
                    aria-label="沙盒 Seed"
                    type="number"
                    min={0}
                    max={4294967295}
                    value={config.seed}
                    onChange={(e) => {
                      const seed = Number(e.target.value);
                      if (
                        Number.isInteger(seed) &&
                        seed >= 0 &&
                        seed <= 4294967295
                      )
                        update({ seed });
                    }}
                  />
                </label>
                <p className="sandbox-note">
                  僅加性 Gaussian；不含完整 sensor noise。
                </p>
                <button
                  className="sandbox-reset"
                  onClick={() => update({ ...DEFAULT_WORLD })}
                >
                  <RotateCcw size={16} />
                  重設場景參數
                </button>
                <details className="sandbox-model-notes">
                  <summary>這個沙盒做了什麼？有哪些簡化？</summary>
                  <p>
                    <strong>已實作：</strong>已知 Pinhole Camera–Projector
                    內外參、Camera ray–mesh 交點（BVH 加速）、Projector
                    視野與遮擋、Lambert + GGX 材質、Monte Carlo 互反射（1–3
                    次）、三步 Phase Shifting、單週期 column 解碼、ray–plane
                    Triangulation、重建點雲與深度誤差。
                  </p>
                  <p>
                    <strong>重要假設：</strong>Projector
                    視野只投單一完整週期，因此 φ 能唯一對應
                    column。這不是任意高頻條紋都能直接做的絕對解包裹，也不是
                    Micro PS。
                  </p>
                  <p>
                    <strong>仍未支援：</strong>由棋盤格估計
                    Calibration、鏡頭失真、Defocus、次表面散射、Gamma、量化。Projector
                    為點光源且未建模距離衰減，材質為無色、Fresnel 為常數。
                  </p>
                  <p>
                    主視窗由 WebGL 畫投影與陰影；量測使用相同幾何的 CPU
                    光線追蹤與 Float64 intensity，並非螢幕截圖。深度定義為
                    Camera optical-axis Z。
                  </p>
                </details>
              </>
            )}
          </div>
        </aside>
        <section className="sandbox-viewport" aria-label="3D 觀察視角">
          <WorldView
            ref={world}
            config={config}
            scan={stale ? null : scan}
            probe={probe}
            frame={frame}
            showCloud={showCloud}
            showRays={showRays}
            onMove={(x, y, z) => update({ x, y, z })}
            onDevice={(device, x, y, z) =>
              update(
                device === "camera"
                  ? { cameraX: x, cameraY: y, cameraZ: z }
                  : { projectorX: x, projectorY: y, projectorZ: z },
              )
            }
          />
          <div className="sandbox-overlay sandbox-overlay-top">
            <span className="sandbox-chip">觀察視角 · 每格 0.5 m</span>
            <div className="sandbox-view-buttons">
              <label>
                <input
                  type="checkbox"
                  aria-label="顯示選中像素的射線與光平面"
                  checked={showRays}
                  onChange={(e) => setShowRays(e.target.checked)}
                />
                射線
              </label>
              <label>
                <input
                  type="checkbox"
                  aria-label="顯示重建點雲"
                  checked={showCloud}
                  onChange={(e) => setShowCloud(e.target.checked)}
                />
                點雲
              </label>
              <button onClick={() => world.current?.resetView()}>
                <RotateCcw size={15} />
                重設視角
              </button>
              <button onClick={() => setFocusSpace((v) => !v)}>
                {focusSpace ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                {focusSpace ? "返回完整工作區" : "專注 3D 空間"}
              </button>
            </div>
          </div>
          <div className="sandbox-overlay sandbox-overlay-bottom sandbox-play-help">
            <span>左鍵：選取並拖曳物體／Camera／Projector</span>
            <span>中鍵：旋轉</span>
            <span>滾輪：縮放</span>
            <span>WASD／Q E：移動、轉向</span>
          </div>
          {message && (
            <div className="sandbox-message" role="status">
              <span>{message}</span>
              <button aria-label="關閉訊息" onClick={() => setMessage("")}>
                <X size={16} />
              </button>
            </div>
          )}
        </section>
        <aside className="sandbox-results" aria-label="量測結果">
          <section className={`sandbox-result-strip ${stale ? "stale" : ""}`}>
            <div>
              <span>有效像素</span>
              <strong>
                <b data-testid="sandbox-valid-count">
                  {scan?.metrics.validCount ?? 0}
                </b>
                <small> / {scan?.metrics.totalCount ?? 6912}</small>
              </strong>
              <p>
                {scan
                  ? `${(scan.metrics.validRatio * 100).toFixed(1)}% · 未照明 ${scan.metrics.occludedCount} px`
                  : "尚未掃描"}
              </p>
            </div>
            <div>
              <span>Depth RMSE</span>
              <strong>
                {scan?.metrics.rmseDepth == null
                  ? "N/A"
                  : mm(scan.metrics.rmseDepth)}
                <small>{scan?.metrics.rmseDepth == null ? "" : " mm"}</small>
              </strong>
              {scan?.metrics.directRmseDepth != null ? (
                <p data-testid="sandbox-direct-rmse">
                  無互反射：{mm(scan.metrics.directRmseDepth)} mm
                </p>
              ) : (
                <p>Camera Z；真值僅供評估</p>
              )}
            </div>
            <div>
              <span>
                <Crosshair size={13} />
                選中像素
              </span>
              <strong data-testid="sandbox-probe-depth">
                {valid ? `${depth.toFixed(3)} m` : "N/A"}
              </strong>
              <p>
                {scan
                  ? `pixel (${probe % scan.capture.width}, ${Math.floor(probe / scan.capture.width)})`
                  : "點影像選像素"}
              </p>
            </div>
          </section>
          <Tabs
            label="結果分頁"
            tabs={RESULT_TABS}
            value={resultTab}
            onChange={setResultTab}
          />
          <div className={`sandbox-panel-body ${stale ? "stale" : ""}`}>
            {!scan || !imageProps ? (
              <div className="sandbox-no-result">
                正在產生第一組 Camera Captures…
              </div>
            ) : resultTab === "captures" ? (
              <>
                <div
                  className="sandbox-frame-picker"
                  role="group"
                  aria-label="3D 場景顯示的曝光"
                >
                  {[0, 1, 2].map((k) => (
                    <button
                      key={k}
                      aria-pressed={frame === k}
                      onClick={() => setFrame(k)}
                    >
                      I{k + 1} · {k * 120}°
                    </button>
                  ))}
                </div>
                <div className="sandbox-image-grid">
                  {scan.capture.frames.map((values, k) => (
                    <figure key={k} className={frame === k ? "selected" : ""}>
                      <Image
                        {...imageProps}
                        values={values}
                        testId={`sandbox-capture-${k}`}
                      />
                      <figcaption>
                        I{k + 1} · 相移 {k * 120}°
                        {frame === k ? " · 場景顯示中" : ""}
                      </figcaption>
                    </figure>
                  ))}
                  <figure>
                    <Image
                      {...imageProps}
                      values={scan.reconstruction.phase.wrapped}
                      kind="phase"
                      testId="sandbox-phase"
                    />
                    <figcaption>Wrapped Phase φ̂</figcaption>
                  </figure>
                </div>
                <p className="sandbox-note">
                  三張只差投影相移；φ̂ 由 I₁–I₃
                  解出，不讀取表面座標。點影像可選像素。
                </p>
              </>
            ) : resultTab === "depth" ? (
              <>
                <div className="sandbox-image-grid">
                  <figure>
                    <Image
                      {...imageProps}
                      values={scan.reconstruction.depth}
                      kind="depth"
                      testId="sandbox-depth"
                    />
                    <figcaption>重建 Depth（色階 1–10 m）</figcaption>
                  </figure>
                  <figure>
                    <Image
                      {...imageProps}
                      values={depthError!}
                      kind="error"
                      scale={errorScale}
                      testId="sandbox-depth-error"
                      label="深度誤差圖"
                    />
                    <figcaption>
                      誤差（紅遠藍近，±{mm(errorScale)} mm）
                    </figcaption>
                  </figure>
                </div>
                <ol className="sandbox-explanation">
                  <li>
                    三次亮度解出 φ̂ = <b>{f(phase)} rad</b>
                  </li>
                  <li>
                    單一週期對應 Projector column <b>{f(projectorU, 2)} px</b>
                  </li>
                  <li>
                    Camera 射線 ∩ 該 column 光平面 →{" "}
                    <b>{valid ? `${depth.toFixed(3)} m` : "無有效交點"}</b>
                  </li>
                  <li>
                    與真值差{" "}
                    <b>
                      {valid ? `${mm(Math.abs(depthError![probe]))} mm` : "N/A"}
                    </b>
                  </li>
                </ol>
                <p className="sandbox-note">
                  3D 視窗中藍線＝Camera 射線；黃平面＝Projector
                  光平面；紅點＝三角量測結果。
                </p>
              </>
            ) : (
              <>
                <div className="sandbox-image-grid">
                  <figure>
                    <Image
                      {...imageProps}
                      values={scan.capture.direct[frame]}
                      testId="sandbox-direct"
                      label="直接光分量"
                    />
                    <figcaption>直接光 · I{frame + 1}</figcaption>
                  </figure>
                  <figure>
                    <Image
                      {...imageProps}
                      values={scan.capture.indirect[frame]}
                      gain={indirectGain}
                      testId="sandbox-indirect"
                      label="間接光分量"
                    />
                    <figcaption>
                      間接光 · ×{indirectGain.toFixed(1)} 顯示
                    </figcaption>
                  </figure>
                </div>
                <p className="sandbox-note">
                  {scan.capture.directOnly
                    ? `此像素間接光 ${f(scan.capture.indirect[frame][probe])}。`
                    : "互反射關閉：間接光為 0（在「材質」分頁開啟）。"}
                  這是正向模型內部的評估資料，重建時不會讀取。
                </p>
              </>
            )}
          </div>
          <div className="sandbox-export">
            <button onClick={save}>
              <Save size={14} />
              保存參數
            </button>
            <button
              onClick={() =>
                downloadBlob(
                  new Blob([pack(config)], { type: "application/json" }),
                  "sandbox-parameters.json",
                )
              }
            >
              <ArrowDownToLine size={14} />
              匯出 JSON
            </button>
            <button onClick={() => file.current?.click()}>
              <Upload size={14} />
              匯入 JSON
            </button>
            <button onClick={csv} disabled={!scan || stale}>
              <ArrowDownToLine size={14} />
              匯出 3D CSV
            </button>
            <button
              onClick={() =>
                void world.current
                  ?.snapshot()
                  .then((blob) => downloadBlob(blob, "sandbox-scene.png"))
                  .catch((error) => setMessage(String(error)))
              }
            >
              <ArrowDownToLine size={14} />
              PNG 場景
            </button>
            <button onClick={() => setView("analysis")}>
              <ScanLine size={14} />
              點雲分析
            </button>
          </div>
        </aside>
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
          const token = ++importGeneration.current;
          try {
            if (chosen.size > 1_048_576) throw new Error("參數檔超過 1 MB");
            const envelope = JSON.parse(await chosen.text());
            if (token !== importGeneration.current) return;
            if (envelope.schemaVersion !== SCHEMA || envelope.model !== MODEL)
              throw new Error("不是此沙盒的參數格式");
            update(parseWorldConfig(envelope.config));
            setMessage("已匯入沙盒設定並自動重新掃描；保存記錄尚未覆寫。");
          } catch (error) {
            if (token !== importGeneration.current) return;
            setMessage(
              `匯入失敗，原設定未變更：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }}
      />
    </div>
  );
}
