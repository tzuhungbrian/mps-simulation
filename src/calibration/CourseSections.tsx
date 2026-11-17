import { useMemo, useState } from "react";
import { distort, type Distortion } from "./camera";
import { Slider } from "./CalibrationLabs";
import { M, MathBlock } from "./Tex";
import { t } from "../i18n";
import "./calibration.css";

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
      <svg
        viewBox="0 0 400 320"
        role="img"
        aria-label={t("畸變示意格線", "Distortion illustration grid")}
      >
        {lines.map((l, i) => (
          <g key={i}>
            <polyline points={l.ideal} className="calib-demo-ideal" />
            <polyline points={l.warped} className="calib-demo-warped" />
          </g>
        ))}
      </svg>
      <div className="calib-demo-controls">
        <Slider
          label={t("k1（徑向）", "k1 (radial)")}
          value={d[0]}
          min={-0.5}
          max={0.5}
          step={0.01}
          onChange={(v) => set(0, v)}
        />
        <Slider
          label={t("k2（徑向）", "k2 (radial)")}
          value={d[1]}
          min={-0.5}
          max={0.5}
          step={0.01}
          onChange={(v) => set(1, v)}
        />
        <Slider
          label={t("p1（切向）", "p1 (tangential)")}
          value={d[2]}
          min={-0.05}
          max={0.05}
          step={0.002}
          onChange={(v) => set(2, v)}
        />
        <Slider
          label={t("p2（切向）", "p2 (tangential)")}
          value={d[3]}
          min={-0.05}
          max={0.05}
          step={0.002}
          onChange={(v) => set(3, v)}
        />
        <p className="calib-note">
          {t(
            <>
              灰線 = 理想針孔；綠線 = 加上畸變後實際落在影像上的位置。k1 &lt; 0
              為桶形、k1 &gt; 0 為枕形；越靠邊緣變形越大。
            </>,
            <>
              Gray lines = ideal pinhole; green lines = where points actually
              land in the image once distortion is added. k1 &lt; 0 gives barrel
              distortion, k1 &gt; 0 gives pincushion; the deformation grows
              toward the edges.
            </>,
          )}
        </p>
      </div>
    </div>
  );
}

export function CameraModelSection() {
  return (
    <section id="model">
      <h2>
        {t(
          "相機模型：一個 3D 點怎麼變成像素",
          "Camera model: how a 3D point becomes a pixel",
        )}
      </h2>
      <div className="calib-pipeline">
        <span>
          {t(
            <>
              世界座標 <M>{"X_w"}</M>
            </>,
            <>
              World coordinates <M>{"X_w"}</M>
            </>,
          )}
        </span>
        <i>{t("外參 R, t →", "Extrinsics R, t →")}</i>
        <span>
          {t(
            <>
              相機座標 <M>{"X_c"}</M>
            </>,
            <>
              Camera coordinates <M>{"X_c"}</M>
            </>,
          )}
        </span>
        <i>÷ Z →</i>
        <span>
          {t(
            <>
              正規化座標 <M>{"(x, y)"}</M>
            </>,
            <>
              Normalized coordinates <M>{"(x, y)"}</M>
            </>,
          )}
        </span>
        <i>{t("畸變 →", "Distortion →")}</i>
        <span>
          <M>{"(x_d, y_d)"}</M>
        </span>
        <i>K →</i>
        <span>
          {t(
            <>
              像素 <M>{"(u, v)"}</M>
            </>,
            <>
              Pixel <M>{"(u, v)"}</M>
            </>,
          )}
        </span>
      </div>
      <MathBlock>{String.raw`
\begin{aligned}
X_c &= R\,X_w + t \\
x &= \frac{X_c}{Z_c}, \qquad y = \frac{Y_c}{Z_c} \\
(x_d,\ y_d) &= \operatorname{distort}(x,\ y) \\
u &= f_x\,x_d + c_x, \qquad v = f_y\,y_d + c_y
\end{aligned}`}</MathBlock>
      <p>
        {t(
          "最後一行寫成矩陣，就是常見的內參矩陣 K：",
          "Written as a matrix, the last line is the familiar intrinsic matrix K:",
        )}
      </p>
      <MathBlock>{String.raw`
\begin{bmatrix} u \\ v \\ 1 \end{bmatrix}
= K \begin{bmatrix} x_d \\ y_d \\ 1 \end{bmatrix},
\qquad
K = \begin{bmatrix} f_x & 0 & c_x \\ 0 & f_y & c_y \\ 0 & 0 & 1 \end{bmatrix}`}</MathBlock>
      <dl className="calib-defs">
        <dt>{t("內參（intrinsic）", "Intrinsics")}</dt>
        <dd>
          {t(
            <>
              只跟相機本身（感測器 + 鏡頭）有關，搬動相機不會改變：
              <M>{"f_x, f_y"}</M>（以像素為單位的焦距）、
              <M>{"c_x, c_y"}</M>
              （主點：光軸穿過影像的位置，不一定在正中央）、畸變係數{" "}
              <M>{"k_1, k_2, p_1, p_2, k_3"}</M>。OpenCV 把它們分成{" "}
              <code>cameraMatrix</code> 與 <code>distCoeffs</code>{" "}
              兩個變數，但兩者都是內參。改變對焦或變焦，內參就會變。
            </>,
            <>
              Depend only on the camera itself (sensor + lens) and don&apos;t
              change when you move the camera: <M>{"f_x, f_y"}</M> (focal length
              in pixels), <M>{"c_x, c_y"}</M> (principal point: where the
              optical axis crosses the image, not necessarily the exact center),
              and the distortion coefficients <M>{"k_1, k_2, p_1, p_2, k_3"}</M>
              . OpenCV splits them into two variables, <code>cameraMatrix</code>{" "}
              and <code>distCoeffs</code>, but both are intrinsics. Change the
              focus or zoom and the intrinsics change.
            </>,
          )}
        </dd>
        <dt>{t("外參（extrinsic）", "Extrinsics")}</dt>
        <dd>
          {t(
            <>
              相機相對於「某個參考座標」的姿態：旋轉 <M>{"R"}</M>（3
              個自由度，OpenCV 用 3 個數的 <code>rvec</code> 表示，方向 =
              旋轉軸、長度 = 角度，用 <code>cv.Rodrigues</code> 與 3×3
              矩陣互換）與平移 <M>{"t"}</M>。
            </>,
            <>
              The camera&apos;s pose relative to some reference frame: a
              rotation <M>{"R"}</M> (3 degrees of freedom; OpenCV represents it
              as a 3-number <code>rvec</code> whose direction = rotation axis
              and length = angle, converted to and from a 3×3 matrix with{" "}
              <code>cv.Rodrigues</code>) and a translation <M>{"t"}</M>.
            </>,
          )}
        </dd>
        <dt>{t("t 不是相機的位置", "t is not the camera's position")}</dt>
        <dd>
          {t(
            <>
              <M>{"X_c = R\\,X_w + t"}</M>{" "}
              的意思是「把世界座標的點換到相機座標」。相機中心在世界座標的位置是{" "}
              <M>{"C = -R^\\top t"}</M>。第 2 站的實驗 A 表格會同時列出兩者。
            </>,
            <>
              <M>{"X_c = R\\,X_w + t"}</M> means “take a point in world
              coordinates into camera coordinates.” The camera center in world
              coordinates is <M>{"C = -R^\\top t"}</M>. The Lab A table in
              Station 2 lists both.
            </>,
          )}
        </dd>
        <dt>{t("座標慣例", "Coordinate conventions")}</dt>
        <dd>
          {t(
            "OpenCV 相機座標：x 向右、y 向下、z 沿光軸朝前；像素 (0, 0) 在左上角。",
            "OpenCV camera coordinates: x to the right, y down, z forward along the optical axis; pixel (0, 0) is at the top-left corner.",
          )}
        </dd>
      </dl>
      <p>
        {t(
          <>
            有了兩台裝置（Camera + Projector）的模型與它們之間的 R,
            t，一組對應點 <M>{"(u_c, v_c) \\leftrightarrow (u_p, v_p)"}</M>{" "}
            就各自定義一條射線，兩條射線的交點就是 3D
            點：這就是三角量測（triangulation）。
          </>,
          <>
            With models of both devices (Camera + Projector) and the R, t
            between them, each correspondence{" "}
            <M>{"(u_c, v_c) \\leftrightarrow (u_p, v_p)"}</M> defines one ray
            per device, and the intersection of the two rays is the 3D point:
            this is triangulation.
          </>,
        )}
      </p>
    </section>
  );
}

