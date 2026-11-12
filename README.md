# Structured Light Lab · 結構光實驗室

React + TypeScript + Vite + Three.js / WebGL 的互動式教學研究專案。

**已具備 MVP 1 一維數學實驗，以及 MVP 2 的已知校正、單週期 3D 掃描沙盒。不是完整四階段 Scanner。**

介面使用繁體中文，保留英文技術名詞。所有計算都在本機瀏覽器執行，不使用後端、不上傳量測或參數。

## 啟動

已於 Node.js 22.14.0 驗證；建議使用相容的 Node.js 22.12+ 或更新 LTS。

```bash
npm ci
npm run dev
```

開啟 `http://127.0.0.1:5173`。伺服器只綁定 loopback，不預設公開到區域網路。

```bash
npm test                    # 純數學與參數 / CSV 單元測試
npm run build               # strict TypeScript + Vite production build
npx playwright install chromium
npm run test:e2e            # 真正 Chromium；包含 WebGL、下載檔案內容與互動
npm run test:production     # 同一套驗收測試改對 production dist 執行
npm run preview             # 預覽 dist，預設 http://127.0.0.1:4173
npm run format:check
```

`dist/` 是可部署的靜態網站；請使用 HTTP server，不要直接雙擊 index.html（ES module / file:// 限制）。依賴版本由 package-lock.json 鎖定。

## 預設進入 3D 沙盒

首次開啟會進入 3D Sandbox。觀察視角採 city-builder 式操作：點場景後以 WASD 平移視角、Q / E 水平轉向、按住滑鼠中鍵旋轉、滾輪縮放、右鍵拖曳平移、R 重設。左鍵點選物體、Camera 或 Projector 後拖曳彩色軸移動它，也可用側欄滑桿；兩台裝置永遠對準物體目前的中心；預設 Camera 在物體正上方往下拍、Projector 與物體中心同高並沿 X 軸從側面照射，影像水平軸自動沿 baseline。物體可切換球體、方塊、斜板、夾角可調的 V 型槽，以及放大比例的 PCB 板（QFP、SOIC、排針、被動元件共 48 支引腳，板子／晶片／引腳各自材質；選用時自動套用俯拍檢測擺位）；物體與地面各有反射率、GGX 鏡面強度與粗糙度（可選金屬、塑膠、陶瓷等材質預設，或一鍵重設），並可開啟 1–3 次 Monte Carlo 互反射。「專注 3D 空間」會收起工具與圖表，只保留大視窗與操作；不是具有重力、碰撞或第一人稱行走的完整遊戲引擎。

版面為單一畫面的編輯器式工作區：左側分頁參數（物體／裝置／投影／材質／其他，每個數值可拖滑桿或直接輸入）、中間 3D 視窗、右側指標與分頁結果（曝光影像／相位與深度／光傳輸）。改任何參數後約 0.3 秒自動在背景 Web Worker 重新掃描（也可按「重新掃描」）：正向模型以相同三角網格（BVH 加速）做 CPU 光線追蹤，計算 Camera 可見面、Projector 視野及遮擋、材質 BRDF 與可選的互反射，再從 N 張 intensity 解出 phase、（需要時）用單週期條紋解包成 column，利用已知校正做 ray–plane triangulation。點雲來自實際反算，不讀取表面真值。結果區另顯示直接光／間接光分量、深度誤差圖，以及同場景無互反射時的 RMSE 對照。重掃完成前，舊結果會變暗並從 3D 視窗移除點雲與射線，不冒充目前場景的量測。

「投影」分頁可調條紋頻率 f（1–32 個週期）、相移步數 N（3–8）、條紋 offset / amplitude 與 Projector FOV。f > 1 時可開關「時間相位解包」：開啟時加投 N 張單週期條紋來決定條紋序；關閉時直接把包裹相位當第 0 個週期，可以看到歧義造成的錯誤重建。

所有場景參數變更（滑桿、拖曳物體／Camera／Projector、材質、匯入等）都可用 Ctrl+Z 復原、Ctrl+Y 或 Ctrl+Shift+Z 重做，頂端也有對應按鈕；一次連續拖曳算一步，最多保留 100 步。正在數字欄位內打字時，Ctrl+Z 留給瀏覽器的文字復原。

預設只在整個 Projector 視野投 **一個完整正弦週期**、三步相移；多頻解包是一般的兩頻時間解包，不是 Micro PS。已知的理想 calibration 也不是從校正板估計的結果。詳見 [3D 沙盒模型與限制](docs/sandbox-model.md)。

