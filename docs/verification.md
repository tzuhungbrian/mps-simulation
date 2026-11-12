# 驗證紀錄

## Phase Unwrapping 教學擴充

- `npm test`：133 項單元測試、7 個測試檔通過；包含新教學 adapter 的 15 項測試。
- `npm run test:production`：strict TypeScript 與 Vite build 通過，36 項 production Chromium 測試通過，其中 9 項覆蓋本教學與同頁對照版面。
- 依學習者確認的方向改為保留內容、圖／數值／公式同一視野。預設疊合兩種相位曲線，選點同步更新同色圖上標籤與 live formula；取消先前三小頁。620×950px 量測確認圖與公式均在視窗內，另測重合標籤與無效點清除。
- 前一版 adapter 曾經獨立唯讀審查通過；本次呈現調整由主流程重跑測試與實際畫面檢查，未另取得獨立審查。不可把前次審查當成本次新增 UI 的獨立核准。
- 覆蓋實際相鄰量測差的加／減 2π、逐點遞推、不平滑原始資料、未知 k 的重新 Wrapped 一致性、invalid / 非有限值、缺口不跨接、π 方向歧義與 malformed input。
- 390／620／1440px 的互動、18px 正文、方向鍵逐像素移動、四步前後導覽與頁面無水平溢出均有瀏覽器測試；不再把內容總高度較短當成教學品質指標。第 4 步不掛載 3D；前 3 步的候選仍使用相同材質，不以 Ground Truth 突出其中一張。
- `node scripts/capture-learning.mjs` 更新實際 PNG 與 [learning-verification.json](evidence/learning-verification.json)，包含主視圖相位、k 候選、缺口起點與曲線分段。WebGL 健康檢查取自第 3 步。畫面：[桌面對照區](evidence/learning-unwrapping-desktop.png)、[620px 對照區](evidence/learning-unwrapping-preview.png)、[390px 對照區](evidence/learning-unwrapping-mobile.png)。先前 connected／summary PNG 是舊三小頁產物，不代表目前介面。
- 此頁只計算 1D Spatial Unwrap；Temporal 部分為概念對照。教學遮罩不是物理遮擋，不改寫 captures、原始有效率或誤差評估。完整資料路徑見 [Phase Unwrapping 教學模型](phase-unwrapping-lesson.md)。
- 本次修改的程式與文件通過 Prettier。全專案 `npm run format:check` 仍回報 4 個既有檔案：`src/sandbox/PointCloudPage.tsx`、`src/sandbox/Sandbox.tsx`、`src/sandbox/scanner.test.ts`、`e2e/sandbox.spec.ts`；已用 `git diff --exit-code HEAD -- ...` 確認它們未被本次修改，不做無關重排版。
- Three.js lazy chunk 為 566.35 kB（gzip 142.33 kB），build 的 500 kB 非阻斷體積提示仍保留。

## 先前 3D 沙盒驗收（歷史紀錄）

- `npm test`：99 項單元測試、4 個測試檔通過。
- `npm run test:production`：strict TypeScript 與 Vite build 通過，同一套 21 項 Chromium 驗收在 production dist 全數通過。
- 覆蓋首次直接進入 3D、返回教學、觀察視角旋轉不改變 Camera Captures、物體移動後清除舊結果、重新掃描、點雲來源、窄視窗標籤完整、專注 3D 空間與 CSV 匯出。
- `scripts/capture-sandbox.mjs` 實際產生 6,912 筆像素資料、14 欄 CSV，以及 PNG 場景。620 / 390px 無頁面水平溢出，page errors=0。
- 科學資料邊界、單週期假設與已知 Calibration 限制見 [sandbox-model.md](sandbox-model.md)；畫面證據見 [sandbox-preview.png](evidence/sandbox-preview.png) 與 [sandbox-verification.json](evidence/sandbox-verification.json)。
- Three.js lazy chunk 現約 534.37 kB（gzip 132.59 kB），仍有 500 kB 體積提示；未隱藏警告。

以下保留 MVP 1 一維模式的數學與歷次驗證範圍；不應將其中「尚無 3D」的歷史範圍描述套用到獨立的 3D 沙盒。

## 執行環境

- Windows 11，Node.js 22.14.0，npm 10.9.2。
- React / TypeScript / Vite；數值核心不依賴 DOM 或 Three.js。
- 依賴由 package-lock.json 鎖定；`npm audit` 回報 0 vulnerabilities。
- 沒有既有程式碼或 Git 基線可比較；未初始化 Git，未 commit / push。

## 驗收結果