export function DistortionSection() {
  return (
    <section id="distortion">
      <h2>{t("鏡頭畸變", "Lens distortion")}</h2>
      <p>
        {t(
          "真實鏡頭不是完美針孔。OpenCV 的模型在正規化座標上加兩種修正：",
          "Real lenses aren't perfect pinholes. OpenCV's model adds two kinds of correction in normalized coordinates:",
        )}
      </p>
      <MathBlock>
        {t(
          String.raw`
\begin{aligned}
r^2 &= x^2 + y^2 \\[4pt]
x_d &= x\,\underbrace{\left(1 + k_1 r^2 + k_2 r^4 + k_3 r^6\right)}_{\text{徑向 radial}}
  + \underbrace{2p_1\,xy + p_2\left(r^2 + 2x^2\right)}_{\text{切向 tangential}} \\[4pt]
y_d &= y\left(1 + k_1 r^2 + k_2 r^4 + k_3 r^6\right) + p_1\left(r^2 + 2y^2\right) + 2p_2\,xy
\end{aligned}`,
          String.raw`
\begin{aligned}
r^2 &= x^2 + y^2 \\[4pt]
x_d &= x\,\underbrace{\left(1 + k_1 r^2 + k_2 r^4 + k_3 r^6\right)}_{\text{radial}}
  + \underbrace{2p_1\,xy + p_2\left(r^2 + 2x^2\right)}_{\text{tangential}} \\[4pt]
y_d &= y\left(1 + k_1 r^2 + k_2 r^4 + k_3 r^6\right) + p_1\left(r^2 + 2y^2\right) + 2p_2\,xy
\end{aligned}`,
        )}
      </MathBlock>
      <ul>
        <li>
          {t(
            <>
              徑向畸變：直線在影像上彎曲；離中心越遠（<M>{"r"}</M>{" "}
              越大）越嚴重。所以校正時必須讓角點出現在影像邊緣和角落。
            </>,
            <>
              Radial distortion: straight lines bend in the image, more severely
              the farther they are from the center (larger <M>{"r"}</M>).
              That&apos;s why your corners must reach the edges and corners of
              the image during calibration.
            </>,
          )}
        </li>
        <li>
          {t(
            "切向畸變：鏡片與感測器不完全平行造成，通常很小。",
            "Tangential distortion: caused by the lens and sensor not being perfectly parallel; usually small.",
          )}
        </li>
        <li>
          {t(
            "畸變屬於內參。只要鏡頭與對焦不變，它就不變。",
            "Distortion is part of the intrinsics. As long as the lens and focus stay the same, so does the distortion.",
          )}
        </li>
      </ul>
      <DistortionDemo />
    </section>
  );
}

