import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  Maximize2,
  Minimize2,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  ScanLine,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  BOARD_SHAPES,
  DEFAULT_WORLD,
  DEVICE_LIMITS,
  fringePatterns,
  MAX_DEVICES,
  migrateLegacyConfig,
  PCB_REGIONS,
  PCB_SETUP,
  parseWorldConfig,
  rigTarget,
  validateWorldConfig,
  WORLD_LIMITS,
  type NumericKey,
  type WorldConfig,
  type WorldScan,
  type WorldShape,
} from "./scanner";
import {
  fromSpherical,
  placePreset,
  RIG_PRESETS,
  spherical,
  type Device,
} from "./devices";
import { MATERIAL_PRESETS } from "./lightTransport";
import { applyLocalPreset, LOCAL_PRESETS } from "./localPresets";
import { InfoButton, InfoHeading } from "./Info";
import { Field, Tabs } from "./controls";
import PointCloudPage from "./PointCloudPage";
import type { ScanRequest, ScanResponse } from "./scan.worker";
import WorldView, { type OverlayCloud, type WorldViewApi } from "./WorldView";
import MultiViewPage from "../aoi/MultiViewPage";
import { downloadBlob, rasterize } from "../lib/images";
import { TAU } from "../core/simulation";
import "./sandbox.css";