網址可明確指定：`?workspace=sandbox`、`?workspace=guided`、`?workspace=explore`。模式選擇在此分頁保存；已保存的科學參數不會因切換模式被覆寫。

Camera 解析度可選 96×72 到 384×288，並可開啟 2×2 / 3×3 像素面積積分：跨在邊緣上的像素會混合兩個表面的條紋，小細節（如引腳）在低解析度時會重建錯誤或消失。

頂端「點雲分析」是獨立頁面：可旋轉的重建點雲（操控與 3D 沙盒相同：中鍵旋轉、右鍵平移、滾輪縮放、WASD／Q E 移動轉向、R 或「重設視角」回到預設；依深度誤差、高度或表面類別著色，可疊合真實表面線框）、RMSE / MAE / 平均偏差 / 中位數 / P95 / 最大誤差、可調容差與誤差直方圖、依表面統計、失效像素原因（背景、未照明、clipping、調變過低、三角量測無效）；PCB 另列每支引腳的可見、有效、容差內像素與「成功／部分／失敗／看不到」判定。這些全是讀取真值的評估資料，不參與重建。

## 「一步一步學」仍保留

如果想先理解三步相移，可以從沙盒返回新手導引：

1. **看三張照片**：知道是同一個場景的三次曝光，只有投影條紋相移不同。
2. **讀一個像素**：拖曳探針，讀三個亮度；圖旁直接解釋縱軸與橫軸。
3. **算出 Phase**：顯示實際 decoder 的結果，再按需開啟 Relative Unwrap 與公式。

每一步旁邊都有同步的 3D 示意：Projector 把同一組條紋投到牆上、Camera 拍下（藍框＝左邊的照片）；第 2 步顯示所選像素的 Camera 射線，第 3 步顯示同一個 φ̂ 對應的所有候選 Projector 光平面，說明為什麼單頻需要 unwrap／多頻／Micro PS。此示意不計算教學數值。

Phase 是條紋內的位置，不是物體高度。教學開始會套用乾淨、兩個條紋週期的參數，但不覆寫保存記錄。切換「自由實驗」可取得完整參數、Noise、統計、PNG / CSV / JSON 與 WebGL 示意。模式選擇只在此分頁的 sessionStorage 保存，不混入科學參數 JSON。

教學正文 18–20px，曲線刻度 14px，自由實驗參數標籤 16px；實際驗證 390 / 620 / 1440px 寬度，不只看全螢幕截圖。

## 可以做什麼

- 三張 Sinusoidal Fringe：相移 0°、120°、240°，可調頻率 f、初始 phase φ₀、DC mean A、振幅 B。
- 拖曳一維 intensity / phase 曲線的探針，或點擊影像選取 x、y；鍵盤左右鍵移動曲線探針。
- 同時觀察每點 I₁ / I₂ / I₃、Wrapped Phase、Relative 1D Unwrapped Phase、Â、B̂ 與 validity mask。
- 固定像素的 temporal 曲線：由三筆量測擬合，不使用真值、不額外生成曝光。
- 獨立加性 Gaussian Noise、固定 Seed、[0,1] hard clipping；這兩項是方便學習的簡化數學擾動，**不是 MVP 4 的完整物理模型**。
- Circular Phase RMSE（rad）、Valid Pixel Ratio（全部像素為分母）。全無效時 RMSE 為 N/A。
- 「原理筆記」包含公式、符號慣例、unwrap 可識別性限制與 calibration / triangulation 的下一步概念。
- 「實作邊界」與 roadmap 明確區分已完成、簡化模型與尚未實作。
- Three.js / WebGL 可旋轉的平面條紋示意；不參與量測或反解。WebGL 不可用時仍可進行 2D 數學實驗。

## 自由實驗模式的進一步練習

1. 保持 Noise=0，改變 A。三條 intensity 曲線整體上下移動，但 phase 不應改變（尚未 clipping 時）。
2. 改變 B，觀察 intensity 對比。B=0 且 Noise=0 時，所有像素必須無效，不能解出看似正確的 phase。
3. 移動 φ₀，觀察條紋位移與 Wrapped 的 ±π 邊界。
4. 拖曳探針，同時讀取三個 intensity；比較底部固定一點的 temporal 取樣。
5. 關閉 / 開啟 1D Unwrap，觀察週期如何被連起來。不要把相對 phase 誤當高度。
6. 點「套用這個實驗」載入低振幅 + Noise；比較 RMSE、Valid Ratio 與 Unwrap 錯誤。
7. 改 Seed，觀察 noise 改變；回到原 Seed，影像與統計會重現。
8. 將 A 調到接近 1，觀察 clipping 造成無效像素。只看剩餘有效像素的 RMSE 可能過度樂觀。

