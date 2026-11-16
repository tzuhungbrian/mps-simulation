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

export const CHAPTERS = ["系統與 Camera", "相位與 Projector", "重建", "多視角"];

export const STATIONS: Station[] = [
  {
    n: 1,
    chapter: 0,
    title: "系統與相機模型",
    summary:
      "一個 3D 點怎麼變成像素：內參 K、外參 R | t，以及兩條射線怎麼交出 3D 點。",
    inputs: [],
    output: "rig 配置（Camera + Projector 的相對位置）",
    primary: {
      label: "在 3D 沙盒擺放 Camera 與 Projector",
      detail:
        "「裝置」分頁：拖曳兩台裝置，觀察射線與重建如何隨 baseline、夾角改變。",
      tool: "sandbox",
    },
    secondary: [],
    checks: [
      {
        id: "s1.model",
        text: "能寫出 X_c = R·X_w + t，並說明相機中心是 C = −Rᵀt，不是 t",
      },
      {
        id: "s1.baseline",
        text: "在 3D 沙盒移動 Camera 或 Projector，看過 baseline 與夾角改變後的重建",
      },
    ],
  },
  {
    n: 2,
    chapter: 0,
    title: "Camera Calibration",
    summary: "用棋盤格估出 Camera 的 K 與畸變，並學會判讀重投影誤差。",
    inputs: [],
    output: "Camera 內參 K_c 與畸變",
    primary: {
      label: "3D 實驗室：擺板子、拍照與 Camera 校正",
      detail: "親手擺校正板、鎖對焦、拍照，交給瀏覽器裡的 OpenCV.js 算出 K。",
      tool: "calib-lab",
      step: "capture",
    },
    secondary: [],
    inline: ["calibration-ab"],
    checks: [
      { id: "lab.atLeast3", text: "至少 3 張成功偵測到角點", auto: true },
      { id: "lab.sameFocus", text: "納入的照片都用同一個對焦距離", auto: true },
      { id: "lab.atLeast10", text: "至少 10 張成功的照片", auto: true },
      { id: "lab.coverage", text: "角點涵蓋影像九宮格", auto: true },
      {
        id: "lab.directions",
        text: "往至少 3 個不同方向傾斜 > 15°",
        auto: true,
      },
      { id: "lab.camRms", text: "Camera 校正 RMS < 0.3 px", auto: true },
    ],
  },
  {
    n: 3,
    chapter: 1,
    title: "Phase Shifting",
    summary: "用 N 張相移條紋，算出每個像素在條紋裡的位置（wrapped phase）。",
    inputs: [],
    output: "相位解碼器（wrapped phase）",
    primary: {
      label: "一步一步學：第 1–3 步",
      detail: "看三張照片、讀一個像素的三個亮度、算出 Phase。",
      tool: "guided",
      step: "1",
    },
    secondary: [
      {
        label: "1D 自由實驗",
        detail: "調 A、B、Noise 與 Seed，看 Valid Ratio 與 RMSE 怎麼變。",
        tool: "explore",
      },
    ],
    checks: [
      {
        id: "s3.decode",
        text: "能用三個亮度算出 wrapped phase，並說明正負號和曝光順序綁在一起",
      },
      {
        id: "s3.invalid",
        text: "說得出為什麼 B̂ 太小或 clipping 的像素要標成無效",
      },
    ],
  },
  {
    n: 4,
    chapter: 1,
    title: "Phase Unwrapping",
    summary:
      "把 −π 到 π 的 wrapped phase 補回整圈；比較 Spatial 與 Temporal 兩種做法。",
    inputs: [{ label: "Wrapped phase", from: [3] }],
    output: "絕對相位（absolute phase）",
    primary: {
      label: "一步一步學：第 4 步",
      detail: "親手加減 2π，看候選 k、無效遮罩與 Spatial／Temporal 的差別。",
      tool: "guided",
      step: "4",
    },
    secondary: [
      {
        label: "3D 沙盒：時間相位解包",
        detail: "「投影」分頁把頻率 f 調到 > 1，比較開／關時間相位解包的重建。",
        tool: "sandbox",
      },
    ],
    checks: [
      { id: "s4.lesson", text: "完成一步一步學第 4 步的 2π 練習" },
      { id: "s4.temporal", text: "在 3D 沙盒看過關閉時間相位解包時的級次錯誤" },
    ],
  },
  {
    n: 5,
    chapter: 1,
    title: "Projector Calibration",
    summary:
      "用第 3–4 站的相位，讓 Projector 當成「反向的相機」來校正，並求出 Camera–Projector 外參。",
    inputs: [
      { label: "Camera 內參 K_c", from: [2] },
      { label: "絕對相位（水平＋垂直）", from: [3, 4] },
    ],
    output: "Projector 內參 K_p 與 Camera–Projector R | t",
    primary: {
      label: "3D 實驗室：Projector 校正與驗證",
      detail:
        "用拍好的照片與條紋解出 Projector 角點，再執行 stereoCalibrate 並驗證格子尺寸。",
      tool: "calib-lab",
      step: "projector",
    },
    secondary: [],
    inline: ["calibration-ab"],
    checks: [
      {
        id: "lab.stereo",
        text: "完成 Projector 校正（stereoCalibrate）",
        auto: true,
      },
      {
        id: "lab.verify",
        text: "驗證：用估出的參數量格子，平均誤差 < 0.05 mm",
        auto: true,
      },
    ],
  },
  {
    n: 6,
    chapter: 2,
    title: "掃描與重建",
    summary:
      "把相位與校正結合起來，三角量測出點雲，並讀懂哪些像素失效、為什麼。",
    inputs: [
      { label: "Camera 內參 K_c", from: [2] },
      { label: "K_p 與 Camera–Projector R | t", from: [5] },
      { label: "相位解碼與解包", from: [3, 4] },
    ],
    output: "單套裝置的點雲",
    primary: {
      label: "3D 沙盒：掃描一個物體",
      detail: "選擇物體與材質後重新掃描，看曝光影像、相位與深度。",
      tool: "sandbox",
    },
    secondary: [
      {
        label: "點雲分析",
        detail: "RMSE、誤差直方圖、失效像素原因與逐引腳判定。",
        tool: "analysis",
      },
    ],
    checks: [
      { id: "s6.scan", text: "掃描任一物體，並在點雲分析讀出 RMSE 與覆蓋率" },
      {
        id: "s6.failures",
        text: "能指出至少兩種失效像素原因（例如遮擋、調變過低）",
      },
    ],
  },
  {
    n: 7,
    chapter: 2,
    title: "誤差與診斷",
    summary: "Gamma、互反射、級次錯誤、失焦：看到誤差時，怎麼找出原因。",
    planned: true,
    inputs: [],
    secondary: [],
    checks: [],
  },
  {
    n: 8,
    chapter: 3,
    title: "多視角座標統合",
    summary: "多台裝置的點雲各在自己的座標；把它們放進同一個世界座標。",
    inputs: [{ label: "單套裝置的點雲", from: [6] }],
    output: "每台裝置的 Camera → 世界轉換",
    secondary: [],
    inline: ["registration-c"],
    checks: [
      { id: "s8.lab", text: "完成實驗 C，讀懂兩台 Scanner 在重疊區的一致性" },
      { id: "s8.error", text: "能用 Δ ≈ L·θ 估算外參角度誤差造成的位移" },
    ],
  },
  {
    n: 9,
    chapter: 3,
    title: "多視角 Fusion",
    summary:
      "一開始就架多台裝置：比較各 Pair 的量測範圍，並把多組高度融合成一張。",
    inputs: [
      { label: "單套裝置的點雲", from: [6] },
      { label: "各裝置的世界座標轉換", from: [8] },
    ],
    output: "融合後的高度圖",
    primary: {
      label: "多視角分析：Pair、有效量測圖、Fusion",
      detail: "1–8 台 Camera 與 Projector，比較 Fusion 策略與 Benchmark。",
      tool: "aoi",
    },
    secondary: [],
    checks: [
      {
        id: "s9.fusion",
        text: "執行一組 Fusion，比較三種策略的 RMSE 與覆蓋率",
      },
      { id: "s9.weight", text: "說明為什麼共識融合以 1/σ² 加權，σ 從哪裡來" },
    ],
  },
];

export const WORKBENCH: { tool: ToolId; label: string; detail: string }[] = [
  { tool: "sandbox", label: "3D 沙盒", detail: "完整場景、材質與掃描參數" },
  { tool: "analysis", label: "點雲分析", detail: "誤差、失效原因、逐引腳判定" },
  { tool: "aoi", label: "AOI 多視角評估", detail: "Pair、Fusion 與 Benchmark" },
  { tool: "explore", label: "1D 自由實驗", detail: "三步相移數學實驗與匯出" },
];

export const TOOL_LABEL: Record<ToolId, string> = {
  sandbox: "3D 沙盒",
  analysis: "點雲分析",
  aoi: "AOI 多視角評估",
  "calib-lab": "Calibration 3D 實驗室",
  guided: "一步一步學",
  explore: "1D 自由實驗",
};

export const stationByN = (n: number) => STATIONS.find((s) => s.n === n);
