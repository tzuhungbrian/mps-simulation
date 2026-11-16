import { useMemo, useState } from "react";
import { ArrowLeft, FlaskConical, ScanLine } from "lucide-react";
import { distort, type Distortion } from "./camera";
import {
  CalibrationLabView,
  RegistrationLabView,
  Slider,
} from "./CalibrationLabs";
import { M, MathBlock } from "./Tex";
import "./calibration.css";

type UnitStatus = "here" | "done" | "partial" | "planned";
const ROADMAP: {
  chapter: string;
  units: { n: number; title: string; status: UnitStatus }[];
}[] = [
  {
    chapter: "第一章 相位",
    units: [
      { n: 1, title: "Phase Shifting", status: "done" },
      { n: 2, title: "Phase Unwrapping", status: "partial" },
    ],
  },
  {
    chapter: "第二章 幾何",
    units: [
      { n: 3, title: "相機模型與三角量測", status: "here" },
      { n: 4, title: "Camera Calibration", status: "here" },
      { n: 5, title: "Projector Calibration", status: "here" },
    ],
  },
  {
    chapter: "第三章 實戰",
    units: [
      { n: 6, title: "系統設計", status: "planned" },
      { n: 7, title: "誤差來源與診斷", status: "planned" },
      { n: 8, title: "從頭架設", status: "planned" },
    ],
  },
  {
    chapter: "第四章 多視角（進階）",
    units: [
      { n: 9, title: "座標統合", status: "here" },
      { n: 10, title: "多視角 Fusion", status: "partial" },
    ],
  },
];
const STATUS_LABEL: Record<UnitStatus, string> = {
  here: "本頁",
  done: "已有",
  partial: "部分",
  planned: "規劃中",
};

function Code({ children }: { children: string }) {
  return (
    <pre className="calib-code">
      <code>{children.trim()}</code>
    </pre>
  );
}

function DistortionDemo() {
  const [d, setD] = useState<Distortion>([-0.25, 0, 0, 0, 0]);
  const lines = useMemo(() => {
    const out: { ideal: string; warped: string }[] = [];
    const W = 0.6,
      H = 0.45,
      n = 9,
      steps = 40;
    const map = ([x, y]: number[], warp: boolean) => {
      const [u, v] = warp ? distort(x, y, d) : [x, y];
      return `${(200 + u * 280).toFixed(1)},${(160 + v * 280).toFixed(1)}`;
    };
    for (let i = 0; i < n; i++) {
      const fx = -W + (2 * W * i) / (n - 1),
        fy = -H + (2 * H * i) / (n - 1);
      const along = (k: number) => k / steps;
      const vertical = Array.from({ length: steps + 1 }, (_, k) => [
        fx,
        -H + 2 * H * along(k),
      ]);
      const horizontal = Array.from({ length: steps + 1 }, (_, k) => [
        -W + 2 * W * along(k),
        fy,
      ]);
      for (const pts of [vertical, horizontal])
        out.push({
          ideal: pts.map((p) => map(p, false)).join(" "),
          warped: pts.map((p) => map(p, true)).join(" "),
        });
    }
    return out;
  }, [d]);
  const set = (i: number, v: number) =>
    setD((old) => old.map((x, k) => (k === i ? v : x)) as Distortion);
  return (
    <div className="calib-demo">
      <svg viewBox="0 0 400 320" role="img" aria-label="畸變示意格線">
        {lines.map((l, i) => (
          <g key={i}>
            <polyline points={l.ideal} className="calib-demo-ideal" />
            <polyline points={l.warped} className="calib-demo-warped" />
          </g>
        ))}
      </svg>
      <div className="calib-demo-controls">
        <Slider
          label="k1（徑向）"
          value={d[0]}
          min={-0.5}
          max={0.5}
          step={0.01}
          onChange={(v) => set(0, v)}
        />
        <Slider
          label="k2（徑向）"
          value={d[1]}
          min={-0.5}
          max={0.5}
          step={0.01}
          onChange={(v) => set(1, v)}
        />
        <Slider
          label="p1（切向）"
          value={d[2]}
          min={-0.05}
          max={0.05}
          step={0.002}
          onChange={(v) => set(2, v)}
        />
        <Slider
          label="p2（切向）"
          value={d[3]}
          min={-0.05}
          max={0.05}
          step={0.002}
          onChange={(v) => set(3, v)}
        />
        <p className="calib-note">
          灰線 = 理想針孔；綠線 = 加上畸變後實際落在影像上的位置。k1 &lt; 0
          為桶形、k1 &gt; 0 為枕形；越靠邊緣變形越大。
        </p>
      </div>
    </div>
  );
}