type Scan = WorldScan;
const KEY = "structured-light.sandbox.parameters.v5";
const LEGACY_KEYS = [
  "structured-light.sandbox.parameters.v4",
  "structured-light.sandbox.parameters.v3",
];
const MODEL = "calibrated-fringe-sandbox";
const SCHEMA = 5;
const HISTORY_LIMIT = 100;
/** Accepts v5 envelopes and upgrades v4 / v3 ones (25 mm units, single camera and projector). */
function readEnvelope(e: unknown): WorldConfig {
  const envelope = e as {
    schemaVersion?: unknown;
    model?: unknown;
    config?: unknown;
  } | null;
  if (envelope?.schemaVersion === SCHEMA && envelope.model === MODEL)
    return parseWorldConfig(envelope.config);
  if (
    (envelope?.schemaVersion === 4 && envelope.model === MODEL) ||
    (envelope?.schemaVersion === 3 &&
      envelope.model === "calibrated-one-cycle-sandbox")
  )
    return migrateLegacyConfig(envelope.config);
  throw new Error("不是此沙盒的參數格式");
}
function loadWorld(): WorldConfig {
  for (const key of [KEY, ...LEGACY_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return readEnvelope(JSON.parse(raw));
    } catch {
      // Fall through to the next key or the defaults.
    }
  }
  return structuredClone(DEFAULT_WORLD);
}
/** Fields that change the active-pair scan; analysis-only settings and idle devices do not. */
function scanKey(c: WorldConfig) {
  const {
    references: _r,
    targetRange: _t,
    consistencyTolerance: _c,
    tolerance: _o,
    roiWidth: _w,
    roiHeight: _h,
    cellSize: _s,
    directTiltLimit: _d,
    cameras,
    projectors,
    ...rest
  } = c;
  return JSON.stringify([
    rest,
    cameras.find((d) => d.id === c.activeCamera),
    projectors.find((d) => d.id === c.activeProjector),
  ]);
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
const mm = (value: number) => (value < 0.001 ? "＜ 0.001" : value.toFixed(3));

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
  /** Symmetric colour range for error images, in mm. */
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
          const t = Math.max(0, Math.min(1, (d - 25) / 225));
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

const TOOL_TABS = [
  ["object", "物體"],
  ["rig", "裝置"],
  ["projector", "投影"],
  ["material", "材質"],
  ["more", "其他"],
] as const;
const RESULT_TABS = [
  ["captures", "曝光影像"],
  ["depth", "相位與深度"],
  ["transport", "光傳輸"],
] as const;
export type SandboxView = "sandbox" | "analysis" | "multiview";
const VIEWS = [
  ["sandbox", "3D 沙盒"],
  ["analysis", "點雲分析"],
  ["multiview", "多視角分析"],
] as const;
const SHAPES: readonly (readonly [WorldShape, string])[] = [
  ["sphere", "球體"],
  ["box", "方塊"],
  ["ramp", "斜板"],
  ["vgroove", "V 型槽"],
  ["pcb", "PCB 板"],
  ["step", "階梯量規"],
  ["chip", "Chip + Fillet"],
  ["plane", "平面"],
];
const MATTE_BOARD: Partial<WorldConfig> = {
  objectAlbedo: 0.5,
  objectSpecular: 0,
  objectRoughness: 0.6,
  chipAlbedo: 0.7,
  chipSpecular: 0,
  chipRoughness: 0.5,
};
const ASSEMBLY_BOARD: Partial<WorldConfig> = {
  objectAlbedo: 0.25,
  objectSpecular: 0.06,
  objectRoughness: 0.45,
  chipAlbedo: 0.45,
  chipSpecular: 0.06,
  chipRoughness: 0.35,
  pinAlbedo: 0.15,
  pinSpecular: 0.6,
  pinRoughness: 0.4,
  solderAlbedo: 0.1,
  solderSpecular: 0.7,
  solderRoughness: 0.3,
};
/** AOI test pieces: board top 2 mm above the ground is the reference plane. */
const boardSetup = (shape: WorldShape): Partial<WorldConfig> => ({
  shape,
  x: 0,
  y: 2,
  z: 0,
  aimX: 0,
  aimZ: 0,
  referenceHeight: 2,
  ...(shape === "chip" ? ASSEMBLY_BOARD : MATTE_BOARD),
});
const DEVICE_FIELDS = [
  ["tilt", "傾角°", [0, 150]],
  ["azimuth", "方位°", [-360, 360]],
  ["distance", "距離 mm", [12.5, 600]],
] as const;

function NumberCell({
  value,
  limits,
  label,
  onChange,
  digits = 1,
}: {
  value: number;
  limits: readonly [number, number];
  label: string;
  onChange: (v: number) => void;
  digits?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    const v = Number(text);
    if (text.trim() !== "" && Number.isFinite(v))
      onChange(Math.min(limits[1], Math.max(limits[0], v)));
    setDraft(null);
  };
  return (
    <input
      type="number"
      aria-label={label}
      className="aoi-number"
      min={limits[0]}
      max={limits[1]}
      value={draft ?? String(Number(value.toFixed(digits)))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

export default function Sandbox({
  onGuide,
  onExplore,
  initialView = "sandbox",
}: {
  onGuide: () => void;
  onExplore: () => void;
  initialView?: SandboxView;
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
    [showHelp, setShowHelp] = useState(false),
    [resultInfo, setResultInfo] = useState(false),
    [view, setView] = useState<SandboxView>(initialView),
    [overlay, setOverlay] = useState<(OverlayCloud & { label: string }) | null>(
      null,
    ),
    [scanConfig, setScanConfig] = useState<WorldConfig | null>(null),
    [progress, setProgress] = useState(0),
    [toolTab, setToolTab] = useState<(typeof TOOL_TABS)[number][0]>("object"),
    [resultTab, setResultTab] =
      useState<(typeof RESULT_TABS)[number][0]>("captures"),
    [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });
  const world = useRef<WorldViewApi>(null),
    file = useRef<HTMLInputElement>(null),
    latest = useRef(config),
    generation = useRef(0),
    importGeneration = useRef(0),
    worker = useRef<Worker | null>(null),
    probeRef = useRef(probe),
    userPicked = useRef(false),
    firstScan = useRef(true),
    history = useRef({
      past: [] as WorldConfig[],
      future: [] as WorldConfig[],
      lastKeys: "",
      lastTime: 0,
    });
  latest.current = config;
  probeRef.current = probe;
  const stopWorker = () => {
    worker.current?.terminate();
    worker.current = null;
  };
  const apply = useCallback((next: WorldConfig) => {
    const rescan = scanKey(next) !== scanKey(latest.current);
    latest.current = next;
    setConfig(next);
    setMessage("");
    const h = history.current;
    setHistorySize({ undo: h.past.length, redo: h.future.length });
    if (!rescan) return;
    generation.current++;
    stopWorker();
    setBusy(false);
    setStale(true);
    setStatus("場景已改，稍後自動重新掃描…");
  }, []);
  const update = useCallback(
    (patch: Partial<WorldConfig>) => {
      const previous = latest.current,
        next = { ...previous, ...patch };
      try {
        validateWorldConfig(next);
      } catch (error) {
        setMessage(
          `此設定未套用：${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      const h = history.current,
        keys = Object.keys(patch).sort().join(),
        now = performance.now();
      // A slider or gizmo drag sends a burst of same-key patches: keep it as one undo step.
      if (keys !== h.lastKeys || now - h.lastTime > 600) {
        h.past.push(previous);
        if (h.past.length > HISTORY_LIMIT) h.past.shift();
      }
      h.future = [];
      h.lastKeys = keys;
      h.lastTime = now;
      apply(next);
    },
    [apply],
  );
  const travel = useCallback(
    (direction: "undo" | "redo") => {
      const h = history.current,
        [from, to] =
          direction === "undo" ? [h.past, h.future] : [h.future, h.past];
      const target = from.pop();
      if (!target) return;
      to.push(latest.current);
      h.lastKeys = "";
      apply(target);
    },
    [apply],
  );
  useEffect(() => {
    if (view === "analysis") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      // Leave native text undo to fields being typed in.
      if (
        target?.closest("textarea, [contenteditable='true']") ||
        (target instanceof HTMLInputElement &&
          !["range", "checkbox", "radio", "button"].includes(target.type))
      )
        return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        travel("undo");
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        travel("redo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, travel]);
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
  const currentScanKey = useMemo(() => scanKey(config), [config]);
  useEffect(() => {
    const timer = setTimeout(performScan, firstScan.current ? 120 : 300);
    firstScan.current = false;
    return () => clearTimeout(timer);
  }, [currentScanKey, performScan]);
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
  const scanFrame = scan ? Math.min(frame, scan.capture.frames.length - 1) : 0;
  const indirectPeak = scan
    ? scan.capture.indirect[scanFrame].reduce((m, v) => Math.max(m, v), 0)
    : 0;
  const indirectGain =
    indirectPeak > 0 ? Math.min(50, Math.max(1, 0.8 / indirectPeak)) : 1;
  const coding = scan && scanConfig ? scanConfig : config,
    steps = coding.phaseSteps,
    patterns = fringePatterns(coding),
    frameLabel = (k: number) =>
      `${k >= steps ? (coding.coding === "dual" ? "粗週期 " : "低頻 ") : ""}I${(k % steps) + 1} · ${Math.round((patterns[k].shift * 180) / Math.PI)}°`;
  const depth = scan?.reconstruction.depth[probe] ?? NaN,
    valid = !!scan?.reconstruction.valid[probe],
    phase = scan?.reconstruction.phase.wrapped[probe] ?? NaN,
    lowPhase = scan?.reconstruction.lowPhase?.wrapped[probe] ?? NaN,
    order = scan
      ? Math.round((scan.reconstruction.absolute[probe] - phase) / TAU)
      : NaN,
    projectorU = scan?.reconstruction.column[probe] ?? NaN;
  const scaledAbsolute = useMemo(
    () =>
      scan && coding.fringeFrequency > 1
        ? scan.reconstruction.absolute.map(
            (a) => (a + Math.PI) / coding.fringeFrequency - Math.PI,
          )
        : null,
    [scan, coding.fringeFrequency],
  );
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
  const aim = rigTarget(config);
  const activeCamera = config.cameras.find(
      (d) => d.id === config.activeCamera,
    )!,
    activeProjector = config.projectors.find(
      (d) => d.id === config.activeProjector,
    )!;
  const listOf = (kind: "camera" | "projector") =>
    kind === "camera" ? "cameras" : "projectors";
  const setDevice = (
    kind: "camera" | "projector",
    id: string,
    patch: Partial<Device>,
  ) =>
    update({
      [listOf(kind)]: config[listOf(kind)].map((d) =>
        d.id === id ? { ...d, ...patch } : d,
      ),
    });
  const addDevice = (kind: "camera" | "projector") => {
    const list = config[listOf(kind)],
      prefix = kind === "camera" ? "C" : "P",
      used = new Set(list.map((d) => d.id));
    let n = list.length;
    while (used.has(`${prefix}${n}`)) n++;
    const source = kind === "camera" ? activeCamera : activeProjector,
      s = spherical(source, aim);
    update({
      [listOf(kind)]: [
        ...list,
        {
          ...source,
          ...fromSpherical(aim, s.tilt, (s.azimuth + 90) % 360, s.distance),
          id: `${prefix}${n}`,
          name: `${source.name} 副本`,
        },
      ],
    });
  };
  const removeDevice = (kind: "camera" | "projector", id: string) => {
    const list = config[listOf(kind)].filter((d) => d.id !== id);
    const activeKey = kind === "camera" ? "activeCamera" : "activeProjector";
    update({
      [listOf(kind)]: list,
      [activeKey]: config[activeKey] === id ? list[0].id : config[activeKey],
    });
  };
  const deviceAxis = (
    kind: "camera" | "projector",
    axis: "x" | "y" | "z",
    label: string,
  ) => {
    const device = kind === "camera" ? activeCamera : activeProjector;
    return (
      <Field
        key={`${kind}-${axis}`}
        label={label}
        value={device[axis]}
        min={DEVICE_LIMITS[axis][0]}
        max={DEVICE_LIMITS[axis][1]}
        step={0.5}
        unit="mm"
        onChange={(value) => setDevice(kind, device.id, { [axis]: value })}
      />
    );
  };
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
      `# model=${MODEL}; coordinates=world_xyz_mm; depth=camera_optical_Z_mm; reference=evaluation_only`,
      "# config=" + JSON.stringify(scanConfig ?? config),
      [
        "camera_x,camera_y",
        ...scan.capture.frames.map((_, k) => `frame_${k + 1}`),
        "wrapped_rad,absolute_rad,projector_column_px,reconstructed_x_mm,reconstructed_y_mm,reconstructed_z_mm,depth_mm,valid,reference_depth_mm,projector_unlit_mask",
      ].join(","),
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
          cell(scan.reconstruction.absolute[i]),
          cell(scan.reconstruction.column[i]),
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
      "已匯出所有像素（mm）。reference_depth_mm 僅為評估真值，不是重建輸入。",
    );
  };
  return (
    <div className={`sandbox-shell ${focusSpace ? "focus-space" : ""}`}>
      <header className="sandbox-header">
        <div className="sandbox-brand">
          <ScanLine size={22} />
          <div>
            <h1>3D 掃描沙盒</h1>
            <small>結構光實驗室 · N 步 Phase Shifting · 單位 mm</small>
          </div>
        </div>
        <div
          className="sandbox-view-switch"
          role="tablist"
          aria-label="沙盒頁面"
        >
          {VIEWS.map(([id, title]) => (
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
            aria-label="復原"
            title="復原（Ctrl+Z）"
            onClick={() => travel("undo")}
            disabled={!historySize.undo}
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label="重做"
            title="重做（Ctrl+Y 或 Ctrl+Shift+Z）"
            onClick={() => travel("redo")}
            disabled={!historySize.redo}
          >
            <Redo2 size={16} />
          </button>
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
      {view === "multiview" && (
        <MultiViewPage
          config={config}
          update={update}
          onShow={(next, pair) => {
            if (pair)
              update({
                activeCamera: pair.cameraId,
                activeProjector: pair.projectorId,
              });
            setOverlay(next);
            if (next) setShowCloud(false);
            setView("sandbox");
          }}
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
                <InfoHeading title="形狀">
                  {config.shape === "pcb" ? (
                    <p>
                      真實尺寸 PCB：板子 40×30 mm、引腳寬約 0.55 mm。U1 QFP、U2
                      SOIC、J1 排針、R1/C1/C2 被動元件共 48
                      支引腳。板子用物體材質，晶片與引腳材質在「材質」分頁；逐引腳結果在「點雲分析」。
                    </p>
                  ) : BOARD_SHAPES.includes(config.shape) ? (
                    <p>
                      AOI 測試件（mm）：板面即基準面。階梯量規 0.1–2.4 mm
                      六階，適合看量測範圍與混疊；Chip + Fillet 含兩顆 2012
                      元件、金屬電極、凹形焊錫與 3 mm 高元件（遮擋 /
                      陰影）；平面可在批次比較中掃描高度。
                    </p>
                  ) : undefined}
                </InfoHeading>
                <div className="sandbox-palette">
                  {SHAPES.map(([shape, title]) => (
                    <button
                      key={shape}
                      aria-pressed={config.shape === shape}
                      onClick={() => {
                        if (shape === "pcb") {
                          update(PCB_SETUP);
                          setMessage(
                            "已套用 PCB 檢測擺位：俯拍 Camera 256×192、斜上方 Projector、像素面積積分；可自行調整。",
                          );
                        } else if (BOARD_SHAPES.includes(shape)) {
                          update(boardSetup(shape));
                          setMessage(
                            "已放置 AOI 測試件（板面＝基準面）。要比較多組 Camera／Projector，可在「裝置」分頁套用 AOI 擺位後到「多視角分析」。",
                          );
                        } else update({ shape, referenceHeight: 0 });
                      }}
                    >
                      {title}
                    </button>
                  ))}
                </div>
                {config.shape === "vgroove" &&
                  field("grooveAngle", "V 型槽夾角", {
                    step: 1,
                    unit: "°",
                    digits: 0,
                  })}
                {config.shape === "pcb" && (
                  <label className="sandbox-preset">
                    <span>瞄準區域</span>
                    <select
                      aria-label="PCB 瞄準區域"
                      value={
                        PCB_REGIONS.find(
                          ([, , ax, az]) =>
                            ax === config.aimX && az === config.aimZ,
                        )?.[0] ?? ""
                      }
                      onChange={(e) => {
                        const region = PCB_REGIONS.find(
                          ([id]) => id === e.target.value,
                        );
                        if (region)
                          update({ aimX: region[2], aimZ: region[3] });
                      }}
                    >
                      <option value="" disabled>
                        自訂
                      </option>
                      {PCB_REGIONS.map(([id, title]) => (
                        <option key={id} value={id}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <InfoHeading title="位置">
                  <p>也可以在 3D 視窗左鍵點物體，拖曳彩色箭頭移動。</p>
                </InfoHeading>
                {field("x", "物體 X 位置", {
                  step: 0.5,
                  unit: "mm",
                  testId: "sandbox-object-x",
                })}
                {field("y", "物體高度 Y", { step: 0.25, unit: "mm" })}
                {field("z", "物體 Z 位置", { step: 0.5, unit: "mm" })}
                <InfoHeading title="瞄準點與基準面">
                  <p>
                    所有裝置對準「物體位置 + 瞄準偏移」；多視角分析的 ROI
                    也以它為中心。基準面是 AOI 校正的高度零點（世界 Y），單週期
                    / 雙週期的相位視窗從它往上算，多視角高度也都相對於它。
                  </p>
                </InfoHeading>
                {field("aimX", "瞄準偏移 X", { step: 0.25, unit: "mm" })}
                {field("aimZ", "瞄準偏移 Z", { step: 0.25, unit: "mm" })}
                {field("referenceHeight", "基準面高度", {
                  step: 0.25,
                  unit: "mm",
                })}
              </>
            )}
            {toolTab === "rig" && (
              <>
                <label className="sandbox-preset">
                  <span>裝置擺位</span>
                  <select
                    aria-label="裝置擺位預設"
                    value=""
                    onChange={(e) => {
                      if (e.target.value === "single") {
                        update({
                          cameras: structuredClone(DEFAULT_WORLD.cameras),
                          projectors: structuredClone(DEFAULT_WORLD.projectors),
                          activeCamera: "C0",
                          activeProjector: "P0",
                        });
                        return;
                      }
                      const local = LOCAL_PRESETS.find(
                        (p) => `local:${p.id}` === e.target.value,
                      );
                      if (local) {
                        const next = applyLocalPreset(local, config);
                        update(next);
                        try {
                          validateWorldConfig(next);
                        } catch {
                          return; // update() already reported why
                        }
                        setMessage(
                          `已套用本機預設「${local.name}」（src/local，不會進 Git）；到「多視角分析」比較所有 Pair。`,
                        );
                        return;
                      }
                      const preset = RIG_PRESETS.find(
                        (p) => p.id === e.target.value,
                      );
                      if (!preset) return;
                      const placed = placePreset(preset, aim);
                      update({
                        ...placed,
                        activeCamera: placed.cameras[0].id,
                        activeProjector: placed.projectors[0].id,
                        cameraWidth: Math.max(config.cameraWidth, 192),
                      });
                      setMessage(
                        `已套用「${preset.name}」：${placed.cameras.length} 台 Camera × ${placed.projectors.length} 台 Projector；到「多視角分析」比較所有 Pair。`,
                      );
                    }}
                  >
                    <option value="">選擇…</option>
                    <option value="single">
                      沙盒單組（1 Camera + 1 Projector）
                    </option>
                    {RIG_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    {LOCAL_PRESETS.map((p) => (
                      <option
                        key={p.id}
                        value={`local:${p.id}`}
                        title={p.description}
                      >
                        本機：{p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {(
                  [
                    ["Camera", "camera"],
                    ["Projector", "projector"],
                  ] as const
                ).map(([title, kind]) => (
                  <section key={kind}>
                    <InfoHeading title={`使用中 ${title} 位置`}>
                      <p>
                        3D 沙盒掃描的是「使用中」的一組 Camera +
                        Projector。也可以在 3D
                        視窗左鍵點機身拖曳；點其他（半透明）機身會把它設為使用中。所有裝置永遠對準瞄準點。
                      </p>
                    </InfoHeading>
                    {(["x", "y", "z"] as const).map((axis) =>
                      deviceAxis(kind, axis, `${title} ${axis.toUpperCase()}`),
                    )}
                    <Field
                      label={`${title} FOV`}
                      value={
                        (kind === "camera" ? activeCamera : activeProjector).fov
                      }
                      min={DEVICE_LIMITS.fov[0]}
                      max={DEVICE_LIMITS.fov[1]}
                      step={0.5}
                      unit="°"
                      digits={1}
                      onChange={(fov) =>
                        setDevice(
                          kind,
                          (kind === "camera" ? activeCamera : activeProjector)
                            .id,
                          { fov },
                        )
                      }
                    />
                  </section>
                ))}
                <InfoHeading title="全部裝置（多視角）">
                  <p>
                    傾角 / 方位 / 距離是相對瞄準點的球座標（方位從 +X 轉向
                    +Z）。光圈直徑供薄透鏡失焦模型使用，0 為針孔（無失焦）。Pair
                    類別（直視 / 反対側 / 直交 / 同じ側）由這些幾何即時判定。
                  </p>
                </InfoHeading>
                {(["camera", "projector"] as const).map((kind) => {
                  const list = config[listOf(kind)],
                    active =
                      kind === "camera"
                        ? config.activeCamera
                        : config.activeProjector;
                  return (
                    <section key={kind}>
                      <h3 className="sandbox-group">
                        {kind === "camera" ? "Camera" : "Projector"}（
                        {list.length}）
                      </h3>
                      {list.map((device) => {
                        const s = spherical(device, aim);
                        return (
                          <div
                            className={`aoi-device ${device.id === active ? "active" : ""}`}
                            key={device.id}
                            data-testid={`sandbox-device-${device.id}`}
                          >
                            <div className="aoi-device-head">
                              <input
                                type="radio"
                                aria-label={`使用 ${device.id}`}
                                checked={device.id === active}
                                onChange={() =>
                                  update(
                                    kind === "camera"
                                      ? { activeCamera: device.id }
                                      : { activeProjector: device.id },
                                  )
                                }
                              />
                              <strong>{device.id}</strong>
                              <input
                                aria-label={`${device.id} 名稱`}
                                value={device.name}
                                onChange={(e) =>
                                  setDevice(kind, device.id, {
                                    name: e.target.value,
                                  })
                                }
                              />
                              <button
                                aria-label={`移除 ${device.id}`}
                                title="移除"
                                disabled={list.length <= 1}
                                onClick={() => removeDevice(kind, device.id)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            <div className="aoi-device-grid">
                              {DEVICE_FIELDS.map(([key, title, limits]) => (
                                <label key={key}>
                                  <span>{title}</span>
                                  <NumberCell
                                    label={`${device.id} ${title}`}
                                    value={s[key]}
                                    limits={limits}
                                    onChange={(value) => {
                                      const next = { ...s, [key]: value };
                                      setDevice(
                                        kind,
                                        device.id,
                                        fromSpherical(
                                          aim,
                                          next.tilt,
                                          next.azimuth,
                                          next.distance,
                                        ),
                                      );
                                    }}
                                  />
                                </label>
                              ))}
                              <label>
                                <span>FOV°</span>
                                <NumberCell
                                  label={`${device.id} FOV°`}
                                  value={device.fov}
                                  limits={DEVICE_LIMITS.fov}
                                  onChange={(fov) =>
                                    setDevice(kind, device.id, { fov })
                                  }
                                />
                              </label>
                              <label>
                                <span>光圈 mm</span>
                                <NumberCell
                                  label={`${device.id} 光圈 mm`}
                                  value={device.aperture}
                                  limits={DEVICE_LIMITS.aperture}
                                  onChange={(aperture) =>
                                    setDevice(kind, device.id, { aperture })
                                  }
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })}
                      <button
                        className="sandbox-reset"
                        onClick={() => addDevice(kind)}
                        disabled={list.length >= MAX_DEVICES}
                      >
                        <Plus size={14} />
                        新增 {kind === "camera" ? "Camera" : "Projector"}
                      </button>
                    </section>
                  );
                })}
                <InfoHeading title="Camera 鏡頭">
                  <p>
                    開啟面積積分後，跨在邊緣上的像素會混合兩個表面的條紋（混合像素），小細節在低解析度時會重建錯誤或消失。解析度越高掃描越久。
                  </p>
                </InfoHeading>
                <label className="sandbox-preset">
                  <span>解析度</span>
                  <select
                    aria-label="Camera 解析度"
                    value={config.cameraWidth}
                    onChange={(e) =>
                      update({ cameraWidth: Number(e.target.value) })
                    }
                  >
                    {[96, 160, 192, 256, 384].map((w) => (
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
                {field("projectorWidth", "Projector 寬度", {
                  step: 16,
                  digits: 0,
                  unit: "px",
                  onChange: (v) =>
                    update({ projectorWidth: Math.round(v / 4) * 4 }),
                })}
                <InfoHeading title="Baseline">
                  <p>使用中 Camera 與 Projector 兩光心的距離。</p>
                </InfoHeading>
                <p className="sandbox-note" data-testid="sandbox-baseline">
                  兩光心距離{" "}
                  {Math.hypot(
                    activeCamera.x - activeProjector.x,
                    activeCamera.y - activeProjector.y,
                    activeCamera.z - activeProjector.z,
                  ).toFixed(1)}{" "}
                  mm
                </p>
              </>
            )}
            {toolTab === "projector" && (
              <>
                <InfoHeading title="條紋編碼">
                  <p>
                    投影圖樣 = offset + amplitude·cos(2πf·u/W − π + 2πk/N)。頻率
                    f 是整個投影寬度內的週期數；f 越高，同樣的相位誤差對應的
                    column 誤差越小（約 ∝ 1/f），但 φ̂ 只在一個週期內唯一。
                  </p>
                  <p>N 步相移：N 越多對雜訊越不敏感，但要拍更多張。</p>
                </InfoHeading>
                {field("fringeFrequency", "條紋頻率 f", {
                  step: 1,
                  unit: "週期",
                  digits: 0,
                })}
                {field("phaseSteps", "相移步數 N", {
                  step: 1,
                  unit: "步",
                  digits: 0,
                })}
                <InfoHeading title="相位解包 / 量測範圍">
                  <p>
                    <strong>時間解包</strong>：f &gt; 1 時加投 N 張 f = 1
                    條紋，用其相位推算條紋序 k；f 很高時雜訊被放大 f 倍，可能讓
                    k 算錯。
                  </p>
                  <p>
                    <strong>單週期 + 基準面</strong>（AOI
                    常用）：以校正基準面上的相位決定 k，只在「視窗底部」往上
                    一個 2π 對應的高度內正確；超出的高度會混疊（量測範圍）。
                  </p>
                  <p>
                    <strong>粗 / 細雙週期</strong>：加投週期 p₂ = R·p₁
                    的粗條紋，粗相位放在基準面視窗上再決定細條紋的 k，範圍 = R ×
                    每 2π 高度；R 越大範圍越大，但粗相位雜訊被放大 R 倍。
                  </p>
                  <p>
                    <strong>雙週期（外差）</strong>：加投週期 p₂ = p₁·比值
                    的條紋，拍頻把範圍擴大 r/(r−1)
                    倍，代價是雜訊放大、級次錯誤風險上升。
                  </p>
                </InfoHeading>
                <div
                  className="sandbox-palette"
                  role="radiogroup"
                  aria-label="相位解包方式"
                >
                  {(
                    [
                      ["temporal", "時間解包"],
                      ["single", "單週期 + 基準面"],
                      ["coarse", "粗 / 細雙週期"],
                      ["dual", "雙週期（外差）"],
                    ] as const
                  ).map(([id, title]) => (
                    <button
                      key={id}
                      role="radio"
                      aria-checked={config.coding === id}
                      aria-pressed={config.coding === id}
                      onClick={() =>
                        update({
                          coding: id,
                          fringeFrequency:
                            id === "dual"
                              ? config.fringeFrequency
                              : Math.round(config.fringeFrequency),
                        })
                      }
                    >
                      {title}
                    </button>
                  ))}
                </div>
                {(config.coding === "dual" || config.coding === "coarse") &&
                  field("periodRatio", "週期比 p₂/p₁", { step: 0.01 })}
                {config.coding !== "temporal" &&
                  field("windowBottom", "相位視窗底部（相對基準面）", {
                    step: 0.05,
                    unit: "mm",
                  })}
                <p className="sandbox-note" data-testid="sandbox-frame-count">
                  每次掃描投影 {fringePatterns(config).length} 張
                </p>
                <InfoHeading title="亮度與對比">
                  <p>
                    圖樣要留在 [0, 1] 內，所以 amplitude ≤ min(offset, 1 −
                    offset)。amplitude
                    越小調變越弱、越容易被雜訊或調變門檻吃掉；offset
                    太高則亮面容易 clipping。
                  </p>
                </InfoHeading>
                {field("fringeOffset", "條紋 offset", {
                  step: 0.01,
                  onChange: (fringeOffset) =>
                    update({
                      fringeOffset,
                      fringeAmplitude: Math.min(
                        config.fringeAmplitude,
                        fringeOffset,
                        1 - fringeOffset,
                      ),
                    }),
                })}
                {field("fringeAmplitude", "條紋 amplitude", {
                  step: 0.01,
                  max: Math.min(
                    WORLD_LIMITS.fringeAmplitude[1],
                    config.fringeOffset,
                    1 - config.fringeOffset,
                  ),
                })}
                {field("exposure", "曝光增益", { step: 0.05 })}
                {field("minModulation", "最低調變 B", {
                  step: 0.001,
                  digits: 3,
                })}
                <InfoHeading title="失焦（薄透鏡）">
                  <p>
                    模糊圓 c = f·A·|1/s −
                    1/s_f|（像素，A＝光圈直徑，在「裝置」分頁設定）；以等二階矩高斯
                    σ = c/4 近似。Projector 失焦降低條紋對比（MTF =
                    exp(−2π²σ²/P²)），Camera
                    失焦以逐像素散佈模糊混合鄰近相位。所有裝置對焦在瞄準點正下方「基準面
                    + 對焦高度」。
                  </p>
                </InfoHeading>
                <label className="sandbox-toggle">
                  <input
                    type="checkbox"
                    checked={config.defocus}
                    onChange={(e) => update({ defocus: e.target.checked })}
                  />
                  啟用失焦模型
                </label>
                {field("focusHeight", "對焦高度（相對基準面）", {
                  step: 0.1,
                  unit: "mm",
                })}
                <button
                  className="sandbox-reset"
                  onClick={() =>
                    update({
                      fringeFrequency: DEFAULT_WORLD.fringeFrequency,
                      phaseSteps: DEFAULT_WORLD.phaseSteps,
                      coding: DEFAULT_WORLD.coding,
                      periodRatio: DEFAULT_WORLD.periodRatio,
                      windowBottom: DEFAULT_WORLD.windowBottom,
                      fringeOffset: DEFAULT_WORLD.fringeOffset,
                      fringeAmplitude: DEFAULT_WORLD.fringeAmplitude,
                      exposure: DEFAULT_WORLD.exposure,
                      minModulation: DEFAULT_WORLD.minModulation,
                    })
                  }
                >
                  <RotateCcw size={16} />
                  重設投影參數
                </button>
              </>
            )}
            {toolTab === "material" && (
              <>
                {(
                  [
                    [
                      config.shape === "pcb"
                        ? "PCB 板"
                        : BOARD_SHAPES.includes(config.shape)
                          ? "板面"
                          : "物體",
                      "objectAlbedo",
                      "objectSpecular",
                      "objectRoughness",
                    ],
                    ...(config.shape === "pcb" ||
                    config.shape === "step" ||
                    config.shape === "chip"
                      ? ([
                          [
                            config.shape === "step" ? "量規" : "晶片",
                            "chipAlbedo",
                            "chipSpecular",
                            "chipRoughness",
                          ],
                        ] as const)
                      : []),
                    ...(config.shape === "pcb" || config.shape === "chip"
                      ? ([
                          [
                            config.shape === "chip" ? "電極" : "引腳",
                            "pinAlbedo",
                            "pinSpecular",
                            "pinRoughness",
                          ],
                        ] as const)
                      : []),
                    ...(config.shape === "chip"
                      ? ([
                          [
                            "焊錫",
                            "solderAlbedo",
                            "solderSpecular",
                            "solderRoughness",
                          ],
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
                    const base: WorldConfig = {
                      ...DEFAULT_WORLD,
                      ...(config.shape === "pcb"
                        ? PCB_SETUP
                        : BOARD_SHAPES.includes(config.shape)
                          ? boardSetup(config.shape)
                          : {}),
                    };
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
                      solderAlbedo: base.solderAlbedo,
                      solderSpecular: base.solderSpecular,
                      solderRoughness: base.solderRoughness,
                    });
                  }}
                >
                  <RotateCcw size={16} />
                  重設材質參數
                </button>
                <InfoHeading title="間接光">
                  <p>
                    亮度 = 0.12 環境 + 直接光 + 間接光。鏡面為
                    GGX，低粗糙度會產生飽和高光而被 clipping；互反射以 Monte
                    Carlo
                    路徑追蹤，取樣越多雜訊越少。金屬沒有漫射，只有鏡射方向附近的像素看得到條紋，其餘無法解碼——這正是實機掃描金屬的困難。
                  </p>
                </InfoHeading>
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
              </>
            )}
            {toolTab === "more" && (
              <>
                <InfoHeading title="雜訊與可重現">
                  <p>僅加性 Gaussian；不含完整 sensor noise。</p>
                </InfoHeading>
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
                <button
                  className="sandbox-reset"
                  onClick={() => update(structuredClone(DEFAULT_WORLD))}
                >
                  <RotateCcw size={16} />
                  重設場景參數
                </button>
                <InfoHeading title="模型與簡化">
                  <p>
                    <strong>已實作：</strong>已知 Pinhole Camera–Projector
                    內外參（可多台，一次掃描一組）、Camera ray–mesh 交點（BVH
                    加速）、Projector 視野與遮擋、Lambert + GGX 材質、Monte
                    Carlo 互反射（1–3 次）、薄透鏡失焦、N 步 Phase
                    Shifting、時間 / 單週期基準面 / 雙週期解包、ray–plane
                    Triangulation、重建點雲與深度誤差。單位為 mm。
                  </p>
                  <p>
                    <strong>重要假設：</strong>
                    校正完美已知；各種解包都是一般的多頻 / 基準面方法，不是
                    Micro PS。
                  </p>
                  <p>
                    <strong>仍未支援：</strong>由棋盤格估計
                    Calibration、鏡頭失真、次表面散射、Gamma、量化。Projector
                    為點光源且未建模距離衰減，材質為無色、Fresnel 為常數。
                  </p>
                  <p>
                    主視窗由 WebGL 畫投影與陰影；量測使用相同幾何的 CPU
                    光線追蹤與 Float64 intensity，並非螢幕截圖。深度定義為
                    Camera optical-axis Z。
                  </p>
                </InfoHeading>
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
            overlay={overlay}
            onMove={(x, y, z) => update({ x, y, z })}
            onDevice={(kind, id, x, y, z) => setDevice(kind, id, { x, y, z })}
            onActivate={(kind, id) =>
              update(
                kind === "camera"
                  ? { activeCamera: id }
                  : { activeProjector: id },
              )
            }
          />
          <div className="sandbox-overlay sandbox-overlay-top">
            <span className="sandbox-chip">觀察視角 · 每格 12.5 mm</span>
            {overlay && (
              <span className="sandbox-chip" data-testid="sandbox-overlay-chip">
                多視角點雲：{overlay.label}
                <button
                  aria-label="移除多視角點雲"
                  onClick={() => setOverlay(null)}
                >
                  <X size={13} />
                </button>
              </span>
            )}
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
              <InfoButton
                label="操作說明"
                open={showHelp}
                onToggle={() => setShowHelp((v) => !v)}
              />
            </div>
          </div>
          {showHelp && (
            <div className="sandbox-overlay sandbox-overlay-bottom sandbox-play-help">
              <span>左鍵：選取並拖曳物體／Camera／Projector</span>
              <span>中鍵：旋轉</span>
              <span>右鍵：平移</span>
              <span>滾輪：縮放</span>
              <span>WASD／Q E：移動、轉向</span>
              <span>R：重設視角</span>
            </div>
          )}
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
                {valid ? `${depth.toFixed(2)} mm` : "N/A"}
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
          >
            <InfoButton
              label="結果分頁說明"
              open={resultInfo}
              onToggle={() => setResultInfo((v) => !v)}
            />
          </Tabs>
          <div className={`sandbox-panel-body ${stale ? "stale" : ""}`}>
            {resultInfo && (
              <div className="sandbox-info-panel">
                <p>
                  {resultTab === "captures"
                    ? `前 ${steps} 張只差投影相移 2πk/${steps}，φ̂ 由它們解出，不讀取表面座標${patterns.length > steps ? "；「低頻」影像是用來解包的單週期條紋" : ""}。點影像可選像素。`
                    : resultTab === "depth"
                      ? "3D 視窗中藍線＝Camera 射線；黃平面＝Projector 光平面；紅點＝三角量測結果。點影像可選像素。"
                      : "直接光與間接光是正向模型內部的評估資料，重建時不會讀取。互反射在「材質」分頁開關。"}
                </p>
              </div>
            )}
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
                  {scan.capture.frames.map((_, k) => (
                    <button
                      key={k}
                      aria-pressed={scanFrame === k}
                      onClick={() => setFrame(k)}
                    >
                      {frameLabel(k)}
                    </button>
                  ))}
                </div>
                <div className="sandbox-image-grid">
                  {scan.capture.frames.map((values, k) => (
                    <figure
                      key={k}
                      className={scanFrame === k ? "selected" : ""}
                    >
                      <Image
                        {...imageProps}
                        values={values}
                        testId={`sandbox-capture-${k}`}
                      />
                      <figcaption>
                        {frameLabel(k)}
                        {scanFrame === k ? " · 場景顯示中" : ""}
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
                  {scan.reconstruction.lowPhase && (
                    <figure>
                      <Image
                        {...imageProps}
                        values={scan.reconstruction.lowPhase.wrapped}
                        kind="phase"
                        testId="sandbox-low-phase"
                        label="單週期相位"
                      />
                      <figcaption>單週期相位 φ₁</figcaption>
                    </figure>
                  )}
                  {scaledAbsolute && (
                    <figure>
                      <Image
                        {...imageProps}
                        values={scaledAbsolute}
                        kind="phase"
                        testId="sandbox-absolute-phase"
                        label="解包後相位"
                      />
                      <figcaption>
                        {scan.reconstruction.lowPhase
                          ? "解包後 Φ/f"
                          : "未解包：φ̂/f"}
                      </figcaption>
                    </figure>
                  )}
                </div>
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
                    <figcaption>重建 Depth（色階 25–250 mm）</figcaption>
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
                    {steps} 次亮度解出 φ̂ = <b>{f(phase)} rad</b>
                  </li>
                  {coding.fringeFrequency > 1 && (
                    <li>
                      {coding.coding === "temporal" ? (
                        <>
                          單週期 φ₁ = <b>{f(lowPhase)} rad</b> → 條紋序 k ={" "}
                          <b>{Number.isFinite(order) ? order : "N/A"}</b>
                        </>
                      ) : coding.coding === "dual" ||
                        coding.coding === "coarse" ? (
                        <>
                          粗週期 φ₂ = <b>{f(lowPhase)} rad</b>，
                          {coding.coding === "dual" ? "拍頻相位" : "粗相位"}
                          放在基準面視窗 → k ={" "}
                          <b>{Number.isFinite(order) ? order : "N/A"}</b>
                        </>
                      ) : (
                        <>
                          以基準面視窗（{coding.windowBottom} mm 起）決定 k ={" "}
                          <b>{Number.isFinite(order) ? order : "N/A"}</b>
                          ；超出量測範圍會混疊
                        </>
                      )}
                    </li>
                  )}
                  <li>
                    對應 Projector column <b>{f(projectorU, 2)} px</b>
                  </li>
                  <li>
                    Camera 射線 ∩ 該 column 光平面 →{" "}
                    <b>{valid ? `${depth.toFixed(2)} mm` : "無有效交點"}</b>
                  </li>
                  <li>
                    與真值差{" "}
                    <b>
                      {valid ? `${mm(Math.abs(depthError![probe]))} mm` : "N/A"}
                    </b>
                  </li>
                </ol>
              </>
            ) : (
              <>
                <div className="sandbox-image-grid">
                  <figure>
                    <Image
                      {...imageProps}
                      values={scan.capture.direct[scanFrame]}
                      testId="sandbox-direct"
                      label="直接光分量"
                    />
                    <figcaption>直接光 · {frameLabel(scanFrame)}</figcaption>
                  </figure>
                  <figure>
                    <Image
                      {...imageProps}
                      values={scan.capture.indirect[scanFrame]}
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
                    ? `此像素間接光 ${f(scan.capture.indirect[scanFrame][probe])}。`
                    : "互反射關閉：間接光為 0。"}
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
            update(readEnvelope(envelope));
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
