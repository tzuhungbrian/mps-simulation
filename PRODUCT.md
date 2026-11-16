# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **主要：專案作者本人。** 一邊自學結構光，一邊研究 AOI 多視角設備的設計（Pair 量測範圍、Fusion 策略）。在桌機大螢幕上長時間操作、比對參數與結果。
- **次要：公開的結構光學習者。** 任何想從零理解結構光的人；預期日後公開發佈後才會出現。具備基本工程或數學背景，但不一定熟悉相位、校正或三角量測。

共同的工作：理解每一步在算什麼，並最終**能獨立建出完整流程：拍攝 → 相位解碼 → 解包 → 校正 → 三角量測 → 3D 重建（→ 多視角 Fusion）**。

## Product Purpose

Structured Light Lab · 結構光實驗室：互動式結構光教學與研究環境。從 Phase Shifting、Phase Unwrapping，到相機模型、Camera / Projector Calibration、三角量測與多視角座標統合 / Fusion，每一步都可以動手操作並看到實際計算結果。

成功的定義：學習者不靠本專案，也能自己架起「拍攝 → 3D 重建」的完整 pipeline。Micro Phase Shifting 不是終點。

## Positioning

- **全部在本機瀏覽器計算**：不需安裝、沒有後端、不上傳量測或參數。
- **真值與重建嚴格隔離**：畫面上的相位、點雲、校正參數都是從模擬影像實際反算出來的；真值只用於評分與誤差圖，不參與重建，也不會拿來替換失敗結果。
- **每個單元 = 理論課 + 任務導向 3D 實驗**：理論對應 OpenCV 函式與公式（概念與公式，不做完整推導）；實驗中學習者用自己估出的參數完成任務。
- **可以故意調出失敗**：雜訊、clipping、互反射、級次錯誤、失焦、遮擋等，讓學習者看到演算法在哪裡、為什麼出錯。
- **AOI 多視角評估**：各 Pair 的量測範圍、感度與 Fusion 策略的理論與模擬比較。

## Operating Context

- 桌機瀏覽器（WebGL），以網址參數切換工作區：`?workspace=sandbox`（3D 沙盒）、`guided`（一步一步學）、`explore`（自由實驗）、`aoi`（AOI 多視角）、`calibration`（校正課程）、`calib-lab`（3D 校正實驗）。
- 匯出 CSV / JSON / PNG，供外部工具分析與跨工作階段重現；參數以 localStorage 保存在本機。
- 教學內容對照 OpenCV（例如 `calibrateCamera`、`solvePnP`、`stereoCalibrate`、`triangulatePoints`），讓學到的東西能直接轉換到真實專案。

## Capabilities and Constraints

已具備：
- 1D 三步相移數學實驗與「一步一步學」（Phase Shifting → Spatial Unwrap）。
- 3D 沙盒：BVH 光線追蹤、GGX 材質、可選互反射、N 步相移、時間相位解包、ray–plane 三角量測、點雲誤差分析。
- AOI 多視角模式：1–8 台 Camera / Projector、Pair 理論與模擬、Fusion、Benchmark 與參數掃描。
- 校正課程與 3D 校正實驗：棋盤格偵測、Camera / Projector Calibration、對焦呼吸、校正助理。

約束：
- 介面為繁體中文，技術名詞保留英文。
- 本專案**沒有實作 Micro Phase Shifting**；一般 N 步相移不得標示為 MPS。
- 理想模擬精度不代表實機 AOI 性能，介面必須如實標示簡化與限制。
- 機密的廠商 AOI 資料只存在 git-ignored 的 `src/local/*.preset.json`，不得出現在受版控的程式碼、測試或文件中。`npm run build` 會把它打包進 `dist/`，公開發佈的 build 必須排除。

課程 roadmap：Ch1 相位（Phase Shifting、Phase Unwrapping）→ Ch2 幾何（相機模型 + 三角量測、Camera Calibration、Projector Calibration）→ Ch3 實戰（系統設計、誤差來源與診斷、從頭架設 capstone）→ Ch4 多視角（座標統合、Fusion）。

尚未決定：
- Gamma 是否放在「誤差來源與診斷」。
- 「系統設計」放在校正之前還是之後。
- Capstone 只做模擬，還是附上實機架設指南。
- 角點偵測使用「真值 + 雜訊」還是影像偵測。
- 公開發佈的平台與時程。

## Brand Commitments

- 名稱：**Structured Light Lab · 結構光實驗室**。
- 語氣：誠實、精確。明確區分「已完成 / 簡化模型 / 尚未實作」，不誇大能力。

## Evidence on Hand

- 驗證紀錄與數學驗證：`docs/verification.md`、`docs/math-validation.md`、`docs/sandbox-model.md`、`docs/phase-unwrapping-lesson.md`。
- 實際匯出產物：`docs/evidence/`（瀏覽器驗證、預設參數、學習流程驗證、沙盒 CSV 與驗證 JSON）。
- 單元測試（Vitest）與 Playwright e2e 測試。
- 目前**沒有**使用者見證、實機量測比對或外部 benchmark，未來設計不得捏造。廠商參考值屬機密，不可公開引用。

## Product Principles

1. **結果必須是算出來的。** 真值只用來評分，不替換、不美化失敗的重建結果。
2. **失敗是教材。** 讓學習者能主動製造並看見失敗模式，而不是只展示理想情況。
3. **如實命名。** 標示簡化、限制與名詞的正確範圍（N 步 PS ≠ MPS；模擬 ≠ 實機）。
4. **理論與實作成對。** 每個概念都要有公式、OpenCV 對應，以及能動手驗證的實驗。
5. **本機、私密。** 不需要後端，不上傳資料。

## Accessibility & Inclusion

- 教學正文 18–20 px，圖表刻度至少 14 px；重視長時間閱讀的可讀性。
- 以桌機大螢幕為主，但教學頁必須在 390 px 寬也能使用；已驗證 390 / 620 / 1440 px。
- WebGL 不可用時，2D 數學實驗仍須可用。
- 曲線探針可用鍵盤操作。
