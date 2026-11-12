# Phase Unwrapping 教學模型

入口：`?workspace=guided` → 開始 → 「4 解開週期」，或從第 3 步的「下一步：理解 Phase Unwrapping」進入。

## 同一視野直接對照

保留原本教學內容與 rad 單位，取消先前的三個小畫面。主圖預設同時顯示 Wrapped 與 Relative Unwrapped，採同一座標；所選像素的 φ／Φ 數值直接標在曲線上，以同色對應旁邊的資料與計算式。操作探針時三者同步更新，不必靠記憶比較前後畫面。

620×950px 的測試確認圖與 live formula 同時位於視窗內。手機以公式緊貼圖的方式排列，仍保留 14px 刻度與可操作探針。若兩個值重合，合併為 φ=Φ 的標籤；若該點無效，不顯示錯誤的數值標籤或偽造計算結果。原本的練習、圈數、遮罩與完整說明仍在同頁。

第 4 步以數學圖與計算式為主；前 3 步的 3D 示意及獨立主沙盒保留。

## 進階模型：從一圈內的角度，接回相鄰像素

三步 decoder 的輸出 `φ(x)` 在 `[−π, π)` 內。相鄰像素走過 +π 時，Wrapped 值可能從接近 +π 變成接近 −π；這種表示法的跳變，不應直接解讀成物體深度斷層。

本課實際呼叫 `src/core/simulation.ts` 的 `unwrapRows`，沒有另一套替代解算：

```text
d(x) = φ(x) − φ(x − 1)
d′(x) = wrap(d(x)) ∈ [−π, π)
Φ(x) = Φ(x − 1) + d′(x)
```

- `d < −π`：加 2π。
- `d > +π`：減 2π。
- `|d| < π`：保留差值，不做平滑。
- `|d| = π`：兩個方向同樣短，不能唯一判定真實方向。核心的區間慣例會選一邊；教學以 `1e−12 rad` 的數值容差標記這個邊界附近，不把它當作可靠的修正練習。
- 每個有效連續區段從 `Φ(x₀) = φ(x₀)` 起算。invalid 或非有限值保持 NaN；缺口後重設錨點，不跨缺口插值。

主視圖同時顯示所選像素的左鄰居／目前 Wrapped、直接差值、最短相位差及逐點遞推。使用者仍可選擇加 2π、不改或減 2π，查看由同一筆量測差值算出的結果。回饋以連續性假設為前提，不宣稱知道真實方向。

## 假設不能省略

上述局部方法需要相鄰**真實**相位差的絕對值嚴格小於 π。深度斷層、取樣不足或雜訊可能讓它接錯整圈；僅憑 Wrapped 資料，不能判定一個大跳變究竟是 wrap 邊界還是真實斷層。接得連續不是正確性的證明。

本課是逐列的一維方法，不是完整 2D quality-guided、branch-cut 或 least-squares unwrapping。

## Relative 不是 Absolute，更不是深度

對任一連續區段：

```text
Φₖ(x) = Φ(x) + 2πk, k 為整數
wrap(Φₖ(x)) = φ(x)
```

因此整段移動一圈後，三張照片對應的週期內相位仍相同。按鈕 k = −1／0／+1 只展示候選族，不是估計出了真實 k；圖上的整體平移不會送回 decoder 或改寫 captures。

每個不連通區段可各有獨立的整數偏移。畫面的單一 k 控制只展示所有區段一起移動的部分候選，並不排除各段分別移動的可能。

額外編碼、參考錨點或足夠的範圍／幾何約束，才可能選出絕對條紋序號。Spatial Unwrapping 借用相鄰像素；Temporal Unwrapping 則加入同一像素的不同頻率曝光，需先有測量範圍內無歧義的低頻對應。本課只實算 Spatial 方法，Temporal 的文字對照不是本頁新增的演算法。3D 沙盒另有兩頻時間解包，與 Micro PS 不同。

知道絕對對應後，仍須 Camera–Projector Calibration 與 Triangulation 才得到 3D。本課不產生 depth 或 depth RMSE。Circular Phase RMSE 對整數 2π 偏移不敏感，不能單獨拿來驗證是否接對圈。

## 資料路徑與教學遮罩

```text
實際 captures → decodeThreeStep → phase.wrapped / phase.valid
                                      ↓ 選取目前 row
                                buildUnwrapLesson
                                      ↓
                                  unwrapRows
                                      ↓
                         相對曲線、差值練習、k 候選族
```

`buildUnwrapLesson` 只接受解碼後的 row／valid mask 及展示選項，不接受 referencePhase、frequency、phaseOffset、物體座標或 depth。它複製輸入後操作，不修改原始 buffers。`describeUnwrapTransition` 使用和核心相同的 `wrapPhase` 規則來解釋相鄰差值。

「加入無效區段」會在該列中央約 8% 的位置加教學遮罩，並重新執行同一個 unwrap。這不是物理遮擋，也不改變曝光、既有有效率或誤差評估。移除遮罩即回到原資料。

前 3 步的 3D illustration 候選光平面使用相同材質／透明度，不利用已知表面位置突出某個候選。第 4 步不掛載此示意，也不把連續曲線說成已重建的幾何。

## 測試與實際畫面

- `src/lib/unwrappingLesson.test.ts`：15 項測試，包含加／減週期、無跨界、k 候選重新 Wrapped 一致、來源不變、無效缺口重新錨定、非有限值、π 邊界及不合法輸入。
- `e2e/unwrapping-lesson.spec.ts`：6 項 Chromium 測試，保留原有手動修正、unwrap 曲線、k 候選、遮罩分段與 390／620／1440px 的操作驗證。
- `e2e/unwrapping-layout.spec.ts`：3 項 Chromium 測試，確認同一視窗中的圖／數值／公式同步、重合標籤合併，以及無效點不留下舊標籤或假結果。
- `scripts/capture-learning.mjs`：隔離的真實 Chromium session，重新產生新手教學與 Unwrapping PNG，並把實測差值、k 候選、分段、WebGL 與 overflow 結果寫入 `docs/evidence/learning-verification.json`。

重跑：啟動 `npm run dev` 後執行 `node scripts/capture-learning.mjs`。完整回歸則執行 `npm test` 與 `npm run test:production`。
