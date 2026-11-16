import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import CalibScene, { type SceneObject } from "./CalibScene";
import {
  applyPose,
  poseCenter,
  project,
  type Intrinsics,
  type Point2,
  type Pose,
} from "./camera";
import {
  norm3,
  rotationAngleDeg,
  rotationToVector,
  sub3,
  type Vec3,
} from "./linalg";
import { M } from "./Tex";
import {
  BOARD_COLS,
  BOARD_ROWS,
  DEFAULT_LAB,
  DEFAULT_REGISTRATION,
  MARKERS,
  SCANNERS,
  SCENE,
  TRUE_CAMERA,
  TRUE_PROJECTOR,
  TRUE_SQUARE_MM,
  TRUE_STEREO,
  runCalibrationLab,
  runRegistrationLab,
  type CalibrationLab,
  type CalibrationLabConfig,
  type RegistrationConfig,
  type RegistrationMethod,
} from "./simulate";

const fmt = (v: number, digits = 2) =>
  Number.isFinite(v) ? v.toFixed(digits) : "—";
const deg = (v: number) => (v * 180) / Math.PI;
const IDENTITY: Pose = {
  R: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  t: [0, 0, 0],
};
const COLORS = {
  truth: "#6b7a8c",
  camera: "#5ee4bd",
  projector: "#b7a0fa",
  selected: "#ffd166",
  a: "#6cb6ff",
  b: "#ffa657",
};

export function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="calib-slider">
      <span>
        {label}
        <b>
          {value}
          {unit && <small> {unit}</small>}
        </b>
      </span>
      <input
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

function Tasks({ children }: { children: ReactNode }) {
  return (
    <div className="calib-tasks">
      <strong>試試看</strong>
      <ol>{children}</ol>
    </div>
  );
}

/** Camera image with detected corners, reprojections and exaggerated residuals. */
function ImagePlot({
  K,
  observed,
  reprojected,
  exaggerate,
  principal,
}: {
  K: Intrinsics;
  observed: Point2[];
  reprojected: (Point2 | null)[] | null;
  exaggerate: number;
  principal: { truth: Point2; estimate: Point2 | null };
}) {
  const grid: Point2[][] = [];
  for (let j = 0; j < BOARD_ROWS; j++)
    grid.push(observed.slice(j * BOARD_COLS, (j + 1) * BOARD_COLS));
  for (let i = 0; i < BOARD_COLS; i++)
    grid.push(
      Array.from(
        { length: BOARD_ROWS },
        (_, j) => observed[j * BOARD_COLS + i],
      ),
    );
  const r = K.width / 160;
  return (
    <svg
      className="calib-image"
      viewBox={`-10 -10 ${K.width + 20} ${K.height + 20}`}
      role="img"
      aria-label="影像上的角點與重投影"
    >
      <rect
        x={0}
        y={0}
        width={K.width}
        height={K.height}
        className="calib-image-frame"
      />
      {grid.map((line, i) => (
        <polyline
          key={i}
          points={line.map((p) => p.join(",")).join(" ")}
          className="calib-image-grid"
        />
      ))}
      {reprojected?.map((p, i) =>
        p ? (
          <line
            key={i}
            x1={observed[i][0]}
            y1={observed[i][1]}
            x2={observed[i][0] + (p[0] - observed[i][0]) * exaggerate}
            y2={observed[i][1] + (p[1] - observed[i][1]) * exaggerate}
            className="calib-image-error"
          />
        ) : null,
      )}
      {observed.map((p, i) => (
        <circle
          key={i}
          cx={p[0]}
          cy={p[1]}
          r={r}
          className="calib-image-corner"
        />
      ))}
      <g className="calib-image-pp-truth">
        <line
          x1={principal.truth[0] - 3 * r}
          x2={principal.truth[0] + 3 * r}
          y1={principal.truth[1]}
          y2={principal.truth[1]}
        />
        <line
          y1={principal.truth[1] - 3 * r}
          y2={principal.truth[1] + 3 * r}
          x1={principal.truth[0]}
          x2={principal.truth[0]}
        />
      </g>
      {principal.estimate && (
        <circle
          cx={principal.estimate[0]}
          cy={principal.estimate[1]}
          r={2.5 * r}
          className="calib-image-pp-est"
        />
      )}
    </svg>
  );
}

