import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { RotateCcw } from "lucide-react";
import * as THREE from "three";
import {
  createWorld,
  LEGACY_UNIT_MM,
  type WorldConfig,
  type WorldScan,
} from "./scanner";
import { analyzeScan, FAILURE_CAUSES, type ScanAnalysis } from "./analysis";
import { PCB_PINS, SURFACE } from "./pcb";
import { createViewControls } from "./viewControls";
import { InfoButton, InfoHeading } from "./Info";

type ColorMode = "error" | "height" | "surface";
const SURFACE_COLORS = ["#5bbdcd", "#7d8a99", "#b7a0fa", "#ffcf6e", "#e0e6ee"];
const mm = (v: number) => v.toFixed(v < 10 ? 3 : 1);
/** Scene data are in mm; the view keeps its original scale of 25 mm per display unit. */
const DISPLAY = 1 / LEGACY_UNIT_MM;
const STATUS = {
  success: ["成功", "ok"],
  partial: ["部分", "warn"],
  failed: ["失敗", "bad"],
  hidden: ["看不到", "muted"],
} as const;

function PointCloudView({
  scan,
  config,
  analysis,
  colorMode,
  showGround,
  showTruth,
  resetRef,
}: {
  scan: WorldScan;
  config: WorldConfig;
  analysis: ScanAnalysis;
  colorMode: ColorMode;
  showGround: boolean;
  showTruth: boolean;
  resetRef: MutableRefObject<(() => void) | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError("此裝置無法建立 WebGL，無法顯示 3D 點雲；右側統計仍可使用。");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(parent.clientWidth, parent.clientHeight);
    const canvas = renderer.domElement;
    canvas.dataset.testid = "analysis-canvas";
    canvas.setAttribute(
      "aria-label",
      "重建點雲；按住滑鼠中鍵旋轉視角，右鍵平移，滾輪縮放；WASD 移動視角，Q/E 轉向，R 重設",
    );
    parent.append(canvas);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c1726");
    const viewer = new THREE.PerspectiveCamera(
      45,
      parent.clientWidth / Math.max(1, parent.clientHeight),
      0.01,
      100,
    );
    const grid = new THREE.GridHelper(12, 48, "#3e5870", "#1d2e3f");
    scene.add(grid);
    const root = new THREE.Group();
    root.scale.setScalar(DISPLAY);
    scene.add(root);

    const positions: number[] = [],
      colors: number[] = [];
    const color = new THREE.Color();
    const { capture, reconstruction } = scan;
    const range = analysis.histogram.range;
    for (let i = 0; i < reconstruction.valid.length; i++) {
      if (!reconstruction.valid[i]) continue;
      if (!showGround && capture.surface[i] === SURFACE.ground) continue;
      const p = reconstruction.points.subarray(3 * i, 3 * i + 3);
      positions.push(p[0], p[1], p[2]);
      if (colorMode === "surface")
        color.set(SURFACE_COLORS[capture.surface[i]] ?? "#ffffff");
      else if (colorMode === "height")
        color.setHSL(
          0.66 - Math.min(1, Math.max(0, (p[1] * DISPLAY) / 2.5)) * 0.66,
          0.8,
          0.55,
        );
      else {
        const t = Math.max(-1, Math.min(1, analysis.errors[i] / range));
        color.setRGB(
          (128 + 127 * t) / 255,
          (128 - 90 * Math.abs(t)) / 255,
          (128 - 127 * t) / 255,
        );
      }
      colors.push(color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: Math.max(0.006, 1.6 / scan.capture.width),
        vertexColors: true,
      }),
    );
    root.add(points);

    const world = createWorld(config);
    const truthMaterial = new THREE.MeshBasicMaterial({
      color: "#9fc4dd",
      wireframe: true,
      transparent: true,
      opacity: 0.22,
    });
    const truth = new THREE.Mesh(world.object.geometry, truthMaterial);
    truth.matrixAutoUpdate = false;
    truth.matrix.copy(world.object.matrixWorld);
    truth.visible = showTruth;
    root.add(truth);

    const sphere = geometry.boundingSphere;
    const center =
      sphere && sphere.radius > 0
        ? sphere.center.clone().multiplyScalar(DISPLAY)
        : new THREE.Vector3(config.x, config.y, config.z).multiplyScalar(
            DISPLAY,
          );
    const radius =
      sphere && sphere.radius > 0 ? Math.min(sphere.radius * DISPLAY, 4) : 1.5;
    const view = createViewControls(viewer, canvas, {
      home: (orbit) => {
        orbit.target.copy(center);
        viewer.position
          .copy(center)
          .add(new THREE.Vector3(1.1, 1.3, 1.6).multiplyScalar(radius * 1.6));
      },
      minDistance: radius * 0.2,
    });
    view.reset();

    const render = () => renderer.render(scene, viewer);
    view.orbit.addEventListener("change", render);
    resetRef.current = () => {
      view.reset();
      render();
    };
    const observer = new ResizeObserver(() => {
      if (!parent.clientWidth || !parent.clientHeight) return;
      renderer.setSize(parent.clientWidth, parent.clientHeight);
      viewer.aspect = parent.clientWidth / parent.clientHeight;
      viewer.updateProjectionMatrix();
      render();
    });
    observer.observe(parent);
    render();
    return () => {
      observer.disconnect();
      resetRef.current = null;
      view.dispose();
      geometry.dispose();
      (points.material as THREE.Material).dispose();
      truthMaterial.dispose();
      world.dispose();
      grid.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [scan, config, analysis, colorMode, showGround, showTruth, resetRef]);
  return (
    <div className="analysis-view" ref={host}>
      {error && (
        <div className="sandbox-gpu-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function Histogram({ analysis }: { analysis: ScanAnalysis }) {
  const { counts, range } = analysis.histogram;
  const peak = Math.max(1, ...counts);
  const w = 320,
    h = 110;
  const bar = w / counts.length;
  const tol = (analysis.tolerance / range) * (w / 2);
  return (
    <svg
      className="analysis-histogram"
      viewBox={`0 0 ${w} ${h + 22}`}
      role="img"
      aria-label="有號深度誤差直方圖"
    >
      <rect
        x={w / 2 - tol}
        y={0}
        width={2 * tol}
        height={h}
        className="tolerance"
      />
      {counts.map((c, i) => (
        <rect
          key={i}
          x={i * bar + 1}
          y={h - (c / peak) * h}
          width={bar - 2}
          height={(c / peak) * h}
          className={
            Math.abs((i + 0.5) / counts.length - 0.5) * 2 * range <=
            analysis.tolerance
              ? "inside"
              : "outside"
          }
        />
      ))}
      <line x1={w / 2} x2={w / 2} y1={0} y2={h} className="zero" />
      <text x={0} y={h + 16}>
        −{mm(range)}
      </text>
      <text x={w / 2} y={h + 16} textAnchor="middle">
        0 mm
      </text>
      <text x={w} y={h + 16} textAnchor="end">
        +{mm(range)}
      </text>
    </svg>
  );
}

export default function PointCloudPage({
  scan,
  config,
  stale,
}: {
  scan: WorldScan | null;
  config: WorldConfig;
  stale: boolean;
}) {
  const [toleranceMm, setToleranceMm] = useState(0.125),
    [colorMode, setColorMode] = useState<ColorMode>("error"),
    [showGround, setShowGround] = useState(false),
    [showTruth, setShowTruth] = useState(true);
  const resetView = useRef<(() => void) | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const isPcb = config.shape === "pcb";
  const analysis = useMemo(
    () =>
      scan ? analyzeScan(scan, toleranceMm, isPcb ? PCB_PINS : null) : null,
    [scan, toleranceMm, isPcb],
  );
  if (!scan || !analysis)
    return (
      <div className="analysis-page">
        <div className="sandbox-no-result">正在產生第一組掃描結果…</div>
      </div>
    );
  const total = scan.metrics.totalCount;
  const o = analysis.overall;
  const pinTally = analysis.pins
    ? (["success", "partial", "failed", "hidden"] as const).map(
        (s) =>
          [s, analysis.pins!.filter((p) => p.status === s).length] as const,
      )
    : null;
  return (
    <div className={`analysis-page ${stale ? "stale" : ""}`}>
      <section className="analysis-viewport" aria-label="重建點雲">
        <PointCloudView
          scan={scan}
          config={config}
          analysis={analysis}
          colorMode={colorMode}
          showGround={showGround}
          showTruth={showTruth}
          resetRef={resetView}
        />
        <div className="sandbox-overlay sandbox-overlay-top">
          <div className="analysis-legend">
            {colorMode === "error" ? (
              <>
                <span className="swatch near" />
                偏近
                <span className="swatch zero" />
                0
                <span className="swatch far" />
                偏遠（±{mm(analysis.histogram.range)} mm）
              </>
            ) : colorMode === "surface" ? (
              ["物體", "地面", "晶片", "引腳"].map((name, i) => (
                <span key={name}>
                  <span
                    className="swatch"
                    style={{ background: SURFACE_COLORS[i] }}
                  />
                  {name}
                </span>
              ))
            ) : (
              <>藍 → 紅：低 → 高</>
            )}
          </div>
          <div className="sandbox-view-buttons">
            <label>
              著色
              <select
                aria-label="點雲著色方式"
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value as ColorMode)}
              >
                <option value="error">深度誤差</option>
                <option value="height">高度</option>
                <option value="surface">表面類別</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={showTruth}
                onChange={(e) => setShowTruth(e.target.checked)}
              />
              真實表面
            </label>
            <label>
              <input
                type="checkbox"
                checked={showGround}
                onChange={(e) => setShowGround(e.target.checked)}
              />
              地面點
            </label>
            <button onClick={() => resetView.current?.()}>
              <RotateCcw size={15} />
              重設視角
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
            <span>中鍵：旋轉</span>
            <span>右鍵：平移</span>
            <span>滾輪：縮放</span>
            <span>WASD／Q E：移動、轉向</span>
            <span>R：重設視角</span>
          </div>
        )}
        {stale && (
          <p className="analysis-stale" role="status">
            場景已改，以下是上一組掃描；重掃完成後自動更新。
          </p>
        )}
      </section>
      <aside className="analysis-panel" aria-label="誤差統計">
        <section>
          <InfoHeading title="誤差摘要" level={2}>
            <p>
              誤差 = 重建 Camera Z − 真值 Camera Z。真值只用於評估，不參與重建。
            </p>
          </InfoHeading>
          <dl className="analysis-stats" data-testid="analysis-stats">
            <div>
              <dt>有效點</dt>
              <dd>
                {scan.metrics.validCount}
                <small> / {total}</small>
              </dd>
            </div>
            <div>
              <dt>容差內</dt>
              <dd data-testid="analysis-accurate">
                {analysis.accurate}
                <small>
                  {" "}
                  ({((analysis.accurate / total) * 100).toFixed(1)}%)
                </small>
              </dd>
            </div>
            {(
              [
                ["RMSE", o?.rmse],
                ["MAE", o?.mae],
                ["偏差（平均）", o?.bias],
                ["中位數 |e|", o?.median],
                ["P95 |e|", o?.p95],
                ["最大 |e|", o?.max],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value == null ? "N/A" : `${mm(value)} mm`}</dd>
              </div>
            ))}
          </dl>
          <label className="sandbox-inline-field">
            容差（mm）
            <input
              type="number"
              aria-label="誤差容差 mm"
              min={0.001}
              max={10}
              step={0.025}
              value={toleranceMm}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) setToleranceMm(v);
              }}
            />
          </label>
        </section>
        <section>
          <InfoHeading title="誤差分布" level={2}>
            <p>綠底＝容差範圍；超出範圍的點併入兩端。</p>
          </InfoHeading>
          <Histogram analysis={analysis} />
        </section>
        <section>
          <h2>依表面</h2>
          <table className="analysis-table">
            <thead>
              <tr>
                <th>表面</th>
                <th>可見</th>
                <th>有效</th>
                <th>容差內</th>
                <th>RMSE</th>
              </tr>
            </thead>
            <tbody>
              {analysis.bySurface.map((r) => (
                <tr key={r.surface}>
                  <td>{r.name}</td>
                  <td>{r.visible}</td>
                  <td>{r.valid}</td>
                  <td>{r.accurate}</td>
                  <td>{r.stats ? `${mm(r.stats.rmse)} mm` : "N/A"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2>失效像素原因</h2>
          <ul className="analysis-causes">
            {FAILURE_CAUSES.map(([key, label]) => (
              <li key={key}>
                <span>{label}</span>
                <span
                  className="bar"
                  style={{
                    width: `${(analysis.causes[key] / total) * 100}%`,
                  }}
                />
                <b>{analysis.causes[key]}</b>
              </li>
            ))}
          </ul>
        </section>
        {analysis.pins && pinTally && (
          <section data-testid="analysis-pins">
            <InfoHeading title="PCB 引腳重建" level={2}>
              <p>
                成功＝可見像素中至少一半在容差內；部分＝有但不到一半；失敗＝看得到但沒有準確點；看不到＝Camera
                視線被擋或在畫面外。
              </p>
            </InfoHeading>
            <div className="analysis-pin-tally">
              {pinTally.map(([s, n]) => (
                <span key={s} className={`status ${STATUS[s][1]}`}>
                  {STATUS[s][0]} {n}
                </span>
              ))}
            </div>
            <table className="analysis-table">
              <thead>
                <tr>
                  <th>引腳</th>
                  <th>可見</th>
                  <th>有效</th>
                  <th>容差內</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {analysis.pins.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td>{p.visible}</td>
                    <td>{p.valid}</td>
                    <td>{p.accurate}</td>
                    <td>
                      <span className={`status ${STATUS[p.status][1]}`}>
                        {STATUS[p.status][0]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </aside>
    </div>
  );
}