export function ExtrinsicsSection() {
  return (
    <section id="extrinsics">
      <h2>{t("三種外參", "Three kinds of extrinsics")}</h2>
      <p>
        {t(
          "「外參」一定是「誰相對於誰」。結構光系統裡會遇到三種，最容易混淆：",
          "Extrinsics always describe “who relative to whom.” A structured-light system involves three kinds, and they're easy to mix up:",
        )}
      </p>
      <table className="calib-table">
        <thead>
          <tr>
            <th></th>
            <th>{t("描述的關係", "Relationship")}</th>
            <th>{t("從哪裡來", "Where it comes from")}</th>
            <th>OpenCV</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{t("① 每張照片的板子姿態", "① Board pose in each image")}</td>
            <td>{t("校正板 → Camera", "Calibration board → Camera")}</td>
            <td>
              {t(
                "校正時每張照片一組，副產品（第 2 站）",
                "One per image during calibration, as a by-product (Station 2)",
              )}
            </td>
            <td>
              {t(
                <>
                  <code>calibrateCamera</code> 的 <code>rvecs, tvecs</code>
                </>,
                <>
                  <code>rvecs, tvecs</code> from <code>calibrateCamera</code>
                </>,
              )}
            </td>
          </tr>
          <tr>
            <td>② Camera–Projector</td>
            <td>Camera → Projector</td>
            <td>
              {t(
                "由兩邊的 ① 組合，再聯合最佳化（第 5 站）",
                "Combined from ① on both sides, then jointly optimized (Station 5)",
              )}
            </td>
            <td>
              {t(
                <>
                  <code>stereoCalibrate</code> 的 <code>R, T</code>
                </>,
                <>
                  <code>R, T</code> from <code>stereoCalibrate</code>
                </>,
              )}
            </td>
          </tr>
          <tr>
            <td>{t("③ 裝置 → 世界", "③ Device → world")}</td>
            <td>{t("Camera → 平台 / 世界", "Camera → stage / world")}</td>
            <td>
              {t(
                "平放的校正板或參考物（第 8 站）",
                "A calibration board laid flat, or reference objects (Station 8)",
              )}
            </td>
            <td>
              <code>solvePnP</code>
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        {t(
          <>
            三角量測只需要 ②，點雲會在 Camera
            座標裡。要談「高度」、或合併多台裝置的資料，就需要 ③。
          </>,
          <>
            Triangulation needs only ②, and the point cloud ends up in Camera
            coordinates. To talk about “height” or to merge data from several
            devices, you need ③.
          </>,
        )}
      </p>
    </section>
  );
}