const boardOutline = (pose: Pose, square: number): Vec3[] => {
  const w = (BOARD_COLS - 1) * square,
    h = (BOARD_ROWS - 1) * square;
  return (
    [
      [0, 0, 0],
      [w, 0, 0],
      [w, h, 0],
      [0, h, 0],
    ] as Vec3[]
  ).map((p) => applyPose(pose, p));
};

function errorColors(errors: number[], max: number): Float32Array {
  const out = new Float32Array(errors.length * 3);
  errors.forEach((e, i) => {
    const t = Math.min(1, e / max);
    // mint → yellow → red
    const c =
      t < 0.5
        ? [
            0.37 + (1 - 0.37) * t * 2,
            0.89 + (0.82 - 0.89) * t * 2,
            0.74 - 0.34 * t * 2,
          ]
        : [1, 0.82 - 0.6 * (t - 0.5) * 2, 0.4 - 0.2 * (t - 0.5) * 2];
    out.set(c, i * 3);
  });
  return out;
}

function IntrinsicsTable({
  truth,
  lab,
  which,
}: {
  truth: Intrinsics;
  lab: CalibrationLab;
  which: "camera" | "projector";
}) {
  const result = lab[which];
  const rows: [string, number, number | null, number | null, number][] = [
    [
      "fx",
      truth.fx,
      result.ok ? result.initial.fx : null,
      result.ok ? result.K.fx : null,
      1,
    ],
    [
      "fy",
      truth.fy,
      result.ok ? result.initial.fy : null,
      result.ok ? result.K.fy : null,
      1,
    ],
    [
      "cx",
      truth.cx,
      result.ok ? result.initial.cx : null,
      result.ok ? result.K.cx : null,
      1,
    ],
    [
      "cy",
      truth.cy,
      result.ok ? result.initial.cy : null,
      result.ok ? result.K.cy : null,
      1,
    ],
    ...(["k1", "k2", "p1", "p2"] as const).map(
      (name, i): [string, number, number | null, number | null, number] => [
        name,
        truth.dist[i],
        null,
        result.ok ? result.K.dist[i] : null,
        4,
      ],
    ),
  ];
  return (
    <table className="calib-table">
      <thead>
        <tr>
          <th>參數</th>
          <th>真值</th>
          <th>Zhang 初值</th>
          <th>最佳化後</th>
          <th>誤差</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, t, init, est, d]) => (
          <tr key={name}>
            <td>{name}</td>
            <td>{fmt(t, d === 1 ? 1 : 4)}</td>
            <td>{init === null ? "—" : fmt(init, 1)}</td>
            <td>{est === null ? "—" : fmt(est, d === 1 ? 1 : 4)}</td>
            <td
              className={
                est !== null && Math.abs(est - t) > (d === 1 ? 3 : 0.01)
                  ? "bad"
                  : ""
              }
            >
              {est === null ? "—" : fmt(est - t, d === 1 ? 2 : 4)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PoseReadout({ label, pose }: { label: string; pose: Pose }) {
  const r = rotationToVector(pose.R).map(deg);
  const C = poseCenter(pose);
  return (
    <tr>
      <td>{label}</td>
      <td>[{r.map((v) => fmt(v, 1)).join(", ")}]°</td>
      <td>[{pose.t.map((v) => fmt(v, 1)).join(", ")}]</td>
      <td>[{C.map((v) => fmt(v, 1)).join(", ")}]</td>
    </tr>
  );
}

export function CalibrationLabView() {
  const [config, setConfig] = useState<CalibrationLabConfig>(DEFAULT_LAB);
  const [view, setView] = useState(0);
  const deferred = useDeferredValue(config);
  const stale = deferred !== config;
  const outcome = useMemo(() => {
    try {
      return { lab: runCalibrationLab(deferred), error: "" };
    } catch (e) {
      return { lab: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [deferred]);
  const set = (patch: Partial<CalibrationLabConfig>) =>
    setConfig((c) => ({ ...c, ...patch }));
  const lab = outcome.lab;
  const v = lab ? Math.min(view, lab.truePoses.length - 1) : 0;

  const cameraObjects = useMemo((): SceneObject[] => {
    if (!lab) return [];
    const objs: SceneObject[] = [
      {
        kind: "frustum",
        pose: IDENTITY,
        K: lab.trueCamera,
        color: COLORS.camera,
        depth: 140,
      },
    ];
    lab.truePoses.forEach((p, i) =>
      objs.push({
        kind: "line",
        points: boardOutline(p, TRUE_SQUARE_MM),
        color: i === v ? COLORS.selected : COLORS.truth,
        closed: true,
        dashed: true,
      }),
    );
    if (lab.camera.ok)
      lab.camera.poses.forEach((p, i) =>
        objs.push({
          kind: "line",
          points: boardOutline(p, lab.config.declaredSquare),
          color: i === v ? COLORS.selected : COLORS.camera,
          closed: true,
        }),
      );
    return objs;
  }, [lab, v]);

  const scanObjects = useMemo((): SceneObject[] => {
    if (!lab?.scan || !lab.stereo?.ok || !lab.projector.ok) return [];
    const errs: number[] = [],
      pts: Vec3[] = [];
    lab.scan.estimated.forEach((p, i) => {
      if (!p) return;
      pts.push(p);
      errs.push(norm3(sub3(p, lab.scan!.truth[i])));
    });
    return [
      {
        kind: "frustum",
        pose: IDENTITY,
        K: lab.trueCamera,
        color: COLORS.camera,
        depth: 120,
      },
      {
        kind: "frustum",
        pose: TRUE_STEREO,
        K: TRUE_PROJECTOR,
        color: COLORS.truth,
        depth: 120,
        dashed: true,
      },
      {
        kind: "frustum",
        pose: { R: lab.stereo.R, t: lab.stereo.T },
        K: lab.projector.K,
        color: COLORS.projector,
        depth: 120,
      },
      { kind: "points", points: pts, color: errorColors(errs, 2), size: 2.5 },
    ];
  }, [lab]);

  const reprojected = useMemo(() => {
    if (!lab?.camera.ok) return null;
    const { K, poses } = lab.camera;
    return lab.objectPoints.map((X) => project(K, poses[v], X));
  }, [lab, v]);

  return (
    <div className={`calib-lab ${stale ? "is-stale" : ""}`}>
      <div className="calib-controls">
        <Slider
          label="姿態數（張數）"
          value={config.views}
          min={2}
          max={25}
          step={1}
          onChange={(x) => set({ views: x })}
        />
        <Slider
          label="最大傾角"
          value={config.maxTilt}
          min={0}
          max={55}
          step={1}
          unit="°"
          onChange={(x) => set({ maxTilt: x })}
        />
        <Slider
          label="角點偵測雜訊 σ"
          value={config.cornerNoise}
          min={0}
          max={1}
          step={0.05}
          unit="px"
          onChange={(x) => set({ cornerNoise: x })}
        />
        <Slider
          label="鏡頭真實 k1"
          value={config.k1}
          min={-0.4}
          max={0.2}
          step={0.01}
          onChange={(x) => set({ k1: x })}
        />
        <Slider
          label="程式裡填的格子大小"
          value={config.declaredSquare}
          min={15}
          max={25}
          step={0.5}
          unit="mm"
          onChange={(x) => set({ declaredSquare: x })}
        />
        <Slider
          label="Projector 對應雜訊 σ"
          value={config.projectorNoise}
          min={0}
          max={1}
          step={0.05}
          unit="px"
          onChange={(x) => set({ projectorNoise: x })}
        />
        <Slider
          label="Seed"
          value={config.seed}
          min={1}
          max={50}
          step={1}
          onChange={(x) => set({ seed: x })}
        />
        <label className="calib-check">
          <input
            type="checkbox"
            checked={config.estimateDistortion}
            onChange={(e) => set({ estimateDistortion: e.target.checked })}
          />
          <span>
            估計畸變（取消 = <code>CALIB_FIX_K1|K2|ZERO_TANGENT_DIST</code>）
          </span>
        </label>
        <button className="calib-reset" onClick={() => setConfig(DEFAULT_LAB)}>
          回到預設
        </button>
        <p className="calib-note">
          真實格子大小固定 20 mm；k3 固定 0（<code>CALIB_FIX_K3</code>
          ）。角點直接用「真實投影 + 雜訊」，不做影像偵測。
        </p>
      </div>

      {!lab ? (
        <p className="calib-error">{outcome.error}</p>
      ) : (
        <div className="calib-results">
          <h4>
            A. Camera：<code>cv.calibrateCamera</code>
          </h4>
          {!lab.camera.ok ? (
            <p className="calib-error">失敗：{lab.camera.reason}</p>
          ) : (
            <div className="calib-metrics">
              <div>
                <span>RMS 重投影誤差</span>
                <b>{fmt(lab.camera.rms, 3)} px</b>
              </div>
              <div>
                <span>LM 迭代</span>
                <b>{lab.camera.iterations}</b>
              </div>
              <div>
                <span>點雲 RMSE（見 B）</span>
                <b
                  className={lab.scan && lab.scan.rmsEstimated > 1 ? "bad" : ""}
                >
                  {lab.scan ? `${fmt(lab.scan.rmsEstimated, 2)} mm` : "—"}
                </b>
              </div>
            </div>
          )}
          <IntrinsicsTable truth={lab.trueCamera} lab={lab} which="camera" />
          <div className="calib-two">
            <div>
              <div className="calib-view-picker">
                <span>第</span>
                <select
                  value={v}
                  onChange={(e) => setView(Number(e.target.value))}
                >
                  {lab.truePoses.map((_, i) => (
                    <option key={i} value={i}>
                      {i + 1}
                      {lab.camera.ok
                        ? `（${fmt(lab.camera.perViewRms[i], 2)} px）`
                        : ""}
                    </option>
                  ))}
                </select>
                <span>
                  張影像：○ 角點；線段 = 重投影誤差 ×200；＋ 真實主點；◯
                  估計主點
                </span>
              </div>
              <ImagePlot
                K={lab.trueCamera}
                observed={lab.cameraObs[v]}
                reprojected={reprojected}
                exaggerate={200}
                principal={{
                  truth: [lab.trueCamera.cx, lab.trueCamera.cy],
                  estimate: lab.camera.ok
                    ? [lab.camera.K.cx, lab.camera.K.cy]
                    : null,
                }}
              />
              <table className="calib-table calib-pose">
                <thead>
                  <tr>
                    <th>第 {v + 1} 張的外參</th>
                    <th>rvec（角度表示）</th>
                    <th>tvec (mm)</th>
                    <th>
                      <M>{"C = -R^\\top t"}</M>（相機在板座標）
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <PoseReadout label="真值" pose={lab.truePoses[v]} />
                  {lab.camera.ok && (
                    <PoseReadout label="估計" pose={lab.camera.poses[v]} />
                  )}
                </tbody>
              </table>
            </div>
            <CalibScene
              frame="camera"
              objects={cameraObjects}
              label="Camera 座標：虛線 = 真實板子姿態，綠 = 估計（黃 = 選取）"
            />
          </div>

          <h4>
            B. Projector：<code>calibrateCamera</code> +{" "}
            <code>cv.stereoCalibrate</code>
          </h4>
          {!lab.projector.ok ? (
            <p className="calib-error">
              Projector 校正失敗：{lab.projector.reason}
            </p>
          ) : (
            <IntrinsicsTable
              truth={TRUE_PROJECTOR}
              lab={lab}
              which="projector"
            />
          )}
          {lab.stereo && !lab.stereo.ok && (
            <p className="calib-error">{lab.stereo.reason}</p>
          )}
          {lab.stereo?.ok && (
            <>
              <div className="calib-metrics">
                <div>
                  <span>stereo RMS</span>
                  <b>{fmt(lab.stereo.rms, 3)} px</b>
                </div>
                <div>
                  <span>R 誤差</span>
                  <b>
                    {fmt(rotationAngleDeg(lab.stereo.R, TRUE_STEREO.R), 3)}°
                  </b>
                </div>
                <div>
                  <span>T 誤差</span>
                  <b>{fmt(norm3(sub3(lab.stereo.T, TRUE_STEREO.t)), 2)} mm</b>
                </div>
                <div>
                  <span>
                    Baseline |T|（真值 {fmt(norm3(TRUE_STEREO.t), 1)}）
                  </span>
                  <b>{fmt(norm3(lab.stereo.T), 1)} mm</b>
                </div>
                <div>
                  <span>各張單獨估的 R,T 分散</span>
                  <b>
                    {fmt(lab.stereo.spreadDeg, 2)}° /{" "}
                    {fmt(lab.stereo.spreadMm, 2)} mm
                  </b>
                </div>
              </div>
              <p className="calib-note">
                <M>{"T"}</M> 真值 = [
                {TRUE_STEREO.t.map((x) => fmt(x, 1)).join(", ")}
                ]，估計 = [{lab.stereo.T.map((x) => fmt(x, 1)).join(", ")}]。
                <M>{"T"}</M> 是「Camera 座標的點換到 Projector
                座標」的平移，不是 Projector 的位置；位置是{" "}
                <M>{"-R^\\top T"}</M> = [
                {poseCenter({ R: lab.stereo.R, t: lab.stereo.T })
                  .map((x) => fmt(x, 1))
                  .join(", ")}
                ]。
              </p>
            </>
          )}
          {lab.scan && (
            <div className="calib-two">
              <div>
                <h5>
                  用估出的校正掃描球 + 牆（<code>triangulatePoints</code>）
                </h5>
                <div className="calib-metrics">
                  <div>
                    <span>RMSE（估計校正）</span>
                    <b className={lab.scan.rmsEstimated > 1 ? "bad" : ""}>
                      {fmt(lab.scan.rmsEstimated, 3)} mm
                    </b>
                  </div>
                  <div>
                    <span>RMSE（完美校正，只剩對應雜訊）</span>
                    <b>{fmt(lab.scan.rmsIdeal, 3)} mm</b>
                  </div>
                  <div>
                    <span>點雲尺度 / 真值</span>
                    <b>{fmt(lab.scan.scale, 4)}</b>
                  </div>
                  <div>
                    <span>點數</span>
                    <b>{lab.scan.truth.length}</b>
                  </div>
                </div>
                <p className="calib-note">
                  兩個 RMSE 用同一組帶雜訊的 Projector
                  座標；差距完全來自校正誤差。點的顏色：綠 0 mm → 黃 1 mm → 紅 ≥
                  2 mm。
                </p>
              </div>
              <CalibScene
                frame="camera"
                objects={scanObjects}
                label="綠 = Camera；紫 = 估計的 Projector；虛線 = 真實 Projector；點雲依 3D 誤差著色"
              />
            </div>
          )}
        </div>
      )}
      <Tasks>
        <li>
          把「角點偵測雜訊」與「Projector 對應雜訊」都調到
          0：所有參數回到真值，RMS ≈ 0。這是在驗證演算法本身沒有問題。
        </li>
        <li>
          把「最大傾角」調到 0°：Zhang 初始化失敗。再調到 5°：RMS
          看起來仍然很小，但點雲誤差暴增。<b>RMS 小不代表校正正確</b>
          ，只代表模型「解釋得了」這些角點。
        </li>
        <li>
          取消「估計畸變」：RMS
          變大，左圖的誤差線呈放射狀（越靠外越長）——這就是沒被模型吸收的 radial
          distortion。
        </li>
        <li>
          把格子大小填成 22 mm（真值 20）：K 與 RMS 幾乎不變，但 tvec
          和點雲尺度都放大 10%。<b>格子大小決定單位</b>，錯了也不會在 RMS
          上露出馬腳。
        </li>
        <li>
          張數從 3 調到 20：看 fx、cx、點雲 RMSE
          怎麼收斂；同時注意「各張單獨估的 R,T
          分散」——這就是為什麼要用很多張做聯合最佳化。
        </li>
        <li>
          拉高 Projector 對應雜訊（相位雜訊）：Projector 的 K 與 R,T
          都變差。Projector 只能靠相位「看」，所以相位品質直接決定它的校正品質。
        </li>
      </Tasks>
    </div>
  );
}

const METHOD_LABEL: Record<RegistrationMethod, string> = {
  none: "不統合（直接用各自的 Camera 座標）",
  board: "校正板 + solvePnP",
  markers: "參考球 + 剛體對齊（Kabsch）",
};

export function RegistrationLabView() {
  const [config, setConfig] =
    useState<RegistrationConfig>(DEFAULT_REGISTRATION);
  const deferred = useDeferredValue(config);
  const stale = deferred !== config;
  const lab = useMemo(() => runRegistrationLab(deferred), [deferred]);
  const set = (patch: Partial<RegistrationConfig>) =>
    setConfig((c) => ({ ...c, ...patch }));

  const objects = useMemo((): SceneObject[] => {
    const { STAGE, DOME_C, DOME_R } = SCENE;
    const footprint = Math.sqrt(DOME_R * DOME_R - DOME_C[2] * DOME_C[2]);
    const objs: SceneObject[] = [
      {
        kind: "line",
        points: [
          [STAGE.x[0], STAGE.y[0], 0],
          [STAGE.x[1], STAGE.y[0], 0],
          [STAGE.x[1], STAGE.y[1], 0],
          [STAGE.x[0], STAGE.y[1], 0],
        ],
        color: COLORS.truth,
        closed: true,
      },
      {
        kind: "line",
        points: boardOutline(IDENTITY, TRUE_SQUARE_MM),
        color: COLORS.selected,
        closed: true,
        dashed: true,
      },
      {
        kind: "line",
        points: Array.from({ length: 48 }, (_, i): Vec3 => [
          DOME_C[0] + footprint * Math.cos((i / 48) * 2 * Math.PI),
          DOME_C[1] + footprint * Math.sin((i / 48) * 2 * Math.PI),
          0,
        ]),
        color: COLORS.truth,
        closed: true,
      },
      {
        kind: "line",
        points: [
          [0, 0, 0],
          [40, 0, 0],
        ],
        color: "#ff6b6b",
      },
      {
        kind: "line",
        points: [
          [0, 0, 0],
          [0, 40, 0],
        ],
        color: "#5ee45e",
      },
      {
        kind: "line",
        points: [
          [0, 0, 0],
          [0, 0, 40],
        ],
        color: "#6c9cff",
      },
    ];
    if (config.method === "markers")
      objs.push({
        kind: "points",
        points: MARKERS,
        color: COLORS.selected,
        size: 8,
      });
    lab.scanners.forEach((s, i) => {
      const truth = SCANNERS[i];
      const color = s.name === "A" ? COLORS.a : COLORS.b;
      objs.push({
        kind: "frustum",
        pose: truth.camera,
        K: TRUE_CAMERA,
        color: COLORS.truth,
        depth: 90,
        dashed: true,
      });
      if (s.estimatedPose)
        objs.push({
          kind: "frustum",
          pose: s.estimatedPose,
          K: TRUE_CAMERA,
          color,
          depth: 90,
        });
      objs.push({ kind: "points", points: s.worldCloud, color, size: 2 });
    });
    return objs;
  }, [lab, config.method]);

  return (
    <div className={`calib-lab ${stale ? "is-stale" : ""}`}>
      <div className="calib-controls">
        <fieldset className="calib-radio">
          <legend>統合方法</legend>
          {(Object.keys(METHOD_LABEL) as RegistrationMethod[]).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="reg-method"
                checked={config.method === m}
                onChange={() => set({ method: m })}
              />
              {METHOD_LABEL[m]}
            </label>
          ))}
        </fieldset>
        <Slider
          label="校正板角點雜訊 σ"
          value={config.cornerNoise}
          min={0}
          max={1}
          step={0.05}
          unit="px"
          onChange={(x) => set({ cornerNoise: x })}
        />
        <Slider
          label="參考球中心雜訊 σ"
          value={config.markerNoise}
          min={0}
          max={0.5}
          step={0.01}
          unit="mm"
          onChange={(x) => set({ markerNoise: x })}
        />
        <Slider
          label="在 B 的外參額外加旋轉誤差"
          value={config.rotationErrorB}
          min={0}
          max={2}
          step={0.05}
          unit="°"
          onChange={(x) => set({ rotationErrorB: x })}
        />
        <Slider
          label="Projector 對應雜訊 σ"
          value={config.projectorNoise}
          min={0}
          max={1}
          step={0.05}
          unit="px"
          onChange={(x) => set({ projectorNoise: x })}
        />
        <Slider
          label="Seed"
          value={config.seed}
          min={1}
          max={50}
          step={1}
          onChange={(x) => set({ seed: x })}
        />
        <button
          className="calib-reset"
          onClick={() => setConfig(DEFAULT_REGISTRATION)}
        >
          回到預設
        </button>
        <p className="calib-note">
          兩台 Scanner 的內參與 Camera–Projector
          外參都當作已校正好（完美），這裡只看「裝置 →
          世界」這一段。世界座標：原點 = 校正板第一個角點，Z 朝上，平台面 Z =
          0。
        </p>
      </div>
      <div className="calib-results">
        <div className="calib-metrics">
          <div>
            <span>A–B 一致性（不用真值）</span>
            <b className={lab.consistency.rms > 0.5 ? "bad" : ""}>
              {Number.isFinite(lab.consistency.rms)
                ? `${fmt(lab.consistency.rms, 3)} mm`
                : "不適用：不在同一座標"}
            </b>
          </div>
          <div>
            <span>重疊區比較點數</span>
            <b>{lab.consistency.points}</b>
          </div>
        </div>
        <table className="calib-table">
          <thead>
            <tr>
              <th>Scanner</th>
              <th>點數</th>
              <th>姿態誤差（角度 / 位置）</th>
              <th>平台高度（應為 0）</th>
              <th>對真值 RMSE</th>
            </tr>
          </thead>
          <tbody>
            {lab.scanners.map((s) => (
              <tr key={s.name}>
                <td style={{ color: s.name === "A" ? COLORS.a : COLORS.b }}>
                  {s.name}
                </td>
                <td>{s.worldCloud.length}</td>
                <td>
                  {fmt(s.poseErrorDeg, 3)}° / {fmt(s.poseErrorMm, 2)} mm
                </td>
                <td className={Math.abs(s.stageHeight) > 0.3 ? "bad" : ""}>
                  {fmt(s.stageHeight, 3)} mm
                </td>
                <td className={s.rms > 0.5 ? "bad" : ""}>{fmt(s.rms, 3)} mm</td>
              </tr>
            ))}
          </tbody>
        </table>
        <CalibScene
          frame="world"
          objects={objects}
          label="世界座標：藍 = A，橙 = B；虛線 = 真實相機位置；黃框 = 校正板；紅綠藍 = X Y Z 軸"
        />
      </div>
      <Tasks>
        <li>
          選「不統合」：兩團點雲都畫在各自的 Camera
          座標裡，彼此毫無關係，平台高度約 400 mm（= 相機到平台的距離）。
        </li>
        <li>
          切回「校正板 + solvePnP」：兩團點雲接在一起，平台高度回到 ≈
          0。一張校正板同時解決了「對齊」和「高度零點」。
        </li>
        <li>
          把 B 的旋轉誤差調到 0.2°、0.5°、1°：一致性 RMS 和 B
          的平台高度一起變差。相機離物體約 400 mm，0.5° ≈ 3.5 mm 的位移。
        </li>
        <li>
          注意「一致性」不需要真值：實機上沒有真值時，就靠兩台在重疊區是否一致來發現問題。
        </li>
        <li>
          換成「參考球 + Kabsch」並拉高球心雜訊：至少要 3
          顆不共線的球；球少或靠得太近時，雜訊會被放大成旋轉誤差。
        </li>
      </Tasks>
    </div>
  );
}