完整的 [驗證紀錄與實際匯出產物](docs/verification.md)。

## 數學模型

所有數值使用 Float64。影像寬高為 W,H；x=0…W−1。

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

解碼器的 phase 正負號與 **cos(φ+δ)** 及曝光順序綁定；任意交換影像或使用不同相移慣例，不能照抄相同公式。

每個像素必須三次曝光均為有限值、clipped mask=0 且 B̂ 大於 minModulation 才有效；無效 phase 以 NaN 表示，CSV 輸出為空白，不能以 0 取代。

逐列 Spatial Unwrap：各有效連續區段的第一點保留 Wrapped 值；其後累加相鄰最短 phase 差。無效缺口與新列會重設錨點。需要相鄰真實 phase 差值絕對值 < π，輸入設定拒絕 Nyquist 等號，但這不能保證有 Noise 時不會 cycle slip。

**各區段都保留未知的 2π 整數偏移。本版不提供 Absolute Phase、Projector correspondence、depth 或 3D RMSE。**

數學推導、驗證範圍與實測 Monte Carlo 結果：[docs/math-validation.md](docs/math-validation.md)。

## Ground Truth 隔離

```text
SimulationConfig → generateCaptures ── frames / clipped ─→ decodeThreeStep
                       │                                        │
                       │                            wrapped / valid
                       │                                        ↓
                       │                                   unwrapRows
                       │
                       └─ referencePhase ─→ evaluatePhase ← wrapped / valid
```

- Decoder 只接收三張 intensity、門檻與 clipping mask；不接受 f、φ₀、reference、深度或 fringe order。
- Unwrap 只接收 wrapped、valid、width；不藉由合成設定補週期。
- referencePhase 只用於 evaluator，以及明確標記的 CSV reference 欄位。
- CSV / PNG / 圖表均呈現實際解算陣列，不用真值替換失敗結果。
- 測試故意破壞真值，確認解碼和 unwrap 不變，只有評估誤差改變。

## 保存與匯出

### 保存參數

「保存參數」只保存到目前 origin 的 localStorage，重新載入可還原；操作後會讀回驗證。**localStorage 不是跨裝置備份。**

- 調整參數不會自動覆寫已保存記錄；黃點代表有未保存修改。
- 「重設」僅改變目前實驗，不刪除已保存記錄。
- 連續匯入採最後選取的檔案優先；較舊的非同步讀取結果與錯誤通知不得覆蓋較新的結果。
- JSON 匯出 / 匯入用於跨裝置與跨工作階段重現。格式：

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

所有欄位皆驗證型別、範圍、有限值與 Nyquist 條件；不強制轉換字串、不自動補缺漏。schema / model 錯誤或檔案超過 1 MB 時拒絕，且目前實驗與已保存參數不變。額外 config 欄位會移除；不執行任何匯入內容。

### CSV

匯出**全部 W×H 像素**，包含 metadata、config、每個像素的 x/y、I₁–I₃、估計 A/B、wrapped_rad、unwrapped_relative_rad、reference_phase_rad、valid、clipped。前導 `#` 為 metadata 註解；第三方分析工具請略過註解行與 UTF-8 BOM。

- x,y 為 0-based，row-major。
- 所有 phase 單位為 rad，intensity 為 normalized [0,1]；不是 8-bit camera raw data。
- reference_phase_rad 明確表示合成評估真值，不是重建結果。
- 無效 estimate 欄位留白，valid=0。
- 預設 512×192 會有 98,304 筆資料列，另有表頭與 metadata。

### PNG

匯出 1600×1120 實驗快照：三次 capture、Wrapped Phase、valid mask、所選列的 Relative Unwrapped 曲線、參數、Seed、RMSE、Ratio 與模型限制。PNG 是 8-bit 顯示視覺化，**不是 Float64 原始量測的替代品**；要做數值分析請用 CSV + JSON。

## 原始碼結構