export function CameraCalibrationSection() {
  return (
    <section id="camera">
      <h2>Camera Calibration</h2>
      <p>
        {t(
          <>
            為什麼用棋盤格？角點在板上的 3D 座標已知（全部在 <M>{"Z = 0"}</M>{" "}
            平面，間距 = 格子大小），而且角點可以偵測到次像素精度。
          </>,
          <>
            Why a chessboard? The 3D coordinates of its corners on the board are
            known (all on the <M>{"Z = 0"}</M> plane, spaced by the square
            size), and corners can be detected with subpixel accuracy.
          </>,
        )}
      </p>
      <h3>{t("流程", "Workflow")}</h3>
      <ol>
        <li>
          {t(
            <>
              準備 object points：9 × 6 個內角點 →{" "}
              <M>{"(0,0,0),\\ (s,0,0),\\ \\dots,\\ (8s,5s,0)"}</M>。
              <b>
                格子大小 <M>{"s"}</M> 決定之後所有 <M>{"t"}</M> 與點雲的單位
              </b>
              。
            </>,
            <>
              Prepare the object points: 9 × 6 inner corners →{" "}
              <M>{"(0,0,0),\\ (s,0,0),\\ \\dots,\\ (8s,5s,0)"}</M>.{" "}
              <b>
                The square size <M>{"s"}</M> sets the units of every{" "}
                <M>{"t"}</M> and of the point cloud from here on
              </b>
              .
            </>,
          )}
        </li>
        <li>
          {t(
            <>
              每張影像用 <code>findChessboardCorners</code> 找角點，再用{" "}
              <code>cornerSubPix</code> 精修到次像素。
            </>,
            <>
              Find the corners in each image with{" "}
              <code>findChessboardCorners</code>, then refine them to subpixel
              accuracy with <code>cornerSubPix</code>.
            </>,
          )}
        </li>
        <li>
          {t(
            <>
              <code>calibrateCamera</code>：一次估出 K、畸變，以及每張照片的
              rvec、tvec（第 ① 種外參）。
            </>,
            <>
              <code>calibrateCamera</code>: estimates K, the distortion, and
              each image&apos;s rvec and tvec (extrinsics of kind ①) in one go.
            </>,
          )}
        </li>
        <li>
          {t(
            "檢查重投影誤差：把 3D 角點用估出的參數投回影像，和偵測到的角點比較。",
            "Check the reprojection error: project the 3D corners back into the image with the estimated parameters and compare them with the detected corners.",
          )}
        </li>
        <li>
          {t(
            <>
              使用：<code>undistort</code> 對整張影像去畸變，或{" "}
              <code>undistortPoints</code> 只處理點。
            </>,
            <>
              Use it: <code>undistort</code> removes distortion from a whole
              image, or <code>undistortPoints</code> handles just points.
            </>,
          )}
        </li>
      </ol>
      <Code>
        {t(
          `
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
`,
          `
import numpy as np, cv2 as cv, glob

pattern = (9, 6)                    # inner corners: 9 per row, 6 rows
square = 20.0                       # square side (mm) → sets the units of t and the point cloud
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
# rms  : RMS reprojection error over all corners (px)
# K    : 3x3 cameraMatrix; dist = [k1, k2, p1, p2, k3]
# rvecs, tvecs : per-image "board → Camera" extrinsics
`,
        )}
      </Code>
      <Code>
        {t(
          `
# 單張的重投影誤差
proj, _ = cv.projectPoints(objpoints[i], rvecs[i], tvecs[i], K, dist)
err = np.sqrt(np.mean(np.sum((imgpoints[i] - proj) ** 2, axis=2)))

# 相機在板子座標中的位置：C = -R^T t（不是 tvecs[i]）
R, _ = cv.Rodrigues(rvecs[i])
C = -R.T @ tvecs[i]

# 去畸變
undistorted = cv.undistort(img, K, dist)
xn = cv.undistortPoints(pts, K, dist)   # 回傳正規化座標 (x, y)
`,
          `
# reprojection error of a single image
proj, _ = cv.projectPoints(objpoints[i], rvecs[i], tvecs[i], K, dist)
err = np.sqrt(np.mean(np.sum((imgpoints[i] - proj) ** 2, axis=2)))

# camera position in board coordinates: C = -R^T t (not tvecs[i])
R, _ = cv.Rodrigues(rvecs[i])
C = -R.T @ tvecs[i]

# undistort
undistorted = cv.undistort(img, K, dist)
xn = cv.undistortPoints(pts, K, dist)   # returns normalized coordinates (x, y)
`,
        )}
      </Code>
      <h3>
        {t(
          "內部做了什麼（知道概念即可）",
          "What happens inside (the concept is enough)",
        )}
      </h3>
      <ul>
        <li>
          {t(
            <>
              平面板（<M>{"Z = 0"}</M>）與影像之間是一個
              Homography，每張照片可以估出一個
              <M>{"H"}</M>：
            </>,
            <>
              Between the planar board (<M>{"Z = 0"}</M>) and the image
              there&apos;s a homography, so each image gives you one{" "}
              <M>{"H"}</M>:
            </>,
          )}
          <MathBlock>{String.raw`
s \begin{bmatrix} u \\ v \\ 1 \end{bmatrix}
= \underbrace{K \begin{bmatrix} r_1 & r_2 & t \end{bmatrix}}_{H}
\begin{bmatrix} X \\ Y \\ 1 \end{bmatrix}`}</MathBlock>
        </li>
        <li>
          {t(
            <>
              Zhang 法：因為旋轉矩陣的前兩欄必須滿足 <M>{"r_1 \\perp r_2"}</M>{" "}
              且 <M>{"\\lVert r_1 \\rVert = \\lVert r_2 \\rVert"}</M>
              ，每個 <M>{"H"}</M> 提供 2 個關於 <M>{"K"}</M>{" "}
              的方程式；多張照片就能解出 <M>{"K"}</M> 的初值（實驗 A
              表格的「Zhang 初值」欄）。
            </>,
            <>
              Zhang&apos;s method: because the first two columns of a rotation
              matrix must satisfy <M>{"r_1 \\perp r_2"}</M> and{" "}
              <M>{"\\lVert r_1 \\rVert = \\lVert r_2 \\rVert"}</M>, each{" "}
              <M>{"H"}</M> gives 2 equations in <M>{"K"}</M>; with several
              images you can solve for an initial <M>{"K"}</M> (the “Zhang
              initial” column in the Lab A table).
            </>,
          )}
        </li>
        <li>
          {t(
            <>
              有了 <M>{"K"}</M>，就能從每個 <M>{"H"}</M> 拆出該張的{" "}
              <M>{"R, t"}</M>
              。最後用 Levenberg–Marquardt 同時微調 <M>{"K"}</M>
              、畸變與所有姿態，讓重投影誤差最小——畸變在這一步才被估計：
            </>,
            <>
              With <M>{"K"}</M>, you can decompose each <M>{"H"}</M> into that
              image&apos;s <M>{"R, t"}</M>. Finally, Levenberg–Marquardt jointly
              refines <M>{"K"}</M>, the distortion, and all the poses to
              minimize the reprojection error; the distortion is estimated only
              at this step:
            </>,
          )}
          <MathBlock>{String.raw`
\min_{K,\ \text{dist},\ \{R_i, t_i\}} \;
\sum_{i}\sum_{j} \left\lVert\, \mathbf{u}_{ij} - \pi\!\left(K, \text{dist}, R_i, t_i, \mathbf{X}_j\right) \right\rVert^2`}</MathBlock>
          {t(
            <>
              <M>{"\\mathbf{u}_{ij}"}</M> 是第 <M>{"i"}</M> 張影像偵測到的第{" "}
              <M>{"j"}</M> 個角點，<M>{"\\pi(\\cdot)"}</M> 就是第 1
              站的投影模型。回傳的 RMS 就是這個總和除以角點數再開根號。
            </>,
            <>
              <M>{"\\mathbf{u}_{ij}"}</M> is the <M>{"j"}</M>-th corner detected
              in image <M>{"i"}</M>, and <M>{"\\pi(\\cdot)"}</M> is the
              projection model from Station 1. The returned RMS is the square
              root of this sum divided by the number of corners.
            </>,
          )}
        </li>
      </ul>
      <h3>{t("拍照要點", "Tips for capturing images")}</h3>
      <ul>
        <li>
          {t(
            <>
              10–20 張；板子要有明顯傾斜（約
              20–45°）。只有正對的照片無法把焦距和距離分開。
            </>,
            <>
              10–20 images, with the board clearly tilted (about 20–45°). Images
              that only face the camera head-on can&apos;t separate focal length
              from distance.
            </>,
          )}
        </li>
        <li>
          {t(
            "讓角點分布到影像四周與角落，畸變才估得準。",
            "Spread the corners out to the edges and corners of the image so the distortion is estimated accurately.",
          )}
        </li>
        <li>
          {t(
            "對焦清楚、不過曝、板子平整；格子大小用卡尺量準。",
            "Keep the focus sharp, avoid overexposure, and keep the board flat; measure the square size accurately with calipers.",
          )}
        </li>
        <li>
          {t(
            "校正後不要再動對焦環與光圈；動了就要重新校正。",
            "Don't touch the focus ring or aperture after calibration; if you do, calibrate again.",
          )}
        </li>
      </ul>
      <h3>{t("判讀", "Interpreting the results")}</h3>
      <ul>
        <li>
          {t(
            <>
              RMS 重投影誤差一般在 0.1–0.5
              px。某張特別大時，通常是角點偵測錯誤，剔除後重算。
            </>,
            <>
              The RMS reprojection error is typically 0.1–0.5 px. If one image
              is much worse, it&apos;s usually a corner detection error: drop it
              and recalibrate.
            </>,
          )}
        </li>
        <li>
          {t(
            <>
              <b>RMS 小不等於校正正確。</b>
              它只代表模型能「解釋」這些角點。姿態太單一、格子大小填錯時，RMS
              照樣很小（實驗 A 會親眼看到）。最終要用已知尺寸的量規實測。
            </>,
            <>
              <b>A small RMS doesn&apos;t mean the calibration is correct.</b>{" "}
              It only means the model can “explain” these corners. With too
              little pose variety or a wrong square size, the RMS stays small
              anyway (you&apos;ll see this for yourself in Lab A). In the end,
              verify with a gauge of known size.
            </>,
          )}
        </li>
      </ul>
    </section>
  );
}

