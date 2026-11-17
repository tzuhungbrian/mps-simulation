import { t } from "../i18n";

export type Part = "theory" | "lab" | "check";
export type ToolId =
  "sandbox" | "analysis" | "aoi" | "calib-lab" | "guided" | "explore";

export type Route =
  | { kind: "home" }
  | { kind: "station"; n: number; part: Part }
  | { kind: "tool"; tool: ToolId; station?: number; step?: string };

export interface Activity {
  label: string;
  detail: string;
  tool: ToolId;
  step?: string;
}

export interface Check {
  id: string;
  text: string;
  /** Reported by the 3D calibration lab; otherwise the learner ticks it. */
  auto?: boolean;
}

export interface Station {
  n: number;
  chapter: number;
  title: string;
  summary: string;
  planned?: boolean;
  inputs: { label: string; from: number[] }[];
  output?: string;
  primary?: Activity;
  secondary: Activity[];
  /** Inline lab widgets rendered on the station page. */
  inline?: ("calibration-ab" | "registration-c")[];
  checks: Check[];
}

export const CHAPTERS = [
  t("系統與 Camera", "System & camera"),
  t("相位與 Projector", "Phase & projector"),
  t("重建", "Reconstruction"),
  t("多視角", "Multi-view"),
];

export const STATIONS: Station[] = [
  {
    n: 1,
    chapter: 0,
    title: t("系統與相機模型", "System & camera model"),
    summary: t(
      "一個 3D 點怎麼變成像素：內參 K、外參 R | t，以及兩條射線怎麼交出 3D 點。",
      "How a 3D point becomes a pixel: intrinsics K, extrinsics R | t, and how two rays meet at a 3D point.",
    ),
    inputs: [],
    output: t(
      "rig 配置（Camera + Projector 的相對位置）",
      "Rig layout (relative pose of camera and projector)",
    ),
    primary: {
      label: t(
        "在 3D 沙盒擺放 Camera 與 Projector",
        "Place the camera and projector in the 3D sandbox",
      ),
      detail: t(
        "「裝置」分頁：拖曳兩台裝置，觀察射線與重建如何隨 baseline、夾角改變。",
        "Devices tab: drag both devices and watch how the rays and the reconstruction change with baseline and angle.",
      ),
      tool: "sandbox",
    },
    secondary: [],
    checks: [
      {
        id: "s1.model",
        text: t(
          "能寫出 X_c = R·X_w + t，並說明相機中心是 C = −Rᵀt，不是 t",
          "Write X_c = R·X_w + t and explain why the camera center is C = −Rᵀt, not t",
        ),
      },
      {
        id: "s1.baseline",
        text: t(
          "在 3D 沙盒移動 Camera 或 Projector，看過 baseline 與夾角改變後的重建",
          "Move the camera or projector in the 3D sandbox and see how baseline and angle change the reconstruction",
        ),
      },
    ],
  },
  {
    n: 2,
    chapter: 0,
    title: "Camera Calibration",
    summary: t(
      "用棋盤格估出 Camera 的 K 與畸變，並學會判讀重投影誤差。",
      "Estimate the camera's K and distortion from a chessboard, and learn to read the reprojection error.",
    ),
    inputs: [],
    output: t("Camera 內參 K_c 與畸變", "Camera intrinsics K_c and distortion"),
    primary: {
      label: t(
        "3D 實驗室：擺板子、拍照與 Camera 校正",
        "3D lab: place the board, capture, calibrate the camera",
      ),
      detail: t(
        "親手擺校正板、鎖對焦、拍照，交給瀏覽器裡的 OpenCV.js 算出 K。",
        "Place the board, lock focus and capture; OpenCV.js in the browser computes K.",
      ),
      tool: "calib-lab",
      step: "capture",
    },
    secondary: [],
    inline: ["calibration-ab"],
    checks: [
      {
        id: "lab.atLeast3",
        text: t(
          "至少 3 張成功偵測到角點",
          "Corners detected in at least 3 images",
        ),
        auto: true,
      },
      {
        id: "lab.sameFocus",
        text: t(
          "納入的照片都用同一個對焦距離",
          "All included images use the same focus distance",
        ),
        auto: true,
      },
      {
        id: "lab.atLeast10",
        text: t("至少 10 張成功的照片", "At least 10 successful images"),
        auto: true,
      },
      {
        id: "lab.coverage",
        text: t(
          "角點涵蓋影像九宮格",
          "Corners cover all nine cells of the image",
        ),
        auto: true,
      },
      {
        id: "lab.directions",
        text: t(
          "往至少 3 個不同方向傾斜 > 15°",
          "Tilted > 15° in at least 3 different directions",
        ),
        auto: true,
      },
      {
        id: "lab.camRms",
        text: t("Camera 校正 RMS < 0.3 px", "Camera calibration RMS < 0.3 px"),
        auto: true,
      },
    ],
  },
  {
    n: 3,
    chapter: 1,
    title: "Phase Shifting",
    summary: t(
      "用 N 張相移條紋，算出每個像素在條紋裡的位置（wrapped phase）。",
      "From N phase-shifted fringe images, compute where each pixel sits within a fringe (wrapped phase).",
    ),
    inputs: [],
    output: t("相位解碼器（wrapped phase）", "Phase decoder (wrapped phase)"),
    primary: {
      label: t("一步一步學：第 1–3 步", "Step by step: steps 1–3"),
      detail: t(
        "看三張照片、讀一個像素的三個亮度、算出 Phase。",
        "Look at three images, read one pixel's three intensities, compute its phase.",
      ),
      tool: "guided",
      step: "1",
    },
    secondary: [
      {
        label: t("1D 自由實驗", "1D playground"),
        detail: t(
          "調 A、B、Noise 與 Seed，看 Valid Ratio 與 RMSE 怎麼變。",
          "Adjust A, B, noise and seed; watch valid ratio and RMSE change.",
        ),
        tool: "explore",
      },
    ],
    checks: [
      {
        id: "s3.decode",
        text: t(
          "能用三個亮度算出 wrapped phase，並說明正負號和曝光順序綁在一起",
          "Compute wrapped phase from three intensities, and explain why the sign is tied to the exposure order",
        ),
      },
      {
        id: "s3.invalid",
        text: t(
          "說得出為什麼 B̂ 太小或 clipping 的像素要標成無效",
          "Explain why pixels with low B̂ or clipping must be marked invalid",
        ),
      },
    ],
  },
  {
    n: 4,
    chapter: 1,
    title: "Phase Unwrapping",
    summary: t(
      "把 −π 到 π 的 wrapped phase 補回整圈；比較 Spatial 與 Temporal 兩種做法。",
      "Restore the full cycles missing from the −π to π wrapped phase, and compare the Spatial and Temporal approaches.",
    ),
    inputs: [{ label: "Wrapped phase", from: [3] }],
    output: t("絕對相位（absolute phase）", "Absolute phase"),
    primary: {
      label: t("一步一步學：第 4–5 步", "Step by step: steps 4–5"),
      detail: t(
        "第 4 步親手加減 2π、用斷層滑桿找出 Spatial 的極限；第 5 步逐層算 Temporal 的 k，比較 {1,4,16} 與 {1,16}，最後換成 Projector 像素。",
        "Step 4: add and subtract 2π by hand and use the depth-step slider to find where Spatial breaks down. Step 5: compute Temporal's k level by level, compare {1,4,16} with {1,16}, then convert to projector pixels.",
      ),
      tool: "guided",
      step: "4",
    },
    secondary: [
      {
        label: t(
          "一步一步學：直接到第 5 步 Temporal",
          "Step by step: skip to step 5 (Temporal)",
        ),
        detail: t(
          "已經熟悉 Spatial 的話，從這裡開始。",
          "Start here if you already know Spatial unwrapping.",
        ),
        tool: "guided",
        step: "5",
      },
      {
        label: t(
          "3D 沙盒：時間相位解包",
          "3D sandbox: temporal phase unwrapping",
        ),
        detail: t(
          "「投影」分頁把頻率 f 調到 > 1，比較開／關時間相位解包的重建。",
          "Projection tab: set frequency f > 1 and compare the reconstruction with temporal phase unwrapping on and off.",
        ),
        tool: "sandbox",
      },
    ],
    checks: [
      {
        id: "s4.spatial",
        text: t(
          "用斷層滑桿找到 Spatial 開始接錯的高度，並說明為什麼是半圈",
          "Use the depth-step slider to find the height where Spatial starts to fail, and explain why it's half a cycle",
        ),
      },
      {
        id: "s4.ratio",
        text: t(
          "說得出 |r·ε| < π 的意思，以及為什麼用 {1,4,16} 而不是 {1,16}",
          "Explain what |r·ε| < π means, and why we use {1,4,16} instead of {1,16}",
        ),
      },
      {
        id: "s4.noise",
        text: t(
          "在第 5 步把雜訊調大，找到 {1,16} 開始出現級次錯誤、{1,4,16} 仍然正確的範圍",
          "In step 5, raise the noise and find the range where {1,16} starts making fringe-order errors while {1,4,16} stays correct",
        ),
      },
      {
        id: "s4.handoff",
        text: t(
          "會用 u_p = Φ·W_p / (2π·f) 把絕對相位換成 Projector 像素",
          "Convert absolute phase to projector pixels with u_p = Φ·W_p / (2π·f)",
        ),
      },
    ],
  },
  {
    n: 5,
    chapter: 1,
    title: "Projector Calibration",
    summary: t(
      "用第 3–4 站的相位，讓 Projector 當成「反向的相機」來校正，並求出 Camera–Projector 外參。",
      'Use the phase from stations 3–4 to calibrate the projector as an "inverse camera", and solve for the camera–projector extrinsics.',
    ),
    inputs: [
      { label: t("Camera 內參 K_c", "Camera intrinsics K_c"), from: [2] },
      {
        label: t(
          "絕對相位（水平＋垂直）",
          "Absolute phase (horizontal + vertical)",
        ),
        from: [3, 4],
      },
    ],
    output: t(
      "Projector 內參 K_p 與 Camera–Projector R | t",
      "Projector intrinsics K_p and camera–projector R | t",
    ),
    primary: {
      label: t(
        "3D 實驗室：Projector 校正與驗證",
        "3D lab: projector calibration and verification",
      ),
      detail: t(
        "用拍好的照片與條紋解出 Projector 角點，再執行 stereoCalibrate 並驗證格子尺寸。",
        "Decode projector corners from your captured images and fringes, then run stereoCalibrate and verify the square size.",
      ),
      tool: "calib-lab",
      step: "projector",
    },
    secondary: [],
    inline: ["calibration-ab"],
    checks: [
      {
        id: "lab.stereo",
        text: t(
          "完成 Projector 校正（stereoCalibrate）",
          "Complete projector calibration (stereoCalibrate)",
        ),
        auto: true,
      },
      {
        id: "lab.verify",
        text: t(
          "驗證：用估出的參數量格子，平均誤差 < 0.05 mm",
          "Verify: measure the squares with the estimated parameters; mean error < 0.05 mm",
        ),
        auto: true,
      },
    ],
  },
  {
    n: 6,
    chapter: 2,
    title: t("掃描與重建", "Scanning & reconstruction"),
    summary: t(
      "把相位與校正結合起來，三角量測出點雲，並讀懂哪些像素失效、為什麼。",
      "Combine phase and calibration to triangulate a point cloud, and learn to read which pixels fail and why.",
    ),
    inputs: [
      { label: t("Camera 內參 K_c", "Camera intrinsics K_c"), from: [2] },
      {
        label: t(
          "K_p 與 Camera–Projector R | t",
          "K_p and camera–projector R | t",
        ),
        from: [5],
      },
      {
        label: t("相位解碼與解包", "Phase decoding and unwrapping"),
        from: [3, 4],
      },
    ],
    output: t("單套裝置的點雲", "Point cloud from a single rig"),
    primary: {
      label: t("3D 沙盒：掃描一個物體", "3D sandbox: scan an object"),
      detail: t(
        "選擇物體與材質後重新掃描，看曝光影像、相位與深度。",
        "Pick an object and material, rescan, and look at the captured images, phase and depth.",
      ),
      tool: "sandbox",
    },
    secondary: [
      {
        label: t("點雲分析", "Point-cloud analysis"),
        detail: t(
          "RMSE、誤差直方圖、失效像素原因與逐引腳判定。",
          "RMSE, error histogram, causes of invalid pixels, and per-pin verdicts.",
        ),
        tool: "analysis",
      },
    ],
    checks: [
      {
        id: "s6.scan",
        text: t(
          "掃描任一物體，並在點雲分析讀出 RMSE 與覆蓋率",
          "Scan any object and read its RMSE and coverage in point-cloud analysis",
        ),
      },
      {
        id: "s6.failures",
        text: t(
          "能指出至少兩種失效像素原因（例如遮擋、調變過低）",
          "Name at least two causes of invalid pixels (e.g. occlusion, low modulation)",
        ),
      },
    ],
  },
  {
    n: 7,
    chapter: 2,
    title: t("誤差與診斷", "Errors & diagnosis"),
    summary: t(
      "Gamma、互反射、級次錯誤、失焦：看到誤差時，怎麼找出原因。",
      "Gamma, interreflections, fringe-order errors, defocus: when you see an error, how to find its cause.",
    ),
    planned: true,
    inputs: [],
    secondary: [],
    checks: [],
  },
  {
    n: 8,
    chapter: 3,
    title: t("多視角座標統合", "Multi-view registration"),
    summary: t(
      "多台裝置的點雲各在自己的座標；把它們放進同一個世界座標。",
      "Each device's point cloud lives in its own coordinates; bring them all into one world frame.",
    ),
    inputs: [
      {
        label: t("單套裝置的點雲", "Point cloud from a single rig"),
        from: [6],
      },
    ],
    output: t(
      "每台裝置的 Camera → 世界轉換",
      "Camera → world transform for each device",
    ),
    secondary: [],
    inline: ["registration-c"],
    checks: [
      {
        id: "s8.lab",
        text: t(
          "完成實驗 C，讀懂兩台 Scanner 在重疊區的一致性",
          "Complete lab C and read how well the two scanners agree in the overlap",
        ),
      },
      {
        id: "s8.error",
        text: t(
          "能用 Δ ≈ L·θ 估算外參角度誤差造成的位移",
          "Use Δ ≈ L·θ to estimate the shift caused by an extrinsic angle error",
        ),
      },
    ],
  },
  {
    n: 9,
    chapter: 3,
    title: t("多視角 Fusion", "Multi-view fusion"),
    summary: t(
      "一開始就架多台裝置：比較各 Pair 的量測範圍，並把多組高度融合成一張。",
      "Set up several devices from the start: compare each pair's measurable range, and fuse their heights into one map.",
    ),
    inputs: [
      {
        label: t("單套裝置的點雲", "Point cloud from a single rig"),
        from: [6],
      },
      {
        label: t("各裝置的世界座標轉換", "World transform of each device"),
        from: [8],
      },
    ],
    output: t("融合後的高度圖", "Fused height map"),
    primary: {
      label: t(
        "多視角分析：Pair、有效量測圖、Fusion",
        "Multi-view analysis: pairs, valid-measurement maps, fusion",
      ),
      detail: t(
        "1–8 台 Camera 與 Projector，比較 Fusion 策略與 Benchmark。",
        "1–8 cameras and projectors; compare fusion strategies and benchmarks.",
      ),
      tool: "aoi",
    },
    secondary: [],
    checks: [
      {
        id: "s9.fusion",
        text: t(
          "執行一組 Fusion，比較三種策略的 RMSE 與覆蓋率",
          "Run a fusion and compare the RMSE and coverage of the three strategies",
        ),
      },
      {
        id: "s9.weight",
        text: t(
          "說明為什麼共識融合以 1/σ² 加權，σ 從哪裡來",
          "Explain why consensus fusion weights by 1/σ², and where σ comes from",
        ),
      },
    ],
  },
];