```text
src/core/simulation.ts       純數學 forward / decode / unwrap / evaluation
src/core/simulation.test.ts  解析解、四象限、分支、遮罩、GT 隔離、Monte Carlo
src/lib/io.ts                版本化參數驗證與 localStorage 邊界、全像素 CSV
src/lib/io.test.ts           round-trip、拒絕無效輸入、保存原子性與 CSV
src/lib/images.ts            顯示用 raster、PNG 與 Blob 下載
src/components/LineChart.tsx SVG 曲線、pointer / keyboard 探針
src/components/PatternScene.tsx Three.js 平面紋理示意與資源清理
src/App.tsx                 繁體中文實驗介面、原理筆記、實作範圍
src/styles.css              響應式暗色研究工作區、reduced motion / contrast
 e2e/                       實際 Chromium 的互動與檔案驗證
```

沒有先前的程式基線或 Git repository，本次不擅自初始化 Git、不自動 commit。

## 四階段開發與驗收

| 階段                     | 狀態                               | 主要驗收                                                                                                                                            |
| ------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · Phase Shifting       | 本次 MVP                           | 真實三步反解、相對 1D Unwrap、可互動曲線、數學測試與可重現匯出                                                                                      |
| 2 · Virtual 3D Scanner   | 已知校正單週期沙盒已實作           | Pinhole camera / projector、內外參、distortion、ray / mesh 交點、projector 可見性與遮擋、independent GT buffers、從 correspondence 做 triangulation |
| 3 · Micro Phase Shifting | 尚未實作                           | 根據原文的窄高頻帶、共享 offset / amplitude 假設、F+2 影像、消除 cosine ambiguity 的多頻 column 搜尋；與同曝光預算 Conventional PS 比較             |
| 4 · Non-ideal Effects    | 互反射 / GGX 材質已實作（3D 沙盒） | Defocus PSF、Gamma / quantization、空間變動反射率、noise / calibration 誤差傳播、depth RMSE 與失效率分析                                            |

### MVP 2 必須遵守的資料路徑

1. Projector 使用自己的 Kp、Rp、tp 與 pattern phase，不能沿 Camera x 直接畫條紋。
2. Camera pixel ray 與表面求交，經 Projector 投影及可見性判斷生成 captures；解碼只讀 captures。
3. 先設計可驗證的 absolute correspondence 編碼，再以 Camera ray 與 Projector plane/ray 三角量測。
4. GT world position / depth 只能供 evaluator，不傳給 triangulation。
5. 測試已知平面、斜平面、球面、遮擋、基線退化、雜訊與 calibration 擾動；報告深度單位與座標框架。

### MVP 3 研究參考

M. Gupta and S. K. Nayar, **Micro Phase Shifting**, CVPR 2012。

- 作者研究頁：https://www.cs.columbia.edu/CAVE/projects/MicroPhaseShifting/
- 原文 PDF：https://cave.cs.columbia.edu/Statics/publications/pdfs/Gupta_CVPR12.pdf

F+2 方法不是任意多頻 pattern 都成立：窄高頻帶與近似共享光強 offset / amplitude 是關鍵假設。未實作前，不把單頻三步 PS、一般 heterodyne 或讀取真值後減少曝光數，稱作 Micro PS。後續需對照原文公式與頻率選擇、ambiguity 處理、共同曝光預算及假設失效案例。

## 刻意未支援與限制

- 一維模式不做幾何成像；3D 沙盒已提供理想合成 Camera Captures、三維物體、遮擋、三角量測與點雲，但沒有真實相機接入或 calibration 求解。
- 無 Defocus、subsurface scattering、motion、Gamma、Poisson / read noise、量化。互反射與 GGX 鏡面只在 3D 沙盒的 CPU 正向模型中，一維模式沒有。
- 數值流程是 CPU 運算（3D 掃描在 Web Worker）；大量像素匯出可能需要幾秒，不是 GPU accelerated reconstruction。WebGL 單獨 lazy-load；沙盒用於觀察幾何與光路，量測則是獨立的 CPU 光線追蹤，不從螢幕截圖讀回。
- 同一 Seed + config 在相同 JS 數學實作中可重現；浮點 transcendentals 不承諾跨所有引擎 bitwise identical。
- Validity 是明確門檻規則，不是統計置信度；純雜訊也可能跨過門檻。
- Circular RMSE 無法診斷 unwrap 的 2π 整數錯誤，也不代表 depth 準確度。
- 沒有測試真實 Camera / Projector 裝置；此專案用於理解，不用於工業或醫療量測認證。