export function ProjectorCalibrationSection() {
  return (
    <section id="projector">
      <h2>Projector Calibration</h2>
      <p>
        {t(
          <>
            Projector 在光學上就是「反向的相機」：同樣有 K
            與畸變，只是光往外射。所以它可以用同一套{" "}
            <code>calibrateCamera</code>
            校正——前提是知道每個棋盤角點落在 Projector 影像的哪個像素。
          </>,
          <>
            Optically, a Projector is an “inverse camera”: it has a K and
            distortion too, it just sends light outward. So you can calibrate it
            with the same <code>calibrateCamera</code>, as long as you know
            which Projector image pixel each chessboard corner falls on.
          </>,
        )}
      </p>
      <h3>
        {t(
          "Projector 不能拍照，那角點座標從哪來？",
          "A Projector can't take pictures, so where do the corner coordinates come from?",
        )}
      </h3>
      <p>
        {t(
          "用結構光替它「看」。在每一個板子姿態：",
          "Use structured light to “see” for it. At each board pose:",
        )}
      </p>
      <ol>
        <li>
          {t(
            "Camera 拍一張普通照片，偵測棋盤角點（跟 Camera 校正同一批照片）。",
            "The Camera takes a regular image and detects the chessboard corners (the same images used for Camera calibration).",
          )}
        </li>
        <li>
          {t(
            <>
              Projector 投<b>垂直</b>與<b>水平</b>兩組條紋，用第 3–4 站的 Phase
              Shifting + Unwrapping 求出每個 Camera 像素的絕對相位{" "}
              <M>{"\\Phi_x, \\Phi_y"}</M>。
            </>,
            <>
              The Projector projects two sets of fringes, <b>vertical</b> and{" "}
              <b>horizontal</b>, and phase shifting + unwrapping from Stations
              3–4 recover the absolute phase <M>{"\\Phi_x, \\Phi_y"}</M> at
              every Camera pixel.
            </>,
          )}
        </li>
        <li>
          {t(
            <>
              在角點位置讀相位，換成 Projector 像素（<M>{"f"}</M> = 條紋週期數，
              <M>{"W_p, H_p"}</M> = Projector 解析度）：
            </>,
            <>
              Read the phase at each corner and convert it to Projector pixels (
              <M>{"f"}</M> = number of fringe periods, <M>{"W_p, H_p"}</M> =
              Projector resolution):
            </>,
          )}
          <MathBlock>{String.raw`
u_p = \frac{\Phi_x}{2\pi f}\, W_p, \qquad v_p = \frac{\Phi_y}{2\pi f}\, H_p`}</MathBlock>
        </li>
      </ol>
      <p>
        {t(
          <>
            掃描時只需要一個方向的條紋（沙盒就是只用 <M>{"u_p"}</M> 的 ray–plane
            三角量測），但<b>校正 Projector 需要兩個方向</b>，因為它的 2D
            模型需要 <M>{"(u_p, v_p)"}</M>。相位的雜訊會直接變成 Projector
            角點的雜訊。
          </>,
          <>
            Scanning needs fringes in only one direction (the sandbox does
            ray–plane triangulation using only <M>{"u_p"}</M>), but{" "}
            <b>calibrating the Projector needs both directions</b>, because its
            2D model needs <M>{"(u_p, v_p)"}</M>. Phase noise turns directly
            into noise in the Projector corners.
          </>,
        )}
      </p>
      <p>
        {t(
          <>
            Projector 的常見特性：主點不在中央。多數 DLP 採 offset 光學，
            <M>{"c_y"}</M> 接近影像下緣，畫面往上投（實驗 B 的真值{" "}
            <M>{"c_y = 740"}</M>，影像高 768）。
          </>,
          <>
            A common Projector trait: the principal point isn&apos;t centered.
            Most DLP projectors use offset optics, so <M>{"c_y"}</M> sits near
            the bottom edge of the image and the picture is thrown upward (in
            Lab B the true value is <M>{"c_y = 740"}</M> with an image height of
            768).
          </>,
        )}
      </p>
      <Code>
        {t(
          `
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
`,
          `
# Phi_x, Phi_y: absolute phase maps solved for this pose (float32, same size as the Camera image)
mx = corners[:, :, 0].astype(np.float32)        # subpixel corner coordinates
my = corners[:, :, 1].astype(np.float32)
up = cv.remap(Phi_x, mx, my, cv.INTER_LINEAR) * Wp / (2 * np.pi * f)
vp = cv.remap(Phi_y, mx, my, cv.INTER_LINEAR) * Hp / (2 * np.pi * f)
projpoints.append(np.dstack([up, vp]).astype(np.float32))

# the Projector's own intrinsics
rms_p, Kp, dist_p, _, _ = cv.calibrateCamera(
    objpoints, projpoints, (Wp, Hp), None, None)

# Camera–Projector extrinsics (kind ②): X_p = R @ X_c + T
rms_s, _, _, _, _, R, T, E, F = cv.stereoCalibrate(
    objpoints, imgpoints, projpoints, K, dist, Kp, dist_p, (W, H),
    flags=cv.CALIB_FIX_INTRINSIC)
`,
        )}
      </Code>
      <p>
        {t(
          <>
            注意方向：<code>stereoCalibrate</code> 的 <M>{"R, T"}</M> 是「Camera
            座標 → Projector 座標」。<M>{"T"}</M> 不是 Projector 的位置，位置是{" "}
            <M>{"-R^\\top T"}</M>。每一個姿態其實都能單獨算出一組{" "}
            <M>{"R, T"}</M>
            ，但會因雜訊而分散；<code>stereoCalibrate</code>{" "}
            用所有姿態一起最佳化。
          </>,
          <>
            Watch the direction: the <M>{"R, T"}</M> from{" "}
            <code>stereoCalibrate</code> go from Camera coordinates to Projector
            coordinates. <M>{"T"}</M> is not the Projector&apos;s position; the
            position is <M>{"-R^\\top T"}</M>. Each pose could give its own{" "}
            <M>{"R, T"}</M>, but noise would scatter them;{" "}
            <code>stereoCalibrate</code> optimizes over all poses together.
          </>,
        )}
      </p>
    </section>
  );
}