export const WORKBENCH: { tool: ToolId; label: string; detail: string }[] = [
  {
    tool: "sandbox",
    label: t("3D 沙盒", "3D sandbox"),
    detail: t(
      "完整場景、材質與掃描參數",
      "Full scene, materials and scan settings",
    ),
  },
  {
    tool: "analysis",
    label: t("點雲分析", "Point-cloud analysis"),
    detail: t(
      "誤差、失效原因、逐引腳判定",
      "Errors, failure causes, per-pin verdicts",
    ),
  },
  {
    tool: "aoi",
    label: t("AOI 多視角評估", "AOI multi-view evaluation"),
    detail: t("Pair、Fusion 與 Benchmark", "Pairs, fusion and benchmarks"),
  },
  {
    tool: "explore",
    label: t("1D 自由實驗", "1D playground"),
    detail: t(
      "三步相移數學實驗與匯出",
      "Three-step phase-shift math experiments and export",
    ),
  },
];

export const TOOL_LABEL: Record<ToolId, string> = {
  sandbox: t("3D 沙盒", "3D sandbox"),
  analysis: t("點雲分析", "Point-cloud analysis"),
  aoi: t("AOI 多視角評估", "AOI multi-view evaluation"),
  "calib-lab": t("Calibration 3D 實驗室", "Calibration 3D lab"),
  guided: t("一步一步學", "Step by step"),
  explore: t("1D 自由實驗", "1D playground"),
};

export const stationByN = (n: number) => STATIONS.find((s) => s.n === n);
