import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Box,
  Camera,
  Check,
  Crosshair,
  Move3D,
  Play,
  RotateCcw,
  Save,
  ScanLine,
  Upload,
} from "lucide-react";
import {
  DEFAULT_WORLD,
  parseWorldConfig,
  runWorldScan,
  type WorldConfig,
} from "./scanner";
import WorldView, { type WorldViewApi } from "./WorldView";
import { downloadBlob, rasterize } from "../lib/images";
import { TAU } from "../core/simulation";
import "./sandbox.css";

type Scan = ReturnType<typeof runWorldScan>;
const KEY = "structured-light.sandbox.parameters.v1";
const MODEL = "calibrated-one-cycle-sandbox";
function loadWorld(): WorldConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_WORLD };
    const e = JSON.parse(raw);
    if (e.schemaVersion !== 1 || e.model !== MODEL) return { ...DEFAULT_WORLD };
    return parseWorldConfig(e.config);
  } catch {
    return { ...DEFAULT_WORLD };
  }
}
function pack(config: WorldConfig) {
  return JSON.stringify({ schemaVersion: 1, model: MODEL, config }, null, 2);
}
const f = (value: number, n = 3) =>
  Number.isFinite(value) ? value.toFixed(n) : "N/A";
function Image({
  values,
  width,
  height,
  testId,
  onPick,
  probe,
  kind = "intensity",
}: {
  values: Float64Array;
  width: number;
  height: number;
  testId: string;
  onPick: (index: number) => void;
  probe: number;
  kind?: "intensity" | "phase" | "depth";
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (kind === "depth") {
      const image = ctx.createImageData(width, height);
      for (let i = 0; i < values.length; i++) {
        const d = values[i],
          t = Math.max(0, Math.min(1, (d - 1) / 9));
        image.data.set(
          Number.isFinite(d)
            ? [255 * (1 - t), 180 * (1 - Math.abs(t - 0.5)), 255 * t, 255]
            : [14, 23, 35, 255],
          i * 4,
        );
      }
      ctx.putImageData(image, 0, 0);
    } else ctx.drawImage(rasterize(values, width, height, kind), 0, 0);
  }, [values, width, height, kind]);
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
          kind === "intensity"
            ? "Camera 實際合成量測；點擊查看像素深度"
            : kind === "depth"
              ? "由條紋解碼與三角量測得到的 Camera Z depth"
              : "解碼所得 Wrapped Phase"
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
function Slider({
  label,
  value,
  min,
  max,
  step = 0.05,
  onChange,
  testId,
  unit = "m",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  testId?: string;
  unit?: string;
}) {
  return (
    <label className="sandbox-slider">
      <span>
        {label}
        <output data-testid={testId}>
          {f(value, 2)} {unit}
        </output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
export default function Sandbox({
  onGuide,
  onExplore,
}: {
  onGuide: () => void;
  onExplore: () => void;
}) {
  const [config, setConfig] = useState(loadWorld),
    [scan, setScan] = useState<Scan | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("正在準備第一組三步曝光…"),
    [message, setMessage] = useState(""),
    [probe, setProbe] = useState(0),
    [frame, setFrame] = useState(0),
    [showCloud, setShowCloud] = useState(false),
    [showRays, setShowRays] = useState(true),
    [focusSpace, setFocusSpace] = useState(false);
  const world = useRef<WorldViewApi>(null),
    file = useRef<HTMLInputElement>(null),
    latest = useRef(config),
    generation = useRef(0),
    importGeneration = useRef(0);
  latest.current = config;
  const update = useCallback((patch: Partial<WorldConfig>) => {
    generation.current++;
    setBusy(false);
    setConfig((c) => ({ ...c, ...patch }));
    setScan(null);
    setStatus("場景已改。按「拍三張並重建」取得目前場景的新結果。");
    setMessage("");
  }, []);
  const performScan = useCallback(() => {
    const token = ++generation.current,
      snapshot = { ...latest.current };
    setBusy(true);
    setMessage("");
    setStatus("正在追蹤 Camera 射線、檢查 Projector 遮擋，再解碼與三角量測…");
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (token !== generation.current) return;
        try {
          const next = runWorldScan(snapshot);
          if (token !== generation.current) return;
          setScan(next);
          const { width, height } = next.capture;
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
          setBusy(false);
          setStatus(
            `掃描完成：已由三張 ${width}×${height} Camera Captures 解算深度。`,
          );
        } catch (error) {
          setBusy(false);
          setStatus("掃描失敗，沒有以真值補出結果。");
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }, 0),
    );
  }, []);
  useEffect(() => {
    const timer = setTimeout(performScan, 120);
    return () => {
      clearTimeout(timer);
      generation.current++;
      importGeneration.current++;
    };
  }, [performScan]);
  const depth = scan?.reconstruction.depth[probe] ?? NaN,
    valid = !!scan?.reconstruction.valid[probe],
    phase = scan?.reconstruction.phase.wrapped[probe] ?? NaN,
    projectorU = scan
      ? (scan.projector.width * (phase + Math.PI)) / TAU - 0.5
      : NaN;
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
          <ScanLine size={26} />
          <strong>
            結構光實驗室<span>3D Sandbox · 第二階段基礎版</span>
          </strong>
        </div>
        <nav>
          <button onClick={onGuide}>
            <ArrowLeft size={16} />
            一步一步學
          </button>
          <button onClick={onExplore}>
            一維自由實驗
            <ArrowRight size={16} />
          </button>
        </nav>
      </header>
      <main className="sandbox-main">
        <div className="sandbox-title">
          <div>
            <span>先玩空間，再看深度怎麼來</span>
            <h1>走進 3D 掃描沙盒。</h1>
            <p>
              轉動視角、拖動物體，再讓 Camera 看 Projector
              投下的條紋。這個大視窗是觀察視角，不是量測 Camera 的影像。
            </p>
          </div>
          <button
            className="sandbox-scan-button"
            onClick={performScan}
            disabled={busy}
          >
            <Play size={19} />
            {busy ? "正在掃描…" : "拍三張並重建"}
          </button>
        </div>
        <div className="sandbox-play-layout">
          <section className="sandbox-playground">
            <div className="sandbox-world-toolbar">
              <span>
                <Move3D size={17} />
                觀察視角 · 每格 0.5 m
              </span>
              <div className="sandbox-view-buttons">
                <button onClick={() => setFocusSpace((v) => !v)}>
                  {focusSpace ? "返回完整工作區" : "專注 3D 空間"}
                </button>
                <button onClick={() => world.current?.resetView()}>
                  <RotateCcw size={16} />
                  重設視角
                </button>
              </div>
            </div>
            <WorldView
              ref={world}
              config={config}
              scan={scan}
              probe={probe}
              frame={frame}
              showCloud={showCloud}
              showRays={showRays}
              onMove={(x, y, z) => update({ x, y, z })}
            />
            <div className="sandbox-play-help">
              <span>拖曳空白處：旋轉</span>
              <span>滾輪：縮放</span>
              <span>彩色箭頭：移動物體</span>
              <span>點場景後按 WASD：平移物體</span>
            </div>
            <div className="sandbox-view-switches">
              <label>
                <input
                  type="checkbox"
                  checked={showRays}
                  onChange={(e) => setShowRays(e.target.checked)}
                />
                顯示選中像素的射線與光平面
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={showCloud}
                  onChange={(e) => setShowCloud(e.target.checked)}
                />
                顯示重建點雲
              </label>
            </div>
          </section>
          <aside className="sandbox-tools">
            <h2>
              <Box size={20} />
              場景工具
            </h2>
            <p>
              先移動物體，再按「拍三張並重建」。舊結果會清除，不冒充新量測。
            </p>
            <div className="sandbox-palette">
              {(
                [
                  ["sphere", "球體"],
                  ["box", "方塊"],
                  ["ramp", "斜板"],
                ] as const
              ).map(([shape, title]) => (
                <button
                  key={shape}
                  aria-pressed={config.shape === shape}
                  onClick={() => update({ shape })}
                >
                  {title}
                </button>
              ))}
            </div>
            <Slider
              label="物體 X 位置"
              value={config.x}
              min={-2}
              max={2}
              onChange={(x) => update({ x })}
              testId="sandbox-object-x"
            />
            <Slider
              label="物體高度 Y"
              value={config.y}
              min={0.65}
              max={2.5}
              onChange={(y) => update({ y })}
            />
            <Slider
              label="物體 Z 位置"
              value={config.z}
              min={-2}
              max={2}
              onChange={(z) => update({ z })}
            />
            <div className="sandbox-control-divider" />
            <Slider
              label="Camera–Projector 水平間距"
              value={config.baseline}
              min={0.4}
              max={3}
              onChange={(baseline) => update({ baseline })}
            />
            <Slider
              label="Camera FOV"
              value={config.cameraFov}
              min={30}
              max={75}
              step={1}
              unit="°"
              onChange={(cameraFov) => update({ cameraFov })}
            />
            <details className="sandbox-extra">
              <summary>雜訊與可重現設定</summary>
              <Slider
                label="Gaussian Noise σ"
                value={config.noiseSigma}
                min={0}
                max={0.01}
                step={0.001}
                unit=""
                onChange={(noiseSigma) => update({ noiseSigma })}
              />
              <label>
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
              <p>僅加性 Gaussian；不含完整 sensor noise。</p>
            </details>
            <button
              className="sandbox-reset"
              onClick={() => update({ ...DEFAULT_WORLD })}
            >
              <RotateCcw size={17} />
              重設場景參數
            </button>
          </aside>
        </div>
        <p
          className="sandbox-status"
          data-testid="sandbox-status"
          role="status"
        >
          {busy ? <ScanLine size={18} /> : <Check size={18} />}
          <span>{status}</span>
        </p>
        <section className="sandbox-result-strip">
          <div>
            <span>重建有效像素 / 全部像素</span>
            <strong>
              <b data-testid="sandbox-valid-count">
                {scan?.metrics.validCount ?? 0}
              </b>
              <small> / {scan?.metrics.totalCount ?? 6912}</small>
            </strong>
            <p>
              {scan
                ? `${(scan.metrics.validRatio * 100).toFixed(1)}% · Projector 未直接照明 ${scan.metrics.occludedCount} px`
                : "尚未掃描目前場景"}
            </p>
          </div>
          <div>
            <span>Depth RMSE · Camera Z</span>
            <strong>
              {scan?.metrics.rmseDepth == null
                ? "N/A"
                : scan.metrics.rmseDepth < 0.000001
                  ? "＜ 0.001"
                  : (scan.metrics.rmseDepth * 1000).toFixed(3)}
              <small>{scan?.metrics.rmseDepth == null ? "" : " mm"}</small>
            </strong>
            <p>真值只供評估；理想合成的微小誤差不代表實機精度。</p>
          </div>
          <div>
            <span>
              <Crosshair size={16} />
              選中像素的深度
            </span>
            <strong data-testid="sandbox-probe-depth">
              {valid ? `${depth.toFixed(3)} m` : "N/A"}
            </strong>
            <p>
              {scan
                ? `Camera pixel (${probe % scan.capture.width}, ${Math.floor(probe / scan.capture.width)})`
                : "點下方 Camera 影像選像素"}
            </p>
          </div>
        </section>
        <section className="sandbox-measurements">
          <div className="sandbox-section-title">
            <h2>
              <Camera size={21} />
              Camera 真正看見的三次曝光
            </h2>
            <span>CPU 射線追蹤合成；點影像選像素與光路。</span>
          </div>
          {scan ? (
            <>
              <div className="sandbox-captures">
                {scan.capture.frames.map((values, k) => (
                  <div key={k}>
                    <button
                      className={frame === k ? "selected" : ""}
                      onClick={() => setFrame(k)}
                    >
                      I{k + 1} · 相移 {k * 120}°
                      <span>
                        {frame === k ? "場景正在顯示此曝光" : "切換場景曝光"}
                      </span>
                    </button>
                    <Image
                      {...{
                        values,
                        width: scan.capture.width,
                        height: scan.capture.height,
                        probe,
                        onPick: setProbe,
                      }}
                      testId={`sandbox-capture-${k}`}
                    />
                  </div>
                ))}
              </div>
              <div className="sandbox-recovery">
                <div>
                  <h3>Wrapped Phase</h3>
                  <Image
                    values={scan.reconstruction.phase.wrapped}
                    width={scan.capture.width}
                    height={scan.capture.height}
                    probe={probe}
                    onPick={setProbe}
                    kind="phase"
                    testId="sandbox-phase"
                  />
                  <p>由 I₁、I₂、I₃ 的差異解出，不讀取表面座標。</p>
                </div>
                <div>
                  <h3>重建 Depth · Camera Z</h3>
                  <Image
                    values={scan.reconstruction.depth}
                    width={scan.capture.width}
                    height={scan.capture.height}
                    probe={probe}
                    onPick={setProbe}
                    kind="depth"
                    testId="sandbox-depth"
                  />
                  <p>顯示色階 1–10 m；暗色為無效，不補洞。</p>
                </div>
                <div className="sandbox-explanation">
                  <h3>這個點的深度怎麼來？</h3>
                  <ol>
                    <li>
                      由三次亮度算出 φ̂ = <b>{f(phase)} rad</b>。
                    </li>
                    <li>
                      單一完整週期對應 Projector column{" "}
                      <b>{f(projectorU, 2)} px</b>。
                    </li>
                    <li>
                      Camera 射線與該 column 光平面交會，得到{" "}
                      <b>{valid ? depth.toFixed(3) + " m" : "無有效交點"}</b>。
                    </li>
                  </ol>
                  <p>
                    藍線＝Camera 射線；黃線／平面＝Projector
                    對應光平面；紅點＝實際三角量測結果。
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div className="sandbox-no-result">
              {busy
                ? "正在產生三張 Camera Captures…"
                : "場景已改動。請重新拍三張，這裡才會顯示目前場景的結果。"}
            </div>
          )}
        </section>
        <div className="sandbox-export">
          <button onClick={save}>
            <Save size={17} />
            保存沙盒參數
          </button>
          <button
            onClick={() =>
              downloadBlob(
                new Blob([pack(config)], { type: "application/json" }),
                "sandbox-parameters.json",
              )
            }
          >
            <ArrowDownToLine size={17} />
            JSON
          </button>
          <button onClick={() => file.current?.click()}>
            <Upload size={17} />
            匯入 JSON
          </button>
          <button onClick={csv} disabled={!scan}>
            <ArrowDownToLine size={17} />
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
            <ArrowDownToLine size={17} />
            PNG 場景
          </button>
        </div>
        {message && (
          <p className="sandbox-message" role="status">
            {message}
          </p>
        )}
        <details className="sandbox-model-notes">
          <summary>這個沙盒做了什麼？有哪些簡化？</summary>
          <p>
            <strong>已實作：</strong>已知 Pinhole Camera–Projector
            內外參、Camera ray–mesh 交點、Projector 視野與遮擋、Lambertian
            直接照明、三步 Phase Shifting、單週期 column 解碼、ray–plane
            Triangulation、重建點雲與深度誤差。
          </p>
          <p>
            <strong>重要假設：</strong>目前 Projector 視野只投單一完整週期，因此
            φ 能唯一對應
            column。這不是任意高頻條紋都能直接做的絕對解包裹，也不是 Micro PS。
          </p>
          <p>
            <strong>仍未支援：</strong>由棋盤格估計
            Calibration、鏡頭失真、Defocus、Interreflection、Gamma、量化、動態曝光／重力與剛體碰撞。Calibration
            目前是已知的合成設定；使用均勻反射係數，尚未建模距離衰減。
          </p>
          <p>
            主視窗由 WebGL 畫投影與陰影；量測使用相同幾何的 CPU raycasting 與
            Float64 intensity，並非螢幕截圖。GPU 視覺用近似陰影偏置，CPU
            量測做直接可見性判定。深度定義為 Camera optical-axis Z，不是到相機的
            Euclidean range。Baseline
            控制的是水平間距，設備另有固定高度／前後偏移。
          </p>
          <p>
            這是第二階段的第一個可操作里程碑，不代表完整四階段 Scanner 已完成。
          </p>
        </details>
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
              if (envelope.schemaVersion !== 1 || envelope.model !== MODEL)
                throw new Error("不是此沙盒的參數格式");
              const next = parseWorldConfig(envelope.config);
              update(next);
              setMessage("已匯入沙盒設定，請重新掃描；保存記錄尚未覆寫。");
            } catch (error) {
              if (token !== importGeneration.current) return;
              setMessage(
                `匯入失敗，原設定未變更：${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }}
        />
      </main>
    </div>
  );
}