export default function CalibrationCourse({
  onSandbox,
  onGuide,
  onLab,
}: {
  onSandbox: () => void;
  onGuide: () => void;
  onLab: () => void;
}) {
  return (
    <div className="calib-shell">
      <header className="calib-header">
        <div className="calib-brand">
          <ScanLine size={22} />
          <span>
            結構光實驗室<small>Calibration 與座標統合</small>
          </span>
        </div>
        <div className="calib-header-actions">
          <button className="calib-lab-link" onClick={onLab}>
            <FlaskConical size={16} />
            進入 3D 實驗室
          </button>
          <button onClick={onGuide}>
            <ArrowLeft size={16} />
            一步一步學（相位）
          </button>
          <button onClick={onSandbox}>
            <ArrowLeft size={16} />
            3D 沙盒
          </button>
        </div>
      </header>

      <nav className="calib-roadmap" aria-label="課程地圖">
        {ROADMAP.map((c) => (
          <div key={c.chapter} className="calib-roadmap-chapter">
            <span>{c.chapter}</span>
            <ol>
              {c.units.map((u) => (
                <li key={u.n} className={`is-${u.status}`}>
                  <b>{u.n}</b>
                  {u.title}
                  <small>{STATUS_LABEL[u.status]}</small>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </nav>

      <main className="calib-article">
        <h1>Camera Calibration 與座標統合</h1>
        <p className="calib-lead">
          Phase 告訴我們「Camera 像素對到 Projector 的哪一點」。要把這個對應變成
          mm 的 3D 座標，還需要知道兩台裝置的內部參數與相對位置——這就是
          Calibration。有多台裝置時，還要把各自的點雲放進同一個世界座標——這就是座標統合。
        </p>
        <nav className="calib-toc" aria-label="本頁目錄">
          <a href="#goal">目標</a>
          <a href="#model">1. 相機模型</a>
          <a href="#distortion">2. 鏡頭畸變</a>
          <a href="#extrinsics">3. 三種外參</a>
          <a href="#camera">4. Camera Calibration</a>
          <a href="#projector">5. Projector Calibration</a>
          <a href="#registration">6. 座標統合</a>
          <a href="#lab">7. 實驗模擬</a>
          <a href="#pitfalls">8. 常見錯誤</a>
        </nav>

        <section id="goal">
          <h2>目標</h2>
          <ul>
            <li>
              知道內參 K、畸變係數、外參 R, t 各代表什麼，以及 t
              為什麼不是相機的位置。
            </li>
            <li>知道 OpenCV 怎麼用棋盤格校正 Camera，以及怎麼判讀結果。</li>
            <li>
              理解 Projector 為什麼能「當成相機」校正，Camera–Projector
              外參從哪裡來。
            </li>
            <li>
              知道多台裝置的點雲如何放進同一個世界座標，以及外參誤差的影響有多大。
            </li>
          </ul>
          <p>
            程式片段使用 Python +
            OpenCV，只為了讓你認得函式的輸入輸出；最後的實驗模擬不需要寫程式。
          </p>
        </section>

        <section id="model">
          <h2>1. 相機模型：一個 3D 點怎麼變成像素</h2>
          <div className="calib-pipeline">
            <span>
              世界座標 <M>{"X_w"}</M>
            </span>
            <i>外參 R, t →</i>
            <span>
              相機座標 <M>{"X_c"}</M>
            </span>
            <i>÷ Z →</i>
            <span>
              正規化座標 <M>{"(x, y)"}</M>
            </span>
            <i>畸變 →</i>
            <span>
              <M>{"(x_d, y_d)"}</M>
            </span>
            <i>K →</i>
            <span>
              像素 <M>{"(u, v)"}</M>
            </span>
          </div>
          <MathBlock>{String.raw`
\begin{aligned}
X_c &= R\,X_w + t \\
x &= \frac{X_c}{Z_c}, \qquad y = \frac{Y_c}{Z_c} \\
(x_d,\ y_d) &= \operatorname{distort}(x,\ y) \\
u &= f_x\,x_d + c_x, \qquad v = f_y\,y_d + c_y
\end{aligned}`}</MathBlock>
          <p>最後一行寫成矩陣，就是常見的內參矩陣 K：</p>
          <MathBlock>{String.raw`
\begin{bmatrix} u \\ v \\ 1 \end{bmatrix}
= K \begin{bmatrix} x_d \\ y_d \\ 1 \end{bmatrix},
\qquad
K = \begin{bmatrix} f_x & 0 & c_x \\ 0 & f_y & c_y \\ 0 & 0 & 1 \end{bmatrix}`}</MathBlock>
          <dl className="calib-defs">
            <dt>內參（intrinsic）</dt>
            <dd>
              只跟相機本身（感測器 + 鏡頭）有關，搬動相機不會改變：
              <M>{"f_x, f_y"}</M>（以像素為單位的焦距）、
              <M>{"c_x, c_y"}</M>
              （主點：光軸穿過影像的位置，不一定在正中央）、畸變係數{" "}
              <M>{"k_1, k_2, p_1, p_2, k_3"}</M>。OpenCV 把它們分成{" "}
              <code>cameraMatrix</code> 與 <code>distCoeffs</code>{" "}
              兩個變數，但兩者都是內參。改變對焦或變焦，內參就會變。
            </dd>
            <dt>外參（extrinsic）</dt>
            <dd>
              相機相對於「某個參考座標」的姿態：旋轉 <M>{"R"}</M>（3
              個自由度，OpenCV 用 3 個數的 <code>rvec</code> 表示，方向 =
              旋轉軸、長度 = 角度，用 <code>cv.Rodrigues</code> 與 3×3
              矩陣互換）與平移 <M>{"t"}</M>。
            </dd>
            <dt>t 不是相機的位置</dt>
            <dd>
              <M>{"X_c = R\\,X_w + t"}</M>{" "}
              的意思是「把世界座標的點換到相機座標」。相機中心在世界座標的位置是{" "}
              <M>{"C = -R^\\top t"}</M>。實驗 A 的表格會同時列出兩者。
            </dd>
            <dt>座標慣例</dt>
            <dd>
              OpenCV 相機座標：x 向右、y 向下、z 沿光軸朝前；像素 (0, 0)
              在左上角。
            </dd>
          </dl>
          <p>
            有了兩台裝置（Camera + Projector）的模型與它們之間的 R,
            t，一組對應點 <M>{"(u_c, v_c) \\leftrightarrow (u_p, v_p)"}</M>{" "}
            就各自定義一條射線，兩條射線的交點就是 3D
            點：這就是三角量測（triangulation）。
          </p>
        </section>

        <section id="distortion">
          <h2>2. 鏡頭畸變</h2>
          <p>真實鏡頭不是完美針孔。OpenCV 的模型在正規化座標上加兩種修正：</p>
          <MathBlock>{String.raw`
\begin{aligned}
r^2 &= x^2 + y^2 \\[4pt]
x_d &= x\,\underbrace{\left(1 + k_1 r^2 + k_2 r^4 + k_3 r^6\right)}_{\text{徑向 radial}}
  + \underbrace{2p_1\,xy + p_2\left(r^2 + 2x^2\right)}_{\text{切向 tangential}} \\[4pt]
y_d &= y\left(1 + k_1 r^2 + k_2 r^4 + k_3 r^6\right) + p_1\left(r^2 + 2y^2\right) + 2p_2\,xy
\end{aligned}`}</MathBlock>
          <ul>
            <li>
              徑向畸變：直線在影像上彎曲；離中心越遠（<M>{"r"}</M>{" "}
              越大）越嚴重。所以校正時必須讓角點出現在影像邊緣和角落。
            </li>
            <li>切向畸變：鏡片與感測器不完全平行造成，通常很小。</li>
            <li>畸變屬於內參。只要鏡頭與對焦不變，它就不變。</li>
          </ul>
          <DistortionDemo />
        </section>

        <section id="extrinsics">
          <h2>3. 三種外參</h2>
          <p>
            「外參」一定是「誰相對於誰」。結構光系統裡會遇到三種，最容易混淆：
          </p>
          <table className="calib-table">
            <thead>
              <tr>
                <th></th>
                <th>描述的關係</th>
                <th>從哪裡來</th>
                <th>OpenCV</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>① 每張照片的板子姿態</td>
                <td>校正板 → Camera</td>
                <td>校正時每張照片一組，副產品</td>
                <td>
                  <code>calibrateCamera</code> 的 <code>rvecs, tvecs</code>
                </td>
              </tr>
              <tr>
                <td>② Camera–Projector</td>
                <td>Camera → Projector</td>
                <td>由兩邊的 ① 組合，再聯合最佳化</td>
                <td>
                  <code>stereoCalibrate</code> 的 <code>R, T</code>
                </td>
              </tr>
              <tr>
                <td>③ 裝置 → 世界</td>
                <td>Camera → 平台 / 世界</td>
                <td>平放的校正板或參考物</td>
                <td>
                  <code>solvePnP</code>
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            三角量測只需要 ②，點雲會在 Camera
            座標裡。要談「高度」、或合併多台裝置的資料，就需要 ③。
          </p>
        </section>

        <section id="camera">
          <h2>4. Camera Calibration</h2>
          <p>
            為什麼用棋盤格？角點在板上的 3D 座標已知（全部在 <M>{"Z = 0"}</M>{" "}
            平面，間距 = 格子大小），而且角點可以偵測到次像素精度。
          </p>
          <h3>流程</h3>
          <ol>
            <li>
              準備 object points：9 × 6 個內角點 →{" "}
              <M>{"(0,0,0),\\ (s,0,0),\\ \\dots,\\ (8s,5s,0)"}</M>。
              <b>
                格子大小 <M>{"s"}</M> 決定之後所有 <M>{"t"}</M> 與點雲的單位
              </b>
              。
            </li>
            <li>
              每張影像用 <code>findChessboardCorners</code> 找角點，再用{" "}
              <code>cornerSubPix</code> 精修到次像素。
            </li>
            <li>
              <code>calibrateCamera</code>：一次估出 K、畸變，以及每張照片的
              rvec、tvec（第 ① 種外參）。
            </li>
            <li>
              檢查重投影誤差：把 3D
              角點用估出的參數投回影像，和偵測到的角點比較。
            </li>
            <li>
              使用：<code>undistort</code> 對整張影像去畸變，或{" "}
              <code>undistortPoints</code> 只處理點。
            </li>
          </ol>
          <Code>{`
import numpy as np, cv2 as cv, glob

pattern = (9, 6)                    # 內角點：每列 9 個、共 6 列
square = 20.0                       # 格子邊長 (mm) → 決定 t 與點雲的單位
objp = np.zeros((9 * 6, 3), np.float32)
objp[:, :2] = np.mgrid[0:9, 0:6].T.reshape(-1, 2) * square

objpoints, imgpoints = [], []
for fname in glob.glob("calib/*.png"):
    gray = cv.cvtColor(cv.imread(fname), cv.COLOR_BGR2GRAY)
    ok, corners = cv.findChessboardCorners(gray, pattern, None)
    if ok:
        corners = cv.cornerSubPix(gray, corners, (11, 11), (-1, -1),
            (cv.TERM_CRITERIA_EPS + cv.TERM_CRITERIA_MAX_ITER, 30, 0.001))
        objpoints.append(objp)
        imgpoints.append(corners)

rms, K, dist, rvecs, tvecs = cv.calibrateCamera(
    objpoints, imgpoints, gray.shape[::-1], None, None)
# rms  : 全部角點的 RMS 重投影誤差 (px)
# K    : 3x3 cameraMatrix；dist = [k1, k2, p1, p2, k3]
# rvecs, tvecs : 每張照片「板子 → Camera」的外參
`}</Code>
          <Code>{`
# 單張的重投影誤差
proj, _ = cv.projectPoints(objpoints[i], rvecs[i], tvecs[i], K, dist)
err = np.sqrt(np.mean(np.sum((imgpoints[i] - proj) ** 2, axis=2)))

# 相機在板子座標中的位置：C = -R^T t（不是 tvecs[i]）
R, _ = cv.Rodrigues(rvecs[i])
C = -R.T @ tvecs[i]

# 去畸變
undistorted = cv.undistort(img, K, dist)
xn = cv.undistortPoints(pts, K, dist)   # 回傳正規化座標 (x, y)
`}</Code>
          <h3>內部做了什麼（知道概念即可）</h3>
          <ul>
            <li>
              平面板（<M>{"Z = 0"}</M>）與影像之間是一個
              Homography，每張照片可以估出一個
              <M>{"H"}</M>：
              <MathBlock>{String.raw`
s \begin{bmatrix} u \\ v \\ 1 \end{bmatrix}
= \underbrace{K \begin{bmatrix} r_1 & r_2 & t \end{bmatrix}}_{H}
\begin{bmatrix} X \\ Y \\ 1 \end{bmatrix}`}</MathBlock>
            </li>
            <li>
              Zhang 法：因為旋轉矩陣的前兩欄必須滿足 <M>{"r_1 \\perp r_2"}</M>{" "}
              且 <M>{"\\lVert r_1 \\rVert = \\lVert r_2 \\rVert"}</M>
              ，每個 <M>{"H"}</M> 提供 2 個關於 <M>{"K"}</M>{" "}
              的方程式；多張照片就能解出 <M>{"K"}</M> 的初值（實驗 A
              表格的「Zhang 初值」欄）。
            </li>
            <li>
              有了 <M>{"K"}</M>，就能從每個 <M>{"H"}</M> 拆出該張的{" "}
              <M>{"R, t"}</M>。最後用 Levenberg–Marquardt 同時微調 <M>{"K"}</M>
              、畸變與所有姿態，讓重投影誤差最小——畸變在這一步才被估計：
              <MathBlock>{String.raw`
\min_{K,\ \text{dist},\ \{R_i, t_i\}} \;
\sum_{i}\sum_{j} \left\lVert\, \mathbf{u}_{ij} - \pi\!\left(K, \text{dist}, R_i, t_i, \mathbf{X}_j\right) \right\rVert^2`}</MathBlock>
              <M>{"\\mathbf{u}_{ij}"}</M> 是第 <M>{"i"}</M> 張影像偵測到的第{" "}
              <M>{"j"}</M> 個角點，<M>{"\\pi(\\cdot)"}</M> 就是第 1
              節的投影模型。回傳的 RMS 就是這個總和除以角點數再開根號。
            </li>
          </ul>
          <h3>拍照要點</h3>
          <ul>
            <li>
              10–20 張；板子要有明顯傾斜（約
              20–45°）。只有正對的照片無法把焦距和距離分開。
            </li>
            <li>讓角點分布到影像四周與角落，畸變才估得準。</li>
            <li>對焦清楚、不過曝、板子平整；格子大小用卡尺量準。</li>
            <li>校正後不要再動對焦環與光圈；動了就要重新校正。</li>
          </ul>
          <h3>判讀</h3>
          <ul>
            <li>
              RMS 重投影誤差一般在 0.1–0.5
              px。某張特別大時，通常是角點偵測錯誤，剔除後重算。
            </li>
            <li>
              <b>RMS 小不等於校正正確。</b>
              它只代表模型能「解釋」這些角點。姿態太單一、格子大小填錯時，RMS
              照樣很小（實驗 A 會親眼看到）。最終要用已知尺寸的量規實測。
            </li>
          </ul>
        </section>

        <section id="projector">
          <h2>5. Projector Calibration</h2>
          <p>
            Projector 在光學上就是「反向的相機」：同樣有 K
            與畸變，只是光往外射。所以它可以用同一套{" "}
            <code>calibrateCamera</code>
            校正——前提是知道每個棋盤角點落在 Projector 影像的哪個像素。
          </p>
          <h3>Projector 不能拍照，那角點座標從哪來？</h3>
          <p>用結構光替它「看」。在每一個板子姿態：</p>
          <ol>
            <li>
              Camera 拍一張普通照片，偵測棋盤角點（跟 Camera 校正同一批照片）。
            </li>
            <li>
              Projector 投<b>垂直</b>與<b>水平</b>兩組條紋，用 Phase Shifting +
              Unwrapping 求出每個 Camera 像素的絕對相位{" "}
              <M>{"\\Phi_x, \\Phi_y"}</M>。
            </li>
            <li>
              在角點位置讀相位，換成 Projector 像素（<M>{"f"}</M> = 條紋週期數，
              <M>{"W_p, H_p"}</M> = Projector 解析度）：
              <MathBlock>{String.raw`
u_p = \frac{\Phi_x}{2\pi f}\, W_p, \qquad v_p = \frac{\Phi_y}{2\pi f}\, H_p`}</MathBlock>
            </li>
          </ol>
          <p>
            掃描時只需要一個方向的條紋（沙盒就是只用 <M>{"u_p"}</M> 的 ray–plane
            三角量測），但<b>校正 Projector 需要兩個方向</b>，因為它的 2D
            模型需要 <M>{"(u_p, v_p)"}</M>。相位的雜訊會直接變成 Projector
            角點的雜訊。
          </p>
          <p>
            Projector 的常見特性：主點不在中央。多數 DLP 採 offset 光學，
            <M>{"c_y"}</M> 接近影像下緣，畫面往上投（實驗 B 的真值{" "}
            <M>{"c_y = 740"}</M>，影像高 768）。
          </p>
          <Code>{`
# Phi_x, Phi_y：這個姿態解出的絕對相位圖 (float32, 與 Camera 影像同尺寸)
mx = corners[:, :, 0].astype(np.float32)        # 角點的次像素座標
my = corners[:, :, 1].astype(np.float32)
up = cv.remap(Phi_x, mx, my, cv.INTER_LINEAR) * Wp / (2 * np.pi * f)
vp = cv.remap(Phi_y, mx, my, cv.INTER_LINEAR) * Hp / (2 * np.pi * f)
projpoints.append(np.dstack([up, vp]).astype(np.float32))

# Projector 自己的內參
rms_p, Kp, dist_p, _, _ = cv.calibrateCamera(
    objpoints, projpoints, (Wp, Hp), None, None)

# Camera–Projector 外參（第 ② 種）：X_p = R @ X_c + T
rms_s, _, _, _, _, R, T, E, F = cv.stereoCalibrate(
    objpoints, imgpoints, projpoints, K, dist, Kp, dist_p, (W, H),
    flags=cv.CALIB_FIX_INTRINSIC)
`}</Code>
          <h3>有了 R, T 就能三角量測</h3>
          <MathBlock>{String.raw`
X_p = R\,X_c + T, \qquad
C_p = -R^\top T \;\;(\text{Projector 在 Camera 座標中的位置})`}</MathBlock>
          <Code>{`
xc = cv.undistortPoints(cam_px, K, dist).reshape(-1, 2).T     # 正規化座標
xp = cv.undistortPoints(proj_px, Kp, dist_p).reshape(-1, 2).T
P1 = np.hstack([np.eye(3), np.zeros((3, 1))])                 # Camera = 參考
P2 = np.hstack([R, T])
Xh = cv.triangulatePoints(P1, P2, xc, xp)
X = (Xh[:3] / Xh[3]).T                                        # Camera 座標 (mm)
`}</Code>
          <p>
            注意方向：<code>stereoCalibrate</code> 的 <M>{"R, T"}</M> 是「Camera
            座標 → Projector 座標」。<M>{"T"}</M> 不是 Projector 的位置，位置是{" "}
            <M>{"-R^\\top T"}</M>。每一個姿態其實都能單獨算出一組{" "}
            <M>{"R, T"}</M>，但會因雜訊而分散；<code>stereoCalibrate</code>{" "}
            用所有姿態一起最佳化。
          </p>
        </section>

        <section id="registration">
          <h2>6. 座標統合</h2>
          <p>
            三角量測出來的點雲在 <b>Camera 座標</b>：原點是鏡頭中心，z
            沿光軸。這帶來兩個問題：「高度」沒有意義（z
            是離相機的距離，不是離平台的高度）；兩台 Scanner
            的點雲各在自己的座標，不能直接合併。
          </p>
          <p>
            解法是第 ③ 種外參：決定一個<b>世界座標</b>（通常：平台面，Z 朝上，Z
            = 0 = 平台面 = 高度零點），再求每台裝置的 Camera → 世界轉換：
          </p>
          <MathBlock>{String.raw`
X_w = R^\top \left(X_c - t\right) \qquad (R, t:\ \text{世界} \rightarrow \text{Camera})`}</MathBlock>
          <h3>方法 A：校正板 + solvePnP</h3>
          <p>
            把校正板平放在平台上，每台相機各拍一張，用已知的 K 求出板子 → 相機的
            R, t。板子同時定義了原點、XY 方向與高度零點。之後移開板子再放物體。
          </p>
          <Code>{`
ok, rvec, tvec = cv.solvePnP(objp, corners, K, dist)   # 板子 → Camera
R, _ = cv.Rodrigues(rvec)
X_world = (R.T @ (X_cam.T - tvec)).T                   # 每台各自換到世界座標
`}</Code>
          <h3>方法 B：已知位置的參考物 + 剛體對齊</h3>
          <p>
            在平台上放幾顆位置已知的參考球（或標記）。每台 Scanner
            量出球心（Camera 座標）<M>{"a_i"}</M>
            ，再求一個剛體轉換讓它們對上已知的世界座標 <M>{"b_i"}</M>（Kabsch /
            Umeyama，用 SVD 解）。至少 3 個不共線的點；點越分散，旋轉越準。
          </p>
          <MathBlock>{String.raw`
\min_{R,\ t} \; \sum_i \left\lVert R\,a_i + t - b_i \right\rVert^2`}</MathBlock>
          <Code>{`
def rigid_transform(A, B):          # 找 R, t 使 R @ a + t ≈ b（A, B: N x 3）
    ca, cb = A.mean(0), B.mean(0)
    U, S, Vt = np.linalg.svd((A - ca).T @ (B - cb))
    D = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
    R = Vt.T @ D @ U.T
    return R, cb - R @ ca

R_wc, t_wc = rigid_transform(centers_cam, centers_world)
X_world = X_cam @ R_wc.T + t_wc
`}</Code>
          <h3>方法 C：點雲直接對齊（ICP）</h3>
          <p>
            沒有已知參考物時，可以讓兩團點雲在重疊區直接對齊（例如 Open3D 的{" "}
            <code>registration_icp</code>
            ）。它需要不錯的初值與足夠的重疊，通常拿來微調 A、B
            的結果，而不是取代它們。
          </p>
          <h3>誤差會被距離放大</h3>
          <MathBlock>{String.raw`
\Delta \approx L \cdot \theta_{\text{rad}}, \qquad
\text{例：}\ 400\,\text{mm} \times 0.1^\circ \times \tfrac{\pi}{180} \approx 0.7\,\text{mm}`}</MathBlock>
          <p>
            平移誤差直接變成位移；角度誤差則乘上工作距離 <M>{"L"}</M>
            。沒有真值時，用兩個方法檢查：平台面重建後的高度應為
            0；兩台在重疊區的點雲應該互相貼合（實驗 C 的「一致性」）。
          </p>
        </section>

        <section id="lab">
          <h2>7. 實驗模擬</h2>
          <div className="calib-lab-callout">
            <div>
              <strong>想「親手」校正一次？</strong>
              <p>
                3D
                實驗室裡可以拿著棋盤格擺姿勢、調曝光與對焦、拍照、投條紋，再把影像交給瀏覽器裡的
                OpenCV.js 算出 Camera 與 Projector 的參數。
              </p>
            </div>
            <button onClick={onLab}>
              <FlaskConical size={16} />
              進入 3D 實驗室
            </button>
          </div>
          <p>
            以下計算全在瀏覽器裡用實際演算法執行（Homography + Zhang 初值 +
            Levenberg–Marquardt，與 OpenCV
            同樣的模型），不是查表。真值只用來產生「觀測」與評分，校正演算法本身看不到。
          </p>
          <h3 id="lab-calibration">實驗 A + B：校正一套 Camera + Projector</h3>
          <p>
            模擬一套結構光：Camera 1280 × 1024，Projector 1024 × 768，相距約 17
            cm。每個姿態同時產生 Camera 角點與 Projector
            角點（後者代表由相位求得的座標）。
            校正完成後，用估出的參數掃描一顆球與後方的牆，與完美校正比較。
          </p>
          <CalibrationLabView />
          <h3 id="lab-registration">實驗 C：兩台 Scanner 的座標統合</h3>
          <p>
            兩台 Scanner 從左右兩側斜拍平台上的半球。各自的點雲先在自己的 Camera
            座標，再用選定的方法換到世界座標。
          </p>
          <RegistrationLabView />
        </section>

        <section id="pitfalls">
          <h2>8. 常見錯誤清單</h2>
          <ul className="calib-pitfalls">
            <li>格子大小填錯 → 整個點雲等比例縮放，RMS 看不出來。</li>
            <li>只拍正對或傾角太小的照片 → 焦距與距離分不開。</li>
            <li>角點只集中在影像中央 → 畸變估不準，邊緣誤差大。</li>
            <li>
              把 tvec 當成相機位置（位置是 <M>{"-R^\\top t"}</M>）。
            </li>
            <li>搞反 R, T 的方向（Camera → Projector 還是反過來）。</li>
            <li>校正 Projector 只投一個方向的條紋。</li>
            <li>只看 RMS、不用已知尺寸的物體驗證。</li>
            <li>校正後又動了對焦、光圈或裝置位置。</li>
            <li>
              多台裝置的點雲沒有統一座標，或沒有定義高度零點就談「高度」。
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
