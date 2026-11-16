---
version: 1
slug: "src-path-pathhome-tsx"
primary_target: "src/path/PathHome.tsx"
related_targets: ["src/path/StationPage.tsx"]
---

Mode: Operate（首頁、站點外框、導覽）；各站理論頁為 Read。

Audience & job: 專案作者本人與日後公開的學習者。要能隨時回答「我在哪一站、下一步做什麼、手上有哪些產出」，最終從零建出「拍攝 → 校正 → 相位 → 重建 → 多視角 Fusion」的完整 pipeline。

Stations（依實作與依賴順序；可自由選站；通過條件為軟門檻，只提示、不阻擋）：
1 系統與相機模型 · 2 Camera Calibration · 3 Phase Shifting · 4 Phase Unwrapping · 5 Projector Calibration（需要 3–4 的相位）· 6 掃描與重建 · 7 誤差與診斷（規劃中）· 8 多視角座標統合 · 9 多視角 Fusion。
第 8–9 站一開始就架多台裝置（前面已有單套裝置的點雲）。
工作台（不計進度）：3D 沙盒、點雲分析、AOI 多視角評估、1D 自由實驗。

Phase 1 scope: 首頁、站點外框、導覽、Ctrl+K、工作台選單；把現有頁面與 Calibration 課程拆進各站；產出全部先用參考值，但來源標籤（你的結果／參考值／尚未產生）要先做出來。Phase 2 才串起實際產出與實驗室保存；Phase 3 補多視角自有點雲與第 7 站。

Must stay: 所有現有實驗功能、真值隔離、舊 `?workspace=` 網址可用、DESIGN.md 視覺系統。
Anti-goals: 硬性鎖關；第二套路線圖；把參考值偽裝成學習者的結果；出現 Micro Phase Shifting 字樣。

## Direction contract

THESIS: 首頁先回答「接著做什麼」，不是目錄；拒絕「一排互跳按鈕＋各頁各自的路線圖」。
OWN-WORLD: Darkroom 底、Phosphor Mint 只標完成／目前／主動作；九站畫成定向越野路線：編號檢查點圓圈與連線，完成實心、目前雙圈、未開始空心、規劃中虛線；來源標籤：薄荷＝你的結果、琥珀＝參考值、虛線灰＝尚未產生。
STORY: 學習者一眼看到目前站與下一步，點「回到實驗」接續；需要時從路線任選一站；每站先讀理論、再做實驗、看檢核是否通過。
FIRST VIEWPORT: 頁首：品牌、麵包屑「第 n / 9 站 · 名稱」、Ctrl+K 站點搜尋、工作台選單。下方滿寬「繼續：第 n 站」卡（雙圈編號、標題、一句說明、理論／實驗／檢核狀態、主按鈕）。中段左側為定向越野路線（約 2/3 寬），右側為「我的專案產出」清單；最底一列工作台連結。
FORM: 接續優先（resume-first），grounded list #7；seed:433115a7d5daeffe
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Open decisions: 通過條件數值（先由實作者訂草案）；第 1 站實驗內容（沙盒擺 rig）。
