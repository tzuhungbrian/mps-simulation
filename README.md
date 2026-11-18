# Structured Light Lab · 結構光實驗室

在瀏覽器裡動手學結構光的互動式教學與研究環境：從 Phase Shifting、Phase Unwrapping，到相機模型、Camera / Projector Calibration、三角量測、多視角座標統合與 Fusion。每一步都跑實際演算法，畫面上的相位、點雲與校正參數都是從模擬影像反算出來的。

React 19 + TypeScript + Vite + Three.js / WebGL，校正實驗另用 OpenCV.js。所有計算都在本機瀏覽器執行：沒有後端，不上傳量測或參數。

> **如實標示**：本專案使用一般 N 步 Phase Shifting，**沒有實作 Micro Phase Shifting**。所有結果都來自理想化的模擬，不代表實機 AOI 性能，也不能用於工業或醫療量測認證。

介面預設為繁體中文，技術名詞保留英文。頂部導覽列的「EN／中文」可切換成英文（會記在瀏覽器），也可以用 `?lang=en` 開啟。

## 快速開始

需要 Node.js 22.12 以上（已在 22.14.0 驗證）。

```bash
npm ci
npm run dev        # http://127.0.0.1:5173（只綁定 loopback）
```

第一次開啟會進入**學習路徑首頁**（九站）。同一個分頁裡如果上次停在某個工具，重新整理後會回到那個工具；加 `?path` 一定會回到首頁。

## 學習路徑：九站

依照實際架設一套結構光系統的順序排列。每一站分成**理論**、**實驗**、**檢核**三部分，檢核清單會記錄進度；部分項目由 3D 校正實驗室自動判定。

| 站  | 章節             | 主題                                   | 主要實驗                                                          |
| --- | ---------------- | -------------------------------------- | ----------------------------------------------------------------- |
| 1   | 系統與 Camera    | 系統與相機模型（K、R \| t、射線相交）  | 3D 沙盒：擺放 Camera / Projector                                  |
| 2   | 系統與 Camera    | Camera Calibration                     | 3D 校正實驗室：擺板子、拍照、OpenCV.js 校正；站內實驗 A           |
| 3   | 相位與 Projector | Phase Shifting                         | 一步一步學第 1–3 步；1D 自由實驗                                  |
| 4   | 相位與 Projector | Phase Unwrapping（Spatial / Temporal） | 一步一步學第 4–5 步；3D 沙盒的時間相位解包                        |
| 5   | 相位與 Projector | Projector Calibration                  | 3D 校正實驗室：相位 → Projector 像素、stereoCalibrate；站內實驗 B |
| 6   | 重建             | 掃描與重建                             | 3D 沙盒 + 點雲分析                                                |
| 7   | 重建             | 誤差與診斷                             | 規劃中                                                            |
| 8   | 多視角           | 多視角座標統合                         | 站內實驗 C：兩台 Scanner 的重疊區一致性                           |
| 9   | 多視角           | 多視角 Fusion                          | AOI 多視角評估                                                    |

站點定義在 [src/path/stations.ts](src/path/stations.ts)。

## 工作區與網址參數