| 項目                                 | 實際結果                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| 數學核心單元測試                     | 78 passed，包含解析解、四象限、分支、門檻、clipping、非有限值、Seed、GT 隔離、Monte Carlo |
| 參數與 CSV 單元測試                  | 4 passed，包含 schema、round-trip、無效輸入拒絕、儲存邊界與完整像素 CSV                   |
| 全部單元測試                         | 82 passed / 2 files                                                                       |
| Chromium 端對端測試                  | 15 passed / 5 files；production dist 同一套 15 項亦全部通過                               |
| strict TypeScript + production build | 通過；僅下述 Three.js 檔案體積提示                                                        |
| Prettier 檢查                        | 通過                                                                                      |
| 瀏覽器 console page errors           | 0；見 evidence/browser-verification.json                                                  |
| WebGL                                | WebGL2 context 可建立、未遺失、實際渲染 canvas，可拖曳旋轉                                |
| 行動版                               | 390×844 viewport 無頁面水平溢出；圖表不將文字縮成固定 800px viewBox 的 45%                |
| Reduced motion                       | WebGL 以 render-only change handler 運作，無 update → change 遞迴                         |
| PNG                                  | 實際下載，驗證 PNG signature 與 1600×1120 IHDR 尺寸                                       |
| CSV                                  | 實際下載，預設 98,304 筆像素資料，另有表頭與 metadata；最後座標為 (511,191)               |
| JSON                                 | 真正匯出後再匯入；無效內容不能改變當前實驗                                                |
| 保存參數                             | 真正寫入 localStorage、讀回、reload 還原；另測 quota 失敗與無效寫入保留原資料             |
| Seed                                 | 對同 config / Seed 比較實際 canvas 像素輸出完全相同；改 Seed 後不同；還原後相同           |
| 解算診斷                             | 顯示從 captures 估計的 Â / B̂；未 clipping 的 A / B 改變不改變 phase                       |

## 數值基準

Node.js 執行純數學核心，512×192、f=6、φ₀=0.6、A=0.5、B=0.4、Seed=42：

- Noise=0：Circular Phase RMSE = 1.397735073462211×10⁻¹⁵ rad，98,304 / 98,304 有效。
- B=0.06、σ=0.025：Circular Phase RMSE = 0.359335488316176 rad，97,165 / 98,304 有效（Ratio 0.9884134928385416）。
- B=0、σ=0：0 / 98,304 有效，RMSE=null；介面顯示 N/A，不顯示完美的 0。
- A=0.99、B=0.4：0 / 98,304 有效，RMSE=null；所有像素至少一個曝光達 hard clipping 邊界。

瀏覽器與 Node 的 transcendental 浮點尾數可略有不同。介面將低於 10⁻¹² rad 的值標為 `< 10⁻¹²`，不宣稱物理量測零誤差或跨引擎 bitwise identical。

更多 Monte Carlo、相位正負號與 Relative Unwrap 驗證見 [math-validation.md](math-validation.md)。

## 科學界線

- Decoder / Unwrap 不接受 referencePhase、真實頻率、初始相位或 depth 作為輸入。
- Reference 只進入 evaluator 與明確標記的 CSV reference 欄位。
- Unwrap 不跨 invalid gaps，各連續區段仍有未知 2π 整數偏移。
- 此版沒有 Camera–Projector 幾何、Calibration 求解、occlusion、depth 或 3D Reconstruction。
- Three.js 的平面紋理不參與量測，不從 GPU readback 偽裝 Camera Captures。
- Noise 與 clipping 僅為基礎數學擾動；Defocus、Interreflection、完整 sensor / radiometry 尚未實作。
- Validity 門檻不是 confidence interval；Circular RMSE 無法診斷整數週期錯誤。

## 已知非阻斷提示

Vite production build 的 lazy-loaded Three.js chunk 約 502.95 kB（gzip 約 124.88 kB），觸發預設 500 kB chunk-size 提示。Three.js 已與主介面分離，只有開啟 WebGL 示意時才載入。沒有關閉或調高 warning 門檻來隱藏提示。

## 真實瀏覽器產物

- [桌面實驗介面](evidence/desktop.png)
- [行動版實驗介面](evidence/mobile.png)
- [WebGL 示意](evidence/webgl.png)
- [實際匯出的 PNG](evidence/default-experiment.png)
- [實際匯出的 JSON 參數](evidence/default-parameters.json)
- [機器可讀瀏覽器驗證](evidence/browser-verification.json)

重新產生畫面證據：先啟動 `npm run dev`，再執行 `node scripts/capture-evidence.mjs`。腳本使用隔離的瀏覽器 context，不載入個人登入資料。

## 獨立審查與競態修正

首輪審查服務回傳 HTTP 400，沒有結論，未計為通過。乾淨重試的獨立審查沒有發現安全問題或數學核心的 Ground Truth 洩漏，並指出一個可重現的 medium 邏輯問題：舊 JSON 的非同步讀取可能覆蓋較新的成功匯入，舊的失敗也可能顯示過期錯誤通知。

先新增兩個 Chromium 回歸測試並看到預期失敗（9.0 被覆蓋成 2.0，以及出現過期 alert），再於 App 的匯入流程加入單調遞增的 request generation，對成功與 catch 路徑都拒絕過期結果。主流程讀回最終修改，重新驗證：82 項單元測試、11 項 dev Chromium 測試，以及相同 11 項 production dist 測試皆通過。

先前的獨立審查 `passed:false` 並未被改寫成最終獨立核准；本紀錄區分獨立發現與修復後的主流程實測。非阻斷建議：WebGL 目前改參數會重建簡單示意 scene，可在後續改成更新 texture 以保留視角。