export function TriangulationSection() {
  return (
    <section id="triangulation">
      <h2>{t("有了 R, T 就能三角量測", "With R, T you can triangulate")}</h2>
      <p>
        {t(
          <>
            第 5 站得到的 Camera–Projector 外參，把兩台裝置放進同一個座標。每個
            Camera 像素的相位告訴我們它對到 Projector
            的哪一點，兩條射線的交點就是 3D 點：
          </>,
          <>
            The Camera–Projector extrinsics from Station 5 put both devices in
            the same coordinate frame. The phase at each Camera pixel tells you
            which Projector point it corresponds to, and the intersection of the
            two rays is the 3D point:
          </>,
        )}
      </p>
      <MathBlock>
        {t(
          String.raw`
X_p = R\,X_c + T, \qquad
C_p = -R^\top T \;\;(\text{Projector 在 Camera 座標中的位置})`,
          String.raw`
X_p = R\,X_c + T, \qquad
C_p = -R^\top T \;\;(\text{Projector position in Camera coordinates})`,
        )}
      </MathBlock>
      <Code>
        {t(
          `
xc = cv.undistortPoints(cam_px, K, dist).reshape(-1, 2).T     # 正規化座標
xp = cv.undistortPoints(proj_px, Kp, dist_p).reshape(-1, 2).T
P1 = np.hstack([np.eye(3), np.zeros((3, 1))])                 # Camera = 參考
P2 = np.hstack([R, T])
Xh = cv.triangulatePoints(P1, P2, xc, xp)
X = (Xh[:3] / Xh[3]).T                                        # Camera 座標 (mm)
`,
          `
xc = cv.undistortPoints(cam_px, K, dist).reshape(-1, 2).T     # normalized coordinates
xp = cv.undistortPoints(proj_px, Kp, dist_p).reshape(-1, 2).T
P1 = np.hstack([np.eye(3), np.zeros((3, 1))])                 # Camera = reference
P2 = np.hstack([R, T])
Xh = cv.triangulatePoints(P1, P2, xc, xp)
X = (Xh[:3] / Xh[3]).T                                        # Camera coordinates (mm)
`,
        )}
      </Code>
      <p>
        {t(
          <>
            掃描只投一個方向的條紋時，只知道 <M>{"u_p"}</M>
            ，對應的是 Projector 的一個光平面而不是一條射線；這時改用 ray–plane
            三角量測：Camera 射線與該光平面的交點。3D 沙盒就是這樣重建的。
          </>,
          <>
            When a scan projects fringes in only one direction, you only know{" "}
            <M>{"u_p"}</M>, which corresponds to a plane of light from the
            Projector rather than a ray. In that case, use ray–plane
            triangulation: the intersection of the Camera ray with that light
            plane. This is how the 3D sandbox reconstructs.
          </>,
        )}
      </p>
      <p>
        {t(
          <>
            重建出的點雲在 Camera 座標。哪些像素會失效、誤差從哪裡來，到 3D
            沙盒的「點雲分析」看：背景、未照明、clipping、調變過低、三角量測無效，各自有不同的原因。
          </>,
          <>
            The reconstructed point cloud is in Camera coordinates. To see which
            pixels fail and where the errors come from, check “Point-cloud
            analysis” in the 3D sandbox: background, unlit, clipping, low
            modulation, and invalid triangulation each have different causes.
          </>,
        )}
      </p>
    </section>
  );
}

