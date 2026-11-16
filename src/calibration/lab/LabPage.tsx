import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Camera, Check, RotateCcw, Shuffle, Trash2, X } from "lucide-react";
import { createSeededRandom } from "../../core/simulation";
import { norm3, rotationAngleDeg, rotationToVector, sub3 } from "../linalg";
import type { Intrinsics, Point2 } from "../camera";
import { Slider } from "../CalibrationLabs";
import { M } from "../Tex";
import LabScene from "./LabScene";
import { CornerMarks, ErrorVectors, GrayImage, PhaseMap } from "./images";
import {
  CELL_NAMES,
  coverage,
  hintsFor,
  tiltDirection,
  type Hint,
} from "./assistant";
import { expose, scaleIntrinsics, sceneTerms, shade } from "./render";
import {
  BOARD,
  DEFAULT_PLACEMENT,
  DEFAULT_SETTINGS,
  LAB_CAMERA,
  LAB_PROJECTOR,
  LAB_STEREO,
  boardTilt,
  cameraAt,
  placementPose,
  truthProjections,
  type BoardPlacement,
  type CaptureSettings,
} from "./rig";
import type { Capture } from "./capture";
import { CALIB_FLAGS, type CalibFlag } from "./opencv";
import type {
  CameraCalibrationResult,
  LabRequest,
  LabResponse,
  ProjectorCalibrationResult,
} from "./lab.worker";
import { checkView } from "./validate";
import "../calibration.css";
import "./lab.css";

type Step = "capture" | "camera" | "projector" | "verify";
const STEPS: { id: Step; label: string }[] = [
  { id: "capture", label: "擺板子・拍照" },
  { id: "camera", label: "Camera 校正" },
  { id: "projector", label: "Projector 校正" },
  { id: "verify", label: "驗證" },
];

interface Shot {
  key: number;
  placement: BoardPlacement;
  settings: CaptureSettings;
  capture: Capture;
  include: boolean;
}

type Payload<T extends LabRequest["type"]> = Extract<
  LabResponse,
  { type: T; ok: true }
>;
type Body<T extends LabRequest["type"]> = Omit<
  Extract<LabRequest, { type: T }>,
  "id"
>;