| 網址                                  | 內容                                                           |
| ------------------------------------- | -------------------------------------------------------------- |
| `?path`                               | 學習路徑首頁                                                   |
| `?station=N`（`&part=lab` / `check`） | 第 N 站的理論 / 實驗 / 檢核                                    |
| `?workspace=sandbox`                  | [3D 沙盒](#3d-沙盒)                                            |
| `?workspace=analysis`                 | [點雲分析](#點雲分析)                                          |
| `?workspace=aoi`                      | [AOI 多視角評估](#aoi-多視角評估)                              |
| `?workspace=calib-lab`                | [Calibration 3D 實驗室](#calibration-課程與-3d-實驗室)         |
| `?workspace=calibration`              | 相容舊網址，導向第 2 站理論                                    |
| `?workspace=guided`（`&step=1`…`5`）  | [一步一步學](#一步一步學從-phase-shifting-到-phase-unwrapping) |
| `?workspace=explore`                  | [1D 自由實驗](#1d-自由實驗)                                    |
| `&station=N`                          | 從某一站進入工具時保留返回連結                                 |
| `&lang=en`                            | 英文介面                                                       |

模式選擇只存在此分頁的 sessionStorage；切換模式不會覆寫已保存的科學參數。

## 各工作區

### 3D 沙盒

單一畫面的編輯器式工作區：左側參數分頁（物體／裝置／投影／材質／其他）、中間 3D 視窗、右側指標與結果（曝光影像／相位與深度／光傳輸）。

- **場景**：球體、方塊、斜板、夾角可調的 V 型槽，以及放大比例的 PCB 板（QFP、SOIC、排針、被動元件共 48 支引腳）。
- **材質**：物體與地面各有反射率、GGX 鏡面強度與粗糙度（金屬、塑膠、陶瓷等預設），可開啟 1–3 次 Monte Carlo 互反射。
- **條紋編碼**：頻率 f（1–32 週期）、相移步數 N（3–8）、offset / amplitude、Projector FOV。f > 1 時可開關時間相位解包；關閉時能直接看到級次歧義造成的錯誤重建。
- **Camera**：解析度 96×72 到 384×288，可開 2×2 / 3×3 像素面積積分，觀察邊緣混合與小引腳在低解析度下的失效。
- **重建流程**：改參數後約 0.3 秒在 Web Worker 自動重掃。正向模型以 BVH 加速的 CPU 光線追蹤產生 N 張影像，再解相位、（需要時）解包成 column、用已知校正做 ray–plane 三角量測。點雲來自實際反算，不讀表面真值；重掃完成前舊結果會變暗並從 3D 視窗移除。
- **操作**：點場景後 WASD 平移、Q / E 轉向、中鍵旋轉、滾輪縮放、右鍵平移、R 重設。左鍵選物體或裝置後拖曳彩色軸移動。Ctrl+Z / Ctrl+Y（或 Ctrl+Shift+Z）復原與重做，最多 100 步，一次連續拖曳算一步。「專注 3D 空間」會收起側欄。

預設的 calibration 是已知的理想值，不是從校正板估計的。模型細節與限制：[docs/sandbox-model.md](docs/sandbox-model.md)。

### 點雲分析

可旋轉的重建點雲（操作同沙盒），可依深度誤差、高度或表面類別著色並疊合真實表面線框。提供 RMSE / MAE / 平均偏差 / 中位數 / P95 / 最大誤差、可調容差與誤差直方圖、依表面統計，以及失效像素原因（背景、未照明、clipping、調變過低、三角量測無效）。PCB 場景另列每支引腳的「成功／部分／失敗／看不到」判定。這些都是讀取真值的評估資料，不參與重建。

### AOI 多視角評估

回答兩個問題：不同斜視 Pair 的 Measurement Range 應如何設定；各 Pair 的 3D 資料應如何融合。

- **單位與座標**：mm；板面為高度 0 的基準面（x = world X、y = world Z、高度 = world Y）。所有 Pair、真值與 Fusion 共用同一個 ROI 格網。
- **設備**：1–8 台 Camera 與 Projector，各自設傾角、方位、距離、FOV、光圈。Pair 類別由幾何即時判定：Camera 傾角 ≤ 門檻為直視；|Δ方位| ≤ 45° 為同じ側、≥ 135° 為反対側，其餘為直交。
- **理論**（只用校正資訊）：平行近似 `|dφ/dh| = (2π/p)·|tanθp − tanθc·cosΔα|`；pinhole 精確微分；每 2π 高度 `2π/|dφ/dh|`；雙週期外差範圍 × r/(r−1)；`σφ = σI·√(2/N)/B`、`σh = σφ/|dφ/dh|`；級次錯誤機率、景深、依需求範圍反推的最高條紋頻率。
- **模擬**：重用沙盒的光線追蹤、Lambert + GGX、N 步解碼與三角量測，另加薄透鏡失焦（`c = f·A·|1/s − 1/s_f|`，σ = c/4）。只模擬直接光，沒有互反射。
- **場景**：階梯量規、Chip + 凹形焊錫 Fillet + 3 mm 元件、縮放為 40×30 mm 的沙盒 PCB、可調高度平面。
- **有效量測圖**：每格標示準確、超差、邊緣混合、級次錯、範圍混疊、FOV 外、遮擋、陰影、飽和、失焦、調變不足或無取樣。
- **Fusion**（不使用真值）：① 直視 + 斜視補洞、② 單一斜視、③ 斜視 + 斜視共識融合（剔除離群後 1/σ² 加權，σ 來自各 Pair 自己的調變、雜訊規格與 |dφ/dh|）。另有兩兩 Pair 的 Cross-pair Consistency Check。
- **Benchmark**：RMSE / MAE / Bias、平坦區 RMSE、覆蓋率、失效比例、粗大誤差、各材質誤差、計算時間；固定 seed 的參數掃描；匯出每格 CSV、摘要 JSON、批次 CSV。
- **AOI 參考值**：可輸入廠商或實機數值並列比較，只用於顯示，不進入任何計算。

資料路徑：`renderPair → { frames, clipped } → reconstructPair → binToGrid → Fusion`；真值只進入 `buildTruthMap / evaluatePair / scoreStrategy`。

### Calibration 課程與 3D 實驗室

- **課程**（第 2、5、8 站的理論）：概念與公式，逐一對照 OpenCV 的 `calibrateCamera`、`solvePnP`、`stereoCalibrate`、`triangulatePoints`。
- **站內實驗 A / B / C**：Camera 校正、Projector 校正、兩台 Scanner 的座標統合。使用專案自己的 TypeScript 數學核心（Zhang 法初值 + Levenberg–Marquardt，見 [src/calibration/](src/calibration/)）。角點是「真值投影 + 雜訊」，**沒有做影像偵測**。
- **3D 實驗室**（`?workspace=calib-lab`）：親手擺放校正板、鎖對焦、拍照。從渲染影像偵測棋盤角點並做 sub-pixel 精修，再交給瀏覽器裡的 OpenCV.js 校正；Projector 校正用水平 + 垂直的時間相位解包，把角點換成 Projector 像素。校正助理會檢查張數、對焦一致、九宮格覆蓋、傾斜方向與 RMS，並自動勾選第 2、5 站的檢核項目。也模擬了對焦呼吸。

### 一步一步學：從 Phase Shifting 到 Phase Unwrapping

1. **看三張照片**：同一個場景的三次曝光，只有條紋相移不同。
2. **讀一個像素**：拖曳探針，讀三個亮度。
3. **算出 Phase**：顯示實際 decoder 的結果，可開啟 Relative Unwrap 與公式。
4. **Spatial 解包**：疊合 Wrapped／Relative Unwrapped；用斷層高度滑桿（0–2 圈）找出「超過半圈就接錯一整圈」的門檻。
5. **Temporal 解包**：用 {1, 4, 16} 三組頻率逐層算 `k = round((r·Φ − φ) / 2π)`；用雜訊滑桿比較 {1, 4, 16} 與 {1, 16} 的級次錯誤率（|r·ε| < π），最後換成 Projector 像素 u_p。

前 3 步旁有同步的 3D 示意（Projector 投條紋、Camera 拍攝、像素射線與候選光平面）；示意不參與計算。Phase 是條紋內的位置，不是物體高度。數學與測試邊界見 [docs/phase-unwrapping-lesson.md](docs/phase-unwrapping-lesson.md)。

### 1D 自由實驗

三步相移的一維數學實驗：可調頻率 f、初始相位 φ₀、DC mean A、振幅 B、Gaussian Noise 與 Seed；拖曳 intensity / phase 曲線上的探針（也可用左右鍵），同時看 I₁–I₃、Wrapped Phase、Relative Unwrapped Phase、Â、B̂ 與 validity mask，以及 Circular Phase RMSE 與 Valid Pixel Ratio。WebGL 不可用時這個模式仍可使用。

建議的練習：

1. Noise=0，改變 A：intensity 整體上下移動，phase 不變（尚未 clipping 時）。
2. B=0 且 Noise=0：所有像素都必須無效，不能解出看似正確的 phase。
3. 移動 φ₀，觀察 Wrapped 的 ±π 邊界。
4. 開關 1D Unwrap，觀察週期如何被連起來。相對 phase 不是高度。
5. 「套用這個實驗」載入低振幅 + Noise，比較 RMSE、Valid Ratio 與 Unwrap 錯誤。
6. 改 Seed 再改回來：影像與統計會重現。
7. A 接近 1：clipping 造成無效像素，只看剩餘像素的 RMSE 可能過度樂觀。

## 數學模型（1D）

所有數值使用 Float64。影像寬高為 W, H；x = 0…W−1。

```text
φ(x) = 2π f x/(W−1) + φ₀
δₖ = {0, 2π/3, 4π/3}
Iₖ(x,y) = clamp(A + B cos(φ(x)+δₖ) + σZₖₓᵧ, 0, 1)
Z ~ N(0,1), PRNG = Mulberry32(seed), Gaussian = Box–Muller

N = √3(I₃ − I₂)
D = 2I₁ − I₂ − I₃
φ̂ = wrap(atan2(N,D)) ∈ [−π, π)
Â = (I₁ + I₂ + I₃)/3
B̂ = hypot(N,D)/3
```

- 解碼器的正負號與 **cos(φ+δ)** 及曝光順序綁定；交換影像或改用其他相移慣例，不能照抄同一公式。
- 像素有效的條件：三次曝光都是有限值、沒有 clipping、B̂ > minModulation。無效 phase 為 NaN，CSV 中留白，不以 0 取代。
- 逐列 Spatial Unwrap 在每個有效連續區段內累加相鄰最短 phase 差；各區段保留未知的 2π 整數偏移。

推導與 Monte Carlo 驗證：[docs/math-validation.md](docs/math-validation.md)。

## 真值隔離

本專案最重要的設計原則：**結果必須是算出來的。**

```text
SimulationConfig → generateCaptures ── frames / clipped ─→ decodeThreeStep
                       │                                        │
                       │                            wrapped / valid
                       │                                        ↓
                       │                                   unwrapRows
                       │
                       └─ referencePhase ─→ evaluatePhase ← wrapped / valid
```

- Decoder 只接收 intensity、門檻與 clipping mask；不接受 f、φ₀、reference、深度或級次。
- Unwrap、三角量測、Fusion 都不讀真值；真值只進入 evaluator 與明確標示的 reference 欄位。
- CSV / PNG / 圖表呈現實際解算結果，不用真值替換失敗。
- 測試會故意破壞真值，確認重建不變，只有評估誤差改變。

## 保存與匯出（1D 自由實驗）

- **保存參數**：寫入目前 origin 的 localStorage 並讀回驗證，不是跨裝置備份。黃點代表有未保存的修改；「重設」不刪除已保存記錄。
- **JSON**：跨裝置重現用。欄位會驗證型別、範圍、有限值與 Nyquist 條件，不強制轉型、不補缺漏；檔案超過 1 MB 或 schema 錯誤時拒絕，目前實驗不變。

  ```json
  {
    "schemaVersion": 1,
    "model": "three-step-1d",
    "config": {
      "width": 512,
      "height": 192,
      "frequency": 6,
      "phaseOffset": 0.6,
      "mean": 0.5,
      "amplitude": 0.4,
      "noiseSigma": 0,
      "minModulation": 0.02,
      "seed": 42
    }
  }
  ```

- **CSV**：全部 W×H 像素（預設 98,304 列），含 x/y（0-based、row-major）、I₁–I₃、Â/B̂、wrapped / unwrapped / reference phase（rad）、valid、clipped。以 `#` 開頭的 metadata 行與 UTF-8 BOM 請在外部工具中略過。
- **PNG**：1600×1120 的 8-bit 視覺化快照，不能取代 Float64 原始數據；數值分析請用 CSV + JSON。

沙盒與 AOI 模式各有自己的 CSV / JSON 匯出。

## 開發

```bash
npm test                    # Vitest：數學核心、IO、沙盒、AOI、校正
npm run build               # strict TypeScript + Vite production build → dist/
npx playwright install chromium
npm run test:e2e            # Playwright + 真正的 Chromium（WebGL、下載檔內容、互動）
npm run test:production     # 同一套 e2e 改對 production build 執行
npm run preview             # 預覽 dist，http://127.0.0.1:4173
npm run format:check        # Prettier
```

- `dist/` 是靜態網站，請用 HTTP server 提供；直接開 `index.html`（file://）會因 ES module 限制而失敗。
- 新增介面文字一律用 [src/i18n.ts](src/i18n.ts) 的 `t(中文, English)` 成對撰寫，少一種語言會讓型別檢查失敗。
- **本機機密預設**：`src/local/*.preset.json`（已列入 `.gitignore`）會出現在 AOI「裝置擺位預設」的「本機：…」選項，用來放不可公開的設備配置與廠商參考值，格式見 [src/sandbox/localPresets.ts](src/sandbox/localPresets.ts) 的 `LocalPreset`。**`npm run build` 會把它打包進 `dist/`，含機密預設時不要公開發佈 build。**

### 原始碼結構

```text
src/
  App.tsx, main.tsx    路由、工作區切換、1D 自由實驗介面
  i18n.ts              繁中／英文成對字串
  path/                學習路徑首頁、九站定義、站點頁、進度、網址路由
  core/simulation.ts   1D 正向模型、三步解碼、unwrap、評估（純數學）
  lib/                 參數驗證與 localStorage、CSV / PNG 匯出、教學頁的數學
  components/          一步一步學、Unwrapping 教學、曲線圖、3D 示意
  sandbox/             3D 沙盒：幾何、BVH 光傳輸、掃描 Worker、點雲分析、PCB
  aoi/                 AOI 多視角：rig、渲染、重建、靈敏度理論、Fusion、評估、匯出
  calibration/         相機模型、線性代數、LM、校正數學核心與課程
    lab/               3D 校正實驗室：渲染、角點偵測、相位解碼、OpenCV.js、助理
e2e/                   Playwright 驗收測試
scripts/               自動截圖與驗證證據產生
docs/                  模型說明、數學驗證、驗證紀錄與 evidence/
```

## 文件

| 文件                                                               | 內容                              |
| ------------------------------------------------------------------ | --------------------------------- |
| [docs/sandbox-model.md](docs/sandbox-model.md)                     | 3D 沙盒的正向模型、重建與限制     |
| [docs/phase-unwrapping-lesson.md](docs/phase-unwrapping-lesson.md) | Phase Unwrapping 教學的數學與測試 |
| [docs/math-validation.md](docs/math-validation.md)                 | 1D 數學推導與 Monte Carlo 結果    |
| [docs/verification.md](docs/verification.md)                       | 驗證紀錄與實際匯出產物            |
| [PRODUCT.md](PRODUCT.md)                                           | 產品目標、使用者、原則與 roadmap  |
| [DESIGN.md](DESIGN.md)                                             | 視覺與介面設計系統                |

## 開發階段

| 階段                     | 狀態                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| 1 · Phase Shifting       | 完成：1D 實驗、一步一步學、Spatial / Temporal 解包                                             |
| 2 · Virtual 3D Scanner   | 完成：3D 沙盒、點雲分析、Camera / Projector 校正、座標統合、AOI 多視角                         |
| 3 · Micro Phase Shifting | **尚未實作**                                                                                   |
| 4 · Non-ideal Effects    | 部分：互反射、GGX 材質、薄透鏡失焦（AOI）、對焦呼吸（校正實驗室）；第 7 站「誤差與診斷」規劃中 |

Micro Phase Shifting 參考：M. Gupta and S. K. Nayar, **Micro Phase Shifting**, CVPR 2012（[作者頁](https://www.cs.columbia.edu/CAVE/projects/MicroPhaseShifting/)、[PDF](https://cave.cs.columbia.edu/Statics/publications/pdfs/Gupta_CVPR12.pdf)）。F+2 方法依賴窄高頻帶與近似共享的 offset / amplitude；在依原文實作之前，不把單頻三步 PS、一般 heterodyne 或讀取真值後減少曝光數稱作 Micro PS。

## 限制

- 沒有接真實 Camera / Projector；所有影像都是合成的。
- 沒有 subsurface scattering、motion、Gamma、Poisson / read noise、量化。互反射只在 3D 沙盒；失焦只在 AOI 模式與校正實驗室；1D 模式都沒有。
- 3D 沙盒用已知的理想校正；從校正板估出的參數目前只在校正實驗中使用。
- 數值運算在 CPU（3D 掃描在 Web Worker），不是 GPU 重建；大型匯出可能需要幾秒。
- 同一 Seed + config 在相同 JS 實作下可重現，但不保證跨瀏覽器引擎 bitwise identical。
- Validity 是明確的門檻規則，不是統計置信度；Circular RMSE 無法偵測 2π 整數錯誤，也不代表深度精度。