export function RegistrationSection() {
  return (
    <section id="registration">
      <h2>{t("座標統合", "Coordinate registration")}</h2>
      <p>
        {t(
          <>
            三角量測出來的點雲在 <b>Camera 座標</b>：原點是鏡頭中心，z
            沿光軸。這帶來兩個問題：「高度」沒有意義（z
            是離相機的距離，不是離平台的高度）；兩台 Scanner
            的點雲各在自己的座標，不能直接合併。
          </>,
          <>
            A triangulated point cloud is in <b>Camera coordinates</b>: the
            origin is the lens center and z runs along the optical axis. That
            causes two problems: “height” has no meaning (z is the distance from
            the camera, not the height above the stage), and the point clouds
            from two Scanners each live in their own frame, so you can&apos;t
            merge them directly.
          </>,
        )}
      </p>
      <p>
        {t(
          <>
            解法是第 ③ 種外參：決定一個<b>世界座標</b>（通常：平台面，Z 朝上，Z
            = 0 = 平台面 = 高度零點），再求每台裝置的 Camera → 世界轉換：
          </>,
          <>
            The fix is extrinsics of kind ③: choose a <b>world frame</b>{" "}
            (usually the stage surface, with Z up and Z = 0 = stage surface =
            height zero), then find each device&apos;s Camera → world transform:
          </>,
        )}
      </p>
      <MathBlock>
        {t(
          String.raw`
X_w = R^\top \left(X_c - t\right) \qquad (R, t:\ \text{世界} \rightarrow \text{Camera})`,
          String.raw`
X_w = R^\top \left(X_c - t\right) \qquad (R, t:\ \text{world} \rightarrow \text{Camera})`,
        )}
      </MathBlock>
      <h3>
        {t(
          "方法 A：校正板 + solvePnP",
          "Method A: calibration board + solvePnP",
        )}
      </h3>
      <p>
        {t(
          <>
            把校正板平放在平台上，每台相機各拍一張，用已知的 K 求出板子 → 相機的
            R, t。板子同時定義了原點、XY 方向與高度零點。之後移開板子再放物體。
          </>,
          <>
            Lay the calibration board flat on the stage, take one image with
            each camera, and use the known K to find the board → camera R, t.
            The board defines the origin, the XY directions, and the height zero
            all at once. Then remove the board and place the object.
          </>,
        )}
      </p>
      <Code>
        {t(
          `
ok, rvec, tvec = cv.solvePnP(objp, corners, K, dist)   # 板子 → Camera
R, _ = cv.Rodrigues(rvec)
X_world = (R.T @ (X_cam.T - tvec)).T                   # 每台各自換到世界座標
`,
          `
ok, rvec, tvec = cv.solvePnP(objp, corners, K, dist)   # board → Camera
R, _ = cv.Rodrigues(rvec)
X_world = (R.T @ (X_cam.T - tvec)).T                   # each device converts to world coordinates
`,
        )}
      </Code>
      <h3>
        {t(
          "方法 B：已知位置的參考物 + 剛體對齊",
          "Method B: reference objects at known positions + rigid alignment",
        )}
      </h3>
      <p>
        {t(
          <>
            在平台上放幾顆位置已知的參考球（或標記）。每台 Scanner
            量出球心（Camera 座標）<M>{"a_i"}</M>
            ，再求一個剛體轉換讓它們對上已知的世界座標 <M>{"b_i"}</M>（Kabsch /
            Umeyama，用 SVD 解）。至少 3 個不共線的點；點越分散，旋轉越準。
          </>,
          <>
            Place a few reference spheres (or markers) at known positions on the
            stage. Each Scanner measures the sphere centers <M>{"a_i"}</M> (in
            Camera coordinates); then you find a rigid transform that maps them
            onto the known world coordinates <M>{"b_i"}</M> (Kabsch / Umeyama,
            solved with SVD). You need at least 3 non-collinear points; the more
            spread out they are, the more accurate the rotation.
          </>,
        )}
      </p>
      <MathBlock>{String.raw`
\min_{R,\ t} \; \sum_i \left\lVert R\,a_i + t - b_i \right\rVert^2`}</MathBlock>
      <Code>
        {t(
          `
def rigid_transform(A, B):          # 找 R, t 使 R @ a + t ≈ b（A, B: N x 3）
    ca, cb = A.mean(0), B.mean(0)
    U, S, Vt = np.linalg.svd((A - ca).T @ (B - cb))
    D = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
    R = Vt.T @ D @ U.T
    return R, cb - R @ ca

R_wc, t_wc = rigid_transform(centers_cam, centers_world)
X_world = X_cam @ R_wc.T + t_wc
`,
          `
def rigid_transform(A, B):          # find R, t so that R @ a + t ≈ b (A, B: N x 3)
    ca, cb = A.mean(0), B.mean(0)
    U, S, Vt = np.linalg.svd((A - ca).T @ (B - cb))
    D = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
    R = Vt.T @ D @ U.T
    return R, cb - R @ ca

R_wc, t_wc = rigid_transform(centers_cam, centers_world)
X_world = X_cam @ R_wc.T + t_wc
`,
        )}
      </Code>
      <h3>
        {t(
          "方法 C：點雲直接對齊（ICP）",
          "Method C: aligning point clouds directly (ICP)",
        )}
      </h3>
      <p>
        {t(
          <>
            沒有已知參考物時，可以讓兩團點雲在重疊區直接對齊（例如 Open3D 的{" "}
            <code>registration_icp</code>
            ）。它需要不錯的初值與足夠的重疊，通常拿來微調 A、B
            的結果，而不是取代它們。
          </>,
          <>
            Without known reference objects, you can align the two point clouds
            directly in their overlap (for example with Open3D&apos;s{" "}
            <code>registration_icp</code>). It needs a decent initial guess and
            enough overlap, so it&apos;s usually used to refine the results of A
            or B rather than replace them.
          </>,
        )}
      </p>
      <h3>{t("誤差會被距離放大", "Distance amplifies errors")}</h3>
      <MathBlock>
        {t(
          String.raw`
\Delta \approx L \cdot \theta_{\text{rad}}, \qquad
\text{例：}\ 400\,\text{mm} \times 0.1^\circ \times \tfrac{\pi}{180} \approx 0.7\,\text{mm}`,
          String.raw`
\Delta \approx L \cdot \theta_{\text{rad}}, \qquad
\text{e.g.}\ 400\,\text{mm} \times 0.1^\circ \times \tfrac{\pi}{180} \approx 0.7\,\text{mm}`,
        )}
      </MathBlock>
      <p>
        {t(
          <>
            平移誤差直接變成位移；角度誤差則乘上工作距離 <M>{"L"}</M>
            。沒有真值時，用兩個方法檢查：平台面重建後的高度應為
            0；兩台在重疊區的點雲應該互相貼合（實驗 C 的「一致性」）。
          </>,
          <>
            A translation error becomes a displacement directly; an angle error
            gets multiplied by the working distance <M>{"L"}</M>. Without ground
            truth, check in two ways: the reconstructed stage surface should
            have height 0, and the two point clouds should fit each other in the
            overlap (the “consistency” in Lab C).
          </>,
        )}
      </p>
    </section>
  );
}