function useLabWorker() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, (r: LabResponse) => void>());
  const nextId = useRef(1);
  useEffect(() => {
    const w = new Worker(new URL("./lab.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<LabResponse>) => {
      pending.current.get(e.data.id)?.(e.data);
      pending.current.delete(e.data.id);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);
  return useCallback(
    <T extends LabRequest["type"]>(
      body: Body<T> & { type: T },
    ): Promise<Payload<T>> =>
      new Promise((resolve, reject) => {
        const id = nextId.current++;
        pending.current.set(id, (r) =>
          r.ok ? resolve(r as Payload<T>) : reject(new Error(r.error)),
        );
        worker.current!.postMessage({ ...body, id } as LabRequest);
      }),
    [],
  );
}

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const deg = (v: number) => (v * 180) / Math.PI;
const PREVIEW_SCALE = 0.375;

function LivePreview({
  placement,
  settings,
  shots,
}: {
  placement: BoardPlacement;
  settings: CaptureSettings;
  shots: Shot[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const K = useMemo(
    () => scaleIntrinsics(cameraAt(settings.focusMm), PREVIEW_SCALE),
    [settings.focusMm],
  );
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const terms = sceneTerms(K, placementPose(placement), settings, 1);
      const img = expose(shade(terms, null), settings, createSeededRandom(1));
      const c = canvas.current;
      if (!c) return;
      c.width = K.width;
      c.height = K.height;
      const ctx = c.getContext("2d")!;
      const data = ctx.createImageData(K.width, K.height);
      for (let i = 0; i < img.length; i++) {
        const v = img[i];
        // Clipped pixels are tinted red, like a camera's zebra display.
        data.data[4 * i] = v === 255 ? 255 : v;
        data.data[4 * i + 1] = v === 255 ? 60 : v;
        data.data[4 * i + 2] = v === 255 ? 60 : v;
        data.data[4 * i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [K, placement, settings]);
  const found = shots.filter((s) => s.capture.corners && s.include);
  const cells = coverage(found.map((s) => s.capture.corners!));
  const W = LAB_CAMERA.width,
    H = LAB_CAMERA.height;
  return (
    <div className="lab-image lab-preview">
      <canvas ref={canvas} />
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {cells.map((on, i) => (
          <rect
            key={i}
            x={((i % 3) * W) / 3}
            y={(Math.floor(i / 3) * H) / 3}
            width={W / 3}
            height={H / 3}
            fill={on ? "rgba(94,228,189,0.07)" : "rgba(255,155,133,0.07)"}
            stroke="rgba(255,255,255,0.15)"
          />
        ))}
        {found.flatMap((s) =>
          s.capture.corners!.map((p, i) => (
            <circle
              key={`${s.key}-${i}`}
              cx={p[0]}
              cy={p[1]}
              r={3}
              fill="#5ee4bd"
              opacity={0.55}
            />
          )),
        )}
      </svg>
    </div>
  );
}

function ProjectorCoverage({ placement }: { placement: BoardPlacement }) {
  // Projector pixels do not depend on the camera focus.
  const pts = truthProjections(placement).projector;
  const W = LAB_PROJECTOR.width,
    H = LAB_PROJECTOR.height;
  return (
    <svg
      className="lab-projector-view"
      viewBox={`-60 -60 ${W + 120} ${H + 120}`}
      role="img"
      aria-label="Projector 影像中的板子位置"
    >
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        fill="#151d27"
        stroke="#b7a0fa"
        strokeWidth={4}
      />
      <circle
        cx={LAB_PROJECTOR.cx}
        cy={LAB_PROJECTOR.cy}
        r={10}
        fill="none"
        stroke="#b7a0fa"
        strokeWidth={3}
      />
      {pts.map((p, i) =>
        p ? (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={9}
            fill={
              p[0] >= 0 && p[1] >= 0 && p[0] < W && p[1] < H
                ? "#b7a0fa"
                : "#ff6b6b"
            }
          />
        ) : null,
      )}
    </svg>
  );
}

function IntrinsicsRows({
  est,
  std,
  truth,
  showTruth,
}: {
  est: Intrinsics;
  std?: number[];
  truth: Intrinsics;
  showTruth: boolean;
}) {
  const rows: [string, number, number, number][] = [
    ["fx", est.fx, truth.fx, 2],
    ["fy", est.fy, truth.fy, 2],
    ["cx", est.cx, truth.cx, 2],
    ["cy", est.cy, truth.cy, 2],
    ["k1", est.dist[0], truth.dist[0], 4],
    ["k2", est.dist[1], truth.dist[1], 4],
    ["p1", est.dist[2], truth.dist[2], 5],
    ["p2", est.dist[3], truth.dist[3], 5],
    ["k3", est.dist[4], truth.dist[4], 4],
  ];
  return (
    <table className="calib-table">
      <thead>
        <tr>
          <th>參數</th>
          <th>估計值</th>
          <th>± 標準差</th>
          {showTruth && <th>真值</th>}
          {showTruth && <th>誤差</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, e, t, d], i) => (
          <tr key={name}>
            <td>
              <M>
                {name
                  .replace(/(\d)$/, "_$1")
                  .replace(/^([fc])([xy])$/, "$1_$2")}
              </M>
            </td>
            <td>{fmt(e, d)}</td>
            <td>{std ? fmt(std[i], d) : "—"}</td>
            {showTruth && <td>{fmt(t, d)}</td>}
            {showTruth && <td>{fmt(e - t, d)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TASK_IDS = [
  "lab.atLeast3",
  "lab.sameFocus",
  "lab.atLeast10",
  "lab.coverage",
  "lab.directions",
  "lab.camRms",
  "lab.stereo",
  "lab.verify",
];

export default function LabPage({
  nav,
  initialStep,
  onTasks,
}: {
  nav?: ReactNode;
  initialStep?: string;
  onTasks?: (done: Record<string, boolean>) => void;
}) {
  const request = useLabWorker();
  const [step, setStep] = useState<Step>(() =>
    STEPS.some((s) => s.id === initialStep) ? (initialStep as Step) : "capture",
  );
  const [placement, setPlacement] = useState<BoardPlacement>(DEFAULT_PLACEMENT);
  const [settings, setSettings] = useState<CaptureSettings>(DEFAULT_SETTINGS);
  const [focusLocked, setFocusLocked] = useState(false);
  const [mode, setMode] = useState<"translate" | "rotate">("rotate");
  const [shots, setShots] = useState<Shot[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState(
    "正在載入 OpenCV.js（約 13 MB，只需一次）…",
  );
  const [busy, setBusy] = useState(true);
  const [flags, setFlags] = useState<CalibFlag[]>([]);
  const [camResult, setCamResult] = useState<{
    result: CameraCalibrationResult;
    keys: number[];
    focus: number[];
  } | null>(null);
  const [projResult, setProjResult] = useState<{
    result: ProjectorCalibrationResult;
    keys: number[];
  } | null>(null);
  const [showTruth, setShowTruth] = useState(false);
  const [error, setError] = useState("");
  const seed = useRef(100);

  useEffect(() => {
    request({ type: "load" })
      .then(() => setStatus("OpenCV.js 已就緒。"))
      .catch((e: Error) => setError(`OpenCV.js 載入失敗：${e.message}`))
      .finally(() => setBusy(false));
  }, [request]);

  const hints = useMemo(
    () =>
      hintsFor(
        placement,
        settings,
        shots.filter((s) => s.include),
      ),
    [placement, settings, shots],
  );
  const good = shots.filter((s) => s.include && s.capture.corners);
  const goodFocus = new Set(good.map((s) => s.settings.focusMm));
  const projGood = good.filter((s) => s.capture.projector?.every(Boolean));
  const cells = coverage(good.map((s) => s.capture.corners!));
  const directions = new Set(
    good.map((s) => tiltDirection(s.placement)).filter((d) => d >= 0),
  );

  const capture = async () => {
    setBusy(true);
    setError("");
    setStatus("拍照中：白光照片 → 找角點 → 投 24 張條紋 → 解相位…");
    try {
      const { capture } = await request({
        type: "capture",
        placement,
        settings,
        seed: seed.current++,
      });
      const key = seed.current;
      setShots((s) => [
        ...s,
        { key, placement, settings, capture, include: true },
      ]);
      setSelected(key);
      setStatus(
        capture.corners
          ? `第 ${shots.length + 1} 張：找到 ${BOARD.cols}×${BOARD.rows} 個角點，${capture.projector?.filter(Boolean).length ?? 0} 個角點解出 Projector 座標（${fmt((capture.ms.render + capture.ms.detect + capture.ms.fringes) / 1000, 1)} s）。`
          : `第 ${shots.length + 1} 張：找不到完整的棋盤格角點，這張不能用於校正。`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const randomPlacement = () => {
    const r = Math.random;
    for (let k = 0; k < 200; k++) {
      const p: BoardPlacement = {
        x: Math.round((r() * 2 - 1) * 70),
        y: Math.round((r() * 2 - 1) * 45),
        z: Math.round(460 + r() * 140),
        rx: Math.round((r() * 2 - 1) * 35),
        ry: Math.round((r() * 2 - 1) * 35),
        rz: Math.round((r() * 2 - 1) * 20),
      };
      const t = truthProjections(p, settings.focusMm);
      const ok = (q: Point2 | null, w: number, h: number) =>
        !!q && q[0] > 10 && q[1] > 10 && q[0] < w - 10 && q[1] < h - 10;
      if (
        t.camera.every((q) => ok(q, LAB_CAMERA.width, LAB_CAMERA.height)) &&
        t.projector.every((q) =>
          ok(q, LAB_PROJECTOR.width, LAB_PROJECTOR.height),
        )
      ) {
        setPlacement(p);
        return;
      }
    }
  };

  const runCamera = async () => {
    setBusy(true);
    setError("");
    setStatus("cv.calibrateCameraExtended 計算中…");
    try {
      const { result } = await request({
        type: "calibrate-camera",
        views: good.map((s) => s.capture.corners!),
        flags,
      });
      setCamResult({
        result,
        keys: good.map((s) => s.key),
        focus: good.map((s) => s.settings.focusMm),
      });
      setProjResult(null);
      setStatus(
        `Camera 校正完成：RMS = ${fmt(result.rms, 3)} px（${good.length} 張）。`,
      );
    } catch (e) {
      setError(`calibrateCamera 失敗：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const runProjector = async () => {
    if (!camResult) return;
    setBusy(true);
    setError("");
    setStatus("Projector：calibrateCameraExtended + stereoCalibrate 計算中…");
    try {
      const { result } = await request({
        type: "calibrate-projector",
        camera: camResult.result.K,
        cameraViews: projGood.map((s) => s.capture.corners!),
        projectorViews: projGood.map((s) => s.capture.projector as Point2[]),
        flags,
      });
      setProjResult({ result, keys: projGood.map((s) => s.key) });
      setStatus(
        `Projector 校正完成：Projector RMS = ${fmt(result.projector.rms, 3)} px，stereo RMS = ${result.stereo.ok ? fmt(result.stereo.rms, 3) : "—"} px。`,
      );
    } catch (e) {
      setError(`Projector 校正失敗：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const checks = useMemo(() => {
    if (!camResult || !projResult?.result.stereo.ok) return [];
    const { R, T } = projResult.result.stereo;
    return projGood.map((s) => ({
      shot: s,
      check: checkView(
        camResult.result.K,
        projResult.result.projector.K,
        R,
        T,
        s.capture.corners!,
        s.capture.projector!,
      ),
    }));
  }, [camResult, projResult, projGood]);
  const spacingErr = checks.length
    ? checks.reduce(
        (acc, c) =>
          acc + (c.check ? Math.abs(c.check.spacingMean - BOARD.square) : 0),
        0,
      ) / checks.length
    : NaN;

  const tasks: { done: boolean; text: string }[] = [
    {
      done: good.length >= 3,
      text: "至少 3 張成功偵測到角點（calibrateCamera 的最低需求）",
    },
    {
      done: good.length >= 3 && goodFocus.size === 1,
      text: `納入的照片都用同一個對焦距離（拍照前先鎖定對焦環${goodFocus.size > 1 ? `；目前混用 ${goodFocus.size} 種` : ""}）`,
    },
    { done: good.length >= 10, text: "至少 10 張成功的照片" },
    {
      done: cells.every(Boolean),
      text: `角點涵蓋影像九宮格${
        cells.every(Boolean)
          ? ""
          : `（缺：${cells
              .map((c, i) => (c ? "" : CELL_NAMES[i]))
              .filter(Boolean)
              .join("、")}）`
      }`,
    },
    {
      done: directions.size >= 3,
      text: `往至少 3 個不同方向傾斜 > 15°（目前 ${directions.size} 個方向）`,
    },
    {
      done: !!camResult && camResult.result.rms < 0.3,
      text: "Camera 校正 RMS < 0.3 px",
    },
    {
      done: !!projResult?.result.stereo.ok,
      text: "完成 Projector 校正（stereoCalibrate）",
    },
    {
      done: spacingErr < 0.05,
      text: "驗證：用估出的參數量格子，平均誤差 < 0.05 mm",
    },
  ];

  const taskKey = tasks.map((t) => (t.done ? 1 : 0)).join("");
  useEffect(() => {
    onTasks?.(
      Object.fromEntries(TASK_IDS.map((id, i) => [id, taskKey[i] === "1"])),
    );
  }, [taskKey, onTasks]);

  const sel = shots.find((s) => s.key === selected) ?? null;
  const camIndex = camResult && sel ? camResult.keys.indexOf(sel.key) : -1;
  const camFocus = camResult ? [...new Set(camResult.focus)] : [];
  const camTruth = cameraAt(camFocus[0] ?? settings.focusMm);
  const setP = (patch: Partial<BoardPlacement>) =>
    setPlacement((p) => ({ ...p, ...patch }));
  const setS = (patch: Partial<CaptureSettings>) =>
    setSettings((s) => ({ ...s, ...patch }));
  const estimatedProjector = useMemo(
    () =>
      projResult?.result.stereo.ok
        ? {
            K: projResult.result.projector.K,
            pose: {
              R: projResult.result.stereo.R,
              t: projResult.result.stereo.T,
            },
          }
        : null,
    [projResult],
  );
  const ghosts = useMemo(() => good.map((s) => s.placement), [good]);

  return (
    <div className="calib-shell lab-shell">
      <header className="calib-header">
        <div className="calib-brand">
          <Camera size={22} />
          <span>
            Calibration 3D 實驗室<small>Camera + Projector 校正（模擬）</small>
          </span>
        </div>
        <nav className="lab-steps" aria-label="實驗步驟">
          {STEPS.map((s) => (
            <button
              key={s.id}
              className={step === s.id ? "is-active" : ""}
              onClick={() => setStep(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        {nav}
      </header>

      <div className="lab-status" role="status">
        {busy && <span className="lab-spinner" />}
        {error ? <span className="lab-error">{error}</span> : status}
      </div>

      <div className="lab-layout">
        <section className="lab-left">
          <LabScene
            placement={placement}
            onPlacement={setPlacement}
            mode={mode}
            ghosts={ghosts}
            estimatedProjector={estimatedProjector}
          />
          <div className="lab-scene-tools">
            <span>拖曳板子上的控制器：</span>
            <button
              className={mode === "rotate" ? "is-active" : ""}
              onClick={() => setMode("rotate")}
            >
              旋轉
            </button>
            <button
              className={mode === "translate" ? "is-active" : ""}
              onClick={() => setMode("translate")}
            >
              移動
            </button>
            <span className="lab-legend">
              <i style={{ background: "#5ee4bd" }} /> Camera{" "}
              <i style={{ background: "#b7a0fa" }} /> Projector
              <i style={{ background: "#8fa3b8" }} /> 已拍姿態{" "}
              {estimatedProjector && (
                <>
                  <i style={{ background: "#ffd166" }} /> 估計的 Projector
                </>
              )}
            </span>
          </div>
          <div className="lab-strip" aria-label="已拍照片">
            {shots.length === 0 && (
              <p className="calib-note">還沒有照片。擺好板子後按「拍照」。</p>
            )}
            {shots.map((s, i) => (
              <div
                key={s.key}
                className={`lab-thumb ${selected === s.key ? "is-selected" : ""} ${s.include ? "" : "is-excluded"}`}
              >
                <button
                  onClick={() => setSelected(s.key)}
                  title={`第 ${i + 1} 張`}
                >
                  <GrayImage
                    data={s.capture.image}
                    width={s.capture.width}
                    height={s.capture.height}
                    label={`第 ${i + 1} 張`}
                  />
                  <span className={s.capture.corners ? "ok" : "bad"}>
                    {i + 1}{" "}
                    {s.capture.corners ? <Check size={12} /> : <X size={12} />}
                  </span>
                </button>
                <div className="lab-thumb-bar">
                  <label title="納入校正">
                    <input
                      type="checkbox"
                      checked={s.include}
                      onChange={(e) =>
                        setShots((all) =>
                          all.map((x) =>
                            x.key === s.key
                              ? { ...x, include: e.target.checked }
                              : x,
                          ),
                        )
                      }
                    />
                    納入
                  </label>
                  <button
                    className="lab-thumb-delete"
                    aria-label={`刪除第 ${i + 1} 張`}
                    title="刪除"
                    onClick={() =>
                      setShots((all) => all.filter((x) => x.key !== s.key))
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="lab-tasks">
            <strong>任務</strong>
            <ul>
              {tasks.map((t) => (
                <li key={t.text} className={t.done ? "done" : ""}>
                  {t.done ? <Check size={14} /> : <span className="lab-box" />}
                  {t.text}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lab-right">
          {step === "capture" && (
            <>
              <h3>相機取景器（即時預覽）</h3>
              <LivePreview
                placement={placement}
                settings={settings}
                shots={shots}
              />
              <p className="calib-note">
                綠點 = 已拍照片偵測到的角點；九宮格紅色 =
                還沒有角點的區域；紅色像素 = 過曝。
              </p>
              <div className="lab-hints">
                {hints.length === 0 ? (
                  <p className="lab-hint lab-hint-ok">
                    助教：這個姿態看起來沒問題，可以拍。
                  </p>
                ) : (
                  hints.map((h: Hint) => (
                    <p key={h.text} className={`lab-hint lab-hint-${h.level}`}>
                      助教：{h.text}
                    </p>
                  ))
                )}
              </div>
              <div className="lab-actions">
                <button
                  className="lab-primary"
                  onClick={capture}
                  disabled={busy}
                >
                  <Camera size={16} /> 拍照
                </button>
                <button onClick={randomPlacement}>
                  <Shuffle size={16} /> 隨機擺放
                </button>
                <button onClick={() => setPlacement(DEFAULT_PLACEMENT)}>
                  <RotateCcw size={16} /> 板子歸位
                </button>
              </div>
              <div className="lab-columns">
                <div>
                  <h4>板子姿態（Camera 座標）</h4>
                  <Slider
                    label="左右 x"
                    value={placement.x}
                    min={-150}
                    max={150}
                    step={1}
                    unit="mm"
                    onChange={(v) => setP({ x: v })}
                  />
                  <Slider
                    label="上下 y"
                    value={placement.y}
                    min={-120}
                    max={120}
                    step={1}
                    unit="mm"
                    onChange={(v) => setP({ y: v })}
                  />
                  <Slider
                    label="距離 z"
                    value={placement.z}
                    min={350}
                    max={800}
                    step={1}
                    unit="mm"
                    onChange={(v) => setP({ z: v })}
                  />
                  <Slider
                    label="繞 x 傾斜"
                    value={placement.rx}
                    min={-60}
                    max={60}
                    step={0.5}
                    unit="°"
                    onChange={(v) => setP({ rx: v })}
                  />
                  <Slider
                    label="繞 y 傾斜"
                    value={placement.ry}
                    min={-60}
                    max={60}
                    step={0.5}
                    unit="°"
                    onChange={(v) => setP({ ry: v })}
                  />
                  <Slider
                    label="板內旋轉"
                    value={placement.rz}
                    min={-180}
                    max={180}
                    step={0.5}
                    unit="°"
                    onChange={(v) => setP({ rz: v })}
                  />
                  <p className="calib-note">
                    傾角 {fmt(boardTilt(placement), 1)}°
                  </p>
                </div>
                <div>
                  <h4>相機設定</h4>
                  <Slider
                    label="曝光時間"
                    value={settings.exposureMs}
                    min={2}
                    max={40}
                    step={0.5}
                    unit="ms"
                    onChange={(v) => setS({ exposureMs: v })}
                  />
                  <Slider
                    label="光圈 f/"
                    value={settings.fNumber}
                    min={1.4}
                    max={16}
                    step={0.1}
                    onChange={(v) => setS({ fNumber: v })}
                  />
                  <Slider
                    label="對焦距離"
                    value={settings.focusMm}
                    min={300}
                    max={1000}
                    step={5}
                    unit="mm"
                    disabled={focusLocked}
                    onChange={(v) => setS({ focusMm: v })}
                  />
                  <label className="calib-check">
                    <input
                      type="checkbox"
                      checked={focusLocked}
                      onChange={(e) => setFocusLocked(e.target.checked)}
                    />
                    <span>
                      鎖定對焦環（目前 <M>{"f_x"}</M> 真值 ≈{" "}
                      {fmt(cameraAt(settings.focusMm).fx, 1)} px）
                    </span>
                  </label>
                  <Slider
                    label="環境光"
                    value={settings.ambient}
                    min={0}
                    max={0.6}
                    step={0.01}
                    onChange={(v) => setS({ ambient: v })}
                  />
                  <Slider
                    label="感測器讀出雜訊"
                    value={settings.noiseDN}
                    min={0}
                    max={8}
                    step={0.1}
                    unit="DN"
                    onChange={(v) => setS({ noiseDN: v })}
                  />
                  <h4>Projector 影像中的板子</h4>
                  <ProjectorCoverage placement={placement} />
                  <p className="calib-note">
                    紫點 = 角點落在 Projector 影像的位置（助教視角）；紅點 =
                    照不到。紫圈 = Projector 主點（offset 光學，靠近下緣）。
                  </p>
                </div>
              </div>
              {sel && (
                <>
                  <h4>選取的照片（第 {shots.indexOf(sel) + 1} 張）</h4>
                  <GrayImage
                    data={sel.capture.image}
                    width={sel.capture.width}
                    height={sel.capture.height}
                    label="選取的照片與偵測到的角點"
                    overlay={
                      sel.capture.corners && (
                        <CornerMarks points={sel.capture.corners} />
                      )
                    }
                  />
                  <p className="calib-note">
                    {sel.capture.corners
                      ? "綠圈 = 偵測到的角點（紅圈 = 第 1 個角點，也就是物體座標原點）。"
                      : "沒有找到完整的 9×6 角點：檢查是否有角點出畫面、過曝或太模糊。"}
                    {` 模糊 σ = ${fmt(sel.capture.blurSigma, 2)} px，過曝像素 ${fmt(sel.capture.saturated * 100, 2)}%。`}
                  </p>
                </>
              )}
              <details className="lab-code">
                <summary>對應的 OpenCV 程式</summary>
                <pre className="calib-code">
                  <code>{`gray = cv.cvtColor(img, cv.COLOR_BGR2GRAY)
ok, corners = cv.findChessboardCorners(gray, (9, 6), None)
if ok:
    corners = cv.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)
# 本頁：opencv.js 沒有這兩個函式，用同概念的 JS 實作
# （鞍點偵測 + 格線重建 + cornerSubPix 同演算法）`}</code>
                </pre>
              </details>
            </>
          )}

          {step === "camera" && (
            <>
              <h3>
                Camera 校正：<code>cv.calibrateCameraExtended</code>（真
                OpenCV）
              </h3>
              <p>
                使用 {good.length}{" "}
                張成功偵測的照片（左下方縮圖可勾選要不要納入）。物體座標：9×6
                個角點，間距 {BOARD.square} mm。
              </p>
              <fieldset className="lab-flags">
                <legend>flags</legend>
                {CALIB_FLAGS.map((f) => (
                  <label key={f}>
                    <input
                      type="checkbox"
                      checked={flags.includes(f)}
                      onChange={(e) =>
                        setFlags((fs) =>
                          e.target.checked
                            ? [...fs, f]
                            : fs.filter((x) => x !== f),
                        )
                      }
                    />
                    <code>{f}</code>
                  </label>
                ))}
              </fieldset>
              <div className="lab-actions">
                <button
                  className="lab-primary"
                  onClick={runCamera}
                  disabled={busy || good.length < 3}
                >
                  執行 calibrateCamera
                </button>
                <label className="calib-check">
                  <input
                    type="checkbox"
                    checked={showTruth}
                    onChange={(e) => setShowTruth(e.target.checked)}
                  />
                  <span>對答案（顯示真值）</span>
                </label>
              </div>
              {camResult && (
                <>
                  <div className="calib-metrics">
                    <div>
                      <span>RMS 重投影誤差</span>
                      <b>{fmt(camResult.result.rms, 3)} px</b>
                    </div>
                    <div>
                      <span>使用張數</span>
                      <b>{camResult.keys.length}</b>
                    </div>
                  </div>
                  {camFocus.length > 1 && (
                    <p className="lab-hint lab-hint-error">
                      這組照片混用了 {camFocus.length} 種對焦距離（
                      {camFocus
                        .map((f) => `${f} mm → fx ${fmt(cameraAt(f).fx, 1)} px`)
                        .join("、")}
                      ）。每種對焦其實是不同的 K，calibrateCamera
                      只能找一個折衷值：RMS
                      變大，參數也不對應任何一張。真值欄以第 1 張的對焦（
                      {camFocus[0]} mm）為準。
                    </p>
                  )}
                  <IntrinsicsRows
                    est={camResult.result.K}
                    std={camResult.result.stdIntrinsics}
                    truth={camTruth}
                    showTruth={showTruth}
                  />
                  <h4>每張照片的重投影誤差（點選查看）</h4>
                  <div className="lab-bars">
                    {camResult.keys.map((k, i) => {
                      const e = camResult.result.perViewErrors[i];
                      return (
                        <button
                          key={k}
                          className={selected === k ? "is-selected" : ""}
                          onClick={() => setSelected(k)}
                        >
                          <span>{shots.findIndex((s) => s.key === k) + 1}</span>
                          <i
                            style={{
                              width: `${Math.min(100, (e / 0.5) * 100)}%`,
                            }}
                            className={e > 0.3 ? "bad" : ""}
                          />
                          <b>{fmt(e, 3)}</b>
                        </button>
                      );
                    })}
                  </div>
                  {sel && camIndex >= 0 && (
                    <>
                      <GrayImage
                        data={sel.capture.image}
                        width={sel.capture.width}
                        height={sel.capture.height}
                        label="偵測角點與 projectPoints 重投影"
                        overlay={
                          <>
                            <CornerMarks points={sel.capture.corners!} />
                            <ErrorVectors
                              from={sel.capture.corners!}
                              to={camResult.result.reprojected[camIndex]}
                              gain={100}
                            />
                          </>
                        }
                      />
                      <p className="calib-note">
                        綠圈 = 偵測到的角點；紅線 ={" "}
                        <code>cv.projectPoints</code> 重投影位置的偏差
                        ×100。誤差線若呈系統性方向（例如全部往外），代表模型沒解釋到某種效應。
                      </p>
                      <PoseCompare
                        shot={sel}
                        est={camResult.result.poses[camIndex]}
                        showTruth={showTruth}
                      />
                      {showTruth && (
                        <p className="calib-note">
                          若估計與真值差了約 180°
                          的板內旋轉，是因為棋盤格的角點排序有歧義（第 1
                          個角點可能落在對角），OpenCV 也一樣；內參不受影響。
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
              <details className="lab-code" open>
                <summary>對應的 OpenCV 程式</summary>
                <pre className="calib-code">
                  <code>{`rms, K, dist, rvecs, tvecs, std_int, std_ext, per_view = \\
    cv.calibrateCameraExtended(objpoints, imgpoints, (1024, 768), None, None,
                               flags=${flags.length ? flags.map((f) => `cv.${f}`).join(" | ") : "0"})`}</code>
                </pre>
              </details>
              <ul className="lab-tips">
                <li>
                  試試勾選 <code>CALIB_FIX_K3</code>：k2、k3
                  在視角不大的鏡頭上高度相關，自由估計時常互相抵消、數值看起來很怪。
                </li>
                <li>
                  取消勾選某張誤差最大的照片再算一次，看 RMS 與參數怎麼變。
                </li>
                <li>只用 3 張、或只用正對的照片校正，再打開「對答案」比較。</li>
              </ul>
            </>
          )}

          {step === "projector" && (
            <>
              <h3>Projector 校正</h3>
              <p>
                拍照時已投了 2 方向 × 3 頻率（1、4、16 週期）× 4 步相移 = 24
                張條紋，解出每個 Camera 像素對應的 Projector 座標{" "}
                <M>{String.raw`(u_p, v_p)`}</M>，再用 <code>cv.remap</code>（真
                OpenCV）在角點的次像素位置取值。
              </p>
              {sel?.capture.phase && sel.capture.corners ? (
                <div className="lab-phase-grid">
                  <figure>
                    {sel.capture.fringe && (
                      <GrayImage
                        data={sel.capture.fringe}
                        width={sel.capture.width}
                        height={sel.capture.height}
                        label="條紋影像"
                      />
                    )}
                    <figcaption>垂直條紋（16 週期、δ = 0）</figcaption>
                  </figure>
                  <figure>
                    <PhaseMap
                      data={sel.capture.phase.up}
                      width={sel.capture.phase.width}
                      height={sel.capture.phase.height}
                      range={LAB_PROJECTOR.width}
                      label="u_p 圖"
                      overlay={
                        <CornerMarks
                          points={sel.capture.corners.map(
                            (p) => [p[0] / 4, p[1] / 4] as Point2,
                          )}
                          r={1.5}
                          color="#fff"
                        />
                      }
                    />
                    <figcaption>
                      解出的 <M>{"u_p"}</M>（0 → {LAB_PROJECTOR.width}）
                    </figcaption>
                  </figure>
                  <figure>
                    <PhaseMap
                      data={sel.capture.phase.vp}
                      width={sel.capture.phase.width}
                      height={sel.capture.phase.height}
                      range={LAB_PROJECTOR.height}
                      label="v_p 圖"
                      overlay={
                        <CornerMarks
                          points={sel.capture.corners.map(
                            (p) => [p[0] / 4, p[1] / 4] as Point2,
                          )}
                          r={1.5}
                          color="#fff"
                        />
                      }
                    />
                    <figcaption>
                      解出的 <M>{"v_p"}</M>（0 → {LAB_PROJECTOR.height}）
                    </figcaption>
                  </figure>
                  <figure>
                    <svg
                      className="lab-projector-view"
                      viewBox={`-40 -40 ${LAB_PROJECTOR.width + 80} ${LAB_PROJECTOR.height + 80}`}
                    >
                      <rect
                        x={0}
                        y={0}
                        width={LAB_PROJECTOR.width}
                        height={LAB_PROJECTOR.height}
                        fill="#151d27"
                        stroke="#b7a0fa"
                        strokeWidth={4}
                      />
                      <CornerMarks
                        points={sel.capture.projector ?? []}
                        color="#b7a0fa"
                        r={8}
                      />
                    </svg>
                    <figcaption>這張的「Projector 看到的角點」</figcaption>
                  </figure>
                </div>
              ) : (
                <p className="calib-note">
                  在左下方選一張成功偵測角點的照片，就能看到它的條紋與相位圖。
                </p>
              )}
              <div className="lab-actions">
                <button
                  className="lab-primary"
                  onClick={runProjector}
                  disabled={busy || !camResult || projGood.length < 3}
                >
                  執行 Projector 校正 + stereoCalibrate
                </button>
                <label className="calib-check">
                  <input
                    type="checkbox"
                    checked={showTruth}
                    onChange={(e) => setShowTruth(e.target.checked)}
                  />
                  <span>對答案（顯示真值）</span>
                </label>
              </div>
              {!camResult && (
                <p className="calib-note">
                  需要先完成「Camera 校正」：stereoCalibrate 會固定 Camera
                  內參。
                </p>
              )}
              <p className="calib-note">
                可用張數：{projGood.length}（全部 54 個角點都有 Projector
                座標的照片）。
              </p>
              {projResult && (
                <>
                  <h4>
                    Projector 內參（<code>cv.calibrateCameraExtended</code>）
                  </h4>
                  <div className="calib-metrics">
                    <div>
                      <span>Projector RMS</span>
                      <b>{fmt(projResult.result.projector.rms, 3)} px</b>
                    </div>
                  </div>
                  <IntrinsicsRows
                    est={projResult.result.projector.K}
                    std={projResult.result.projector.stdIntrinsics}
                    truth={LAB_PROJECTOR}
                    showTruth={showTruth}
                  />
                  <h4>
                    Camera → Projector 外參（stereoCalibrate，JS
                    實作，CALIB_FIX_INTRINSIC）
                  </h4>
                  {projResult.result.stereo.ok ? (
                    <StereoTable
                      stereo={projResult.result.stereo}
                      showTruth={showTruth}
                    />
                  ) : (
                    <p className="lab-error">
                      {projResult.result.stereo.reason}
                    </p>
                  )}
                </>
              )}
              <details className="lab-code" open>
                <summary>對應的 OpenCV 程式</summary>
                <pre className="calib-code">
                  <code>{`up = cv.remap(Up, mx, my, cv.INTER_LINEAR)   # Up: 解出的 u_p 圖
vp = cv.remap(Vp, mx, my, cv.INTER_LINEAR)
rms_p, Kp, dist_p, *_ = cv.calibrateCameraExtended(objpoints, projpoints, (1024, 768), None, None)
rms_s, _, _, _, _, R, T, E, F = cv.stereoCalibrate(
    objpoints, imgpoints, projpoints, K, dist, Kp, dist_p, (1024, 768),
    flags=cv.CALIB_FIX_INTRINSIC)   # opencv.js 沒有 stereoCalibrate → 本頁用 JS 實作`}</code>
                </pre>
              </details>
            </>
          )}

          {step === "verify" && (
            <>
              <h3>驗證：把校正板當量規</h3>
              <p>
                用估出的 Camera、Projector 內參與 <M>{"R, T"}</M>，對每張照片的
                54 個角點做三角量測（Camera 角點 ↔ 解相位得到的 Projector
                座標），量相鄰角點的距離。格子真實大小是 {BOARD.square} mm。
              </p>
              {checks.length === 0 ? (
                <p className="calib-note">
                  先完成「Camera 校正」與「Projector 校正」。
                </p>
              ) : (
                <>
                  <div className="calib-metrics">
                    <div>
                      <span>平均格距誤差</span>
                      <b className={spacingErr > 0.05 ? "bad" : ""}>
                        {fmt(spacingErr, 4)} mm
                      </b>
                    </div>
                  </div>
                  <table className="calib-table">
                    <thead>
                      <tr>
                        <th>照片</th>
                        <th>格距平均 (mm)</th>
                        <th>格距標準差</th>
                        <th>平面度 RMS (mm)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {checks.map(({ shot, check }) => (
                        <tr key={shot.key}>
                          <td>{shots.indexOf(shot) + 1}</td>
                          <td>{check ? fmt(check.spacingMean, 4) : "—"}</td>
                          <td>{check ? fmt(check.spacingStd, 4) : "—"}</td>
                          <td>{check ? fmt(check.flatness, 4) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="calib-note">
                    注意：這些是校正用過的照片（in-sample）。更嚴格的做法是另外拍幾張「不參與校正」的照片來驗證：拍完後在縮圖取消勾選再重新校正即可。
                  </p>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function PoseCompare({
  shot,
  est,
  showTruth,
}: {
  shot: Shot;
  est: { R: number[][]; t: number[] };
  showTruth: boolean;
}) {
  const truth = placementPose(shot.placement);
  const r = rotationToVector(est.R).map(deg);
  return (
    <table className="calib-table">
      <thead>
        <tr>
          <th>這張的外參（板子 → Camera）</th>
          <th>rvec（角度表示）</th>
          <th>tvec (mm)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>估計</td>
          <td>[{r.map((v) => fmt(v, 2)).join(", ")}]°</td>
          <td>[{est.t.map((v) => fmt(v, 2)).join(", ")}]</td>
        </tr>
        {showTruth && (
          <tr>
            <td>真值</td>
            <td>
              [
              {rotationToVector(truth.R)
                .map(deg)
                .map((v) => fmt(v, 2))
                .join(", ")}
              ]°
            </td>
            <td>[{truth.t.map((v) => fmt(v, 2)).join(", ")}]</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function StereoTable({
  stereo,
  showTruth,
}: {
  stereo: Extract<ProjectorCalibrationResult["stereo"], { ok: true }>;
  showTruth: boolean;
}) {
  const r = rotationToVector(stereo.R).map(deg);
  return (
    <>
      <div className="calib-metrics">
        <div>
          <span>stereo RMS</span>
          <b>{fmt(stereo.rms, 3)} px</b>
        </div>
        <div>
          <span>Baseline |T|</span>
          <b>{fmt(norm3(stereo.T), 2)} mm</b>
        </div>
        <div>
          <span>各張單獨估的分散</span>
          <b>
            {fmt(stereo.spreadDeg, 3)}° / {fmt(stereo.spreadMm, 2)} mm
          </b>
        </div>
        {showTruth && (
          <>
            <div>
              <span>R 誤差</span>
              <b>{fmt(rotationAngleDeg(stereo.R, LAB_STEREO.R), 3)}°</b>
            </div>
            <div>
              <span>T 誤差</span>
              <b>{fmt(norm3(sub3(stereo.T, LAB_STEREO.t)), 3)} mm</b>
            </div>
          </>
        )}
      </div>
      <table className="calib-table">
        <tbody>
          <tr>
            <td>rvec（估計）</td>
            <td>[{r.map((v) => fmt(v, 3)).join(", ")}]°</td>
          </tr>
          <tr>
            <td>T（估計）</td>
            <td>[{stereo.T.map((v) => fmt(v, 2)).join(", ")}] mm</td>
          </tr>
          {showTruth && (
            <>
              <tr>
                <td>rvec（真值）</td>
                <td>
                  [
                  {rotationToVector(LAB_STEREO.R)
                    .map(deg)
                    .map((v) => fmt(v, 3))
                    .join(", ")}
                  ]°
                </td>
              </tr>
              <tr>
                <td>T（真值）</td>
                <td>[{LAB_STEREO.t.map((v) => fmt(v, 2)).join(", ")}] mm</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </>
  );
}