export function FusionSection() {
  return (
    <section id="fusion">
      <h2>{t("多視角 Fusion", "Multi-view fusion")}</h2>
      <p>
        {t(
          <>
            這一站一開始就架多台裝置：前面已經有單套裝置的點雲，現在讓 1–8 台
            Camera 與 Projector 從不同方向看同一塊板子。每一組 Camera +
            Projector 稱為一個 Pair；各 Pair 先各自重建，再在同一個 ROI
            格網上合併。
          </>,
          <>
            This station starts with multiple devices: you already have a point
            cloud from a single setup, and now 1–8 Cameras and Projectors look
            at the same board from different directions. Each Camera + Projector
            combination is called a Pair; each Pair reconstructs on its own, and
            the results are merged on a shared ROI grid.
          </>,
        )}
      </p>
      <h3>
        {t(
          "每個 Pair 能量多高、多準",
          "How high and how precisely each Pair can measure",
        )}
      </h3>
      <p>
        {t(
          <>
            相位對高度的靈敏度決定一個週期對應多少高度，也決定雜訊會被放大多少（平行近似，
            <M>{"p"}</M> 為條紋週期、<M>{"\\theta_p, \\theta_c"}</M>{" "}
            為兩台裝置的傾角、
            <M>{"\\Delta\\alpha"}</M> 為方位差）：
          </>,
          <>
            The phase-to-height sensitivity determines how much height one
            period covers and how much noise gets amplified (parallel
            approximation; <M>{"p"}</M> is the fringe period,{" "}
            <M>{"\\theta_p, \\theta_c"}</M> are the tilt angles of the two
            devices, and <M>{"\\Delta\\alpha"}</M> is the azimuth difference):
          </>,
        )}
      </p>
      <MathBlock>{String.raw`
\left|\frac{d\varphi}{dh}\right| = \frac{2\pi}{p}\,\bigl|\tan\theta_p - \tan\theta_c\cos\Delta\alpha\bigr|,
\qquad
\sigma_\varphi = \frac{\sigma_I\sqrt{2/N}}{B},
\qquad
\sigma_h = \frac{\sigma_\varphi}{\left|d\varphi/dh\right|}`}</MathBlock>
      <p>
        {t(
          <>
            單週期量測範圍等於「每 2π 對應的高度」；超出範圍會混疊。靈敏度越高，
            高度雜訊越小，但量測範圍也越短：設計 Pair 時兩者要一起看。
          </>,
          <>
            The single-period measurement range equals “the height per 2π”;
            beyond it, heights alias. Higher sensitivity means less height noise
            but also a shorter measurement range, so weigh both when you design
            a Pair.
          </>,
        )}
      </p>
      <h3>
        {t(
          "三種 Fusion 策略（都不使用真值）",
          "Three fusion strategies (none uses ground truth)",
        )}
      </h3>
      <ul>
        <li>
          {t(
            "① 直視 + 斜視補洞：以直視為主，直視失效的格子由斜視補上。",
            "① Top view + oblique fill-in: the top view is primary, and oblique views fill in the cells where the top view fails.",
          )}
        </li>
        <li>
          {t(
            "② 單一斜視：只用一個 Pair，作為比較基準。",
            "② Single oblique view: uses just one Pair, as a baseline for comparison.",
          )}
        </li>
        <li>
          {t(
            <>
              ③ 斜視 + 斜視共識融合：與最多 Pair 一致的值勝出，剔除離群後以{" "}
              <M>{"1/\\sigma_h^2"}</M> 加權；<M>{"\\sigma_h"}</M> 來自各 Pair
              自己的調變 B、感測器雜訊規格與 <M>{"|d\\varphi/dh|"}</M>。
            </>,
            <>
              ③ Oblique + oblique consensus fusion: the value that agrees with
              the most Pairs wins; after outliers are rejected, values are
              weighted by <M>{"1/\\sigma_h^2"}</M>, where <M>{"\\sigma_h"}</M>{" "}
              comes from each Pair&apos;s own modulation B, the sensor noise
              spec, and <M>{"|d\\varphi/dh|"}</M>.
            </>,
          )}
        </li>
      </ul>
      <p>
        {t(
          <>
            Cross-pair Consistency Check 列出兩兩 Pair 的高度差；真值只在
            Benchmark
            裡用來驗證「一致／矛盾」格的實際誤差。理想模擬的精度不代表實機 AOI
            性能。
          </>,
          <>
            The Cross-pair Consistency Check lists the height differences
            between every two Pairs; ground truth is used only in the Benchmark,
            to verify the actual error of “consistent / conflicting” cells.
            Accuracy in an idealized simulation doesn&apos;t represent real AOI
            performance.
          </>,
        )}
      </p>
    </section>
  );
}

export function PitfallsSection() {
  return (
    <section id="pitfalls">
      <h2>{t("常見錯誤清單", "Common mistakes")}</h2>
      <ul className="calib-pitfalls">
        <li>
          {t(
            "格子大小填錯 → 整個點雲等比例縮放，RMS 看不出來。",
            "Wrong square size → the whole point cloud is scaled uniformly, and the RMS won't show it.",
          )}
        </li>
        <li>
          {t(
            "只拍正對或傾角太小的照片 → 焦距與距離分不開。",
            "Only head-on or barely tilted images → focal length and distance can't be separated.",
          )}
        </li>
        <li>
          {t(
            "角點只集中在影像中央 → 畸變估不準，邊緣誤差大。",
            "Corners only in the center of the image → the distortion is poorly estimated and edge errors are large.",
          )}
        </li>
        <li>
          {t(
            <>
              把 tvec 當成相機位置（位置是 <M>{"-R^\\top t"}</M>）。
            </>,
            <>
              Treating tvec as the camera position (the position is{" "}
              <M>{"-R^\\top t"}</M>).
            </>,
          )}
        </li>
        <li>
          {t(
            "搞反 R, T 的方向（Camera → Projector 還是反過來）。",
            "Getting the direction of R, T backwards (Camera → Projector, or the other way around).",
          )}
        </li>
        <li>
          {t(
            "校正 Projector 只投一個方向的條紋。",
            "Projecting fringes in only one direction when calibrating the Projector.",
          )}
        </li>
        <li>
          {t(
            "只看 RMS、不用已知尺寸的物體驗證。",
            "Looking only at the RMS without verifying against an object of known size.",
          )}
        </li>
        <li>
          {t(
            "校正後又動了對焦、光圈或裝置位置。",
            "Changing the focus, aperture, or device position after calibration.",
          )}
        </li>
        <li>
          {t(
            "多台裝置的點雲沒有統一座標，或沒有定義高度零點就談「高度」。",
            "Point clouds from multiple devices aren't in a common frame, or “height” is discussed without defining a height zero.",
          )}
        </li>
      </ul>
    </section>
  );
}
