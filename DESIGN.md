---
name: Structured Light Lab · 結構光實驗室
description: 在暗室般的介面裡，讓光、相位與點雲成為主角的結構光教學與研究平台。
colors:
  phosphor-mint: "#5ee4bd"
  phosphor-mint-hover: "#7ef0cf"
  phosphor-mint-soft: "#88e0bc"
  mint-ink: "#8fd8c0"
  mint-wash: "#11231f"
  mint-deep-ink: "#0b2118"
  mint-edge: "#2f7a63"
  camera-cyan: "#69d9ff"
  projector-lavender: "#b7a0fa"
  estimate-amber: "#ffd166"
  error-salmon: "#ff9b85"
  stale-amber-ink: "#ffe1a5"
  stale-amber-wash: "#302818"
  amber-edge: "#746241"
  darkroom-black: "#0c1017"
  instrument-well: "#0b1118"
  bench-surface: "#0f161f"
  formula-well: "#121a24"
  raised-surface: "#141c26"
  raised-surface-hover: "#1d2834"
  hairline: "#263240"
  control-edge: "#3a4757"
  scrim: "#05080ccc"
  text-primary: "#e7edf5"
  text-secondary: "#c6d2df"
  text-muted: "#a6b4c4"
  text-label: "#93a4b8"
  text-faint: "#7f8fa3"
  sandbox-panel: "#0f1925"
  sandbox-field: "#102232"
  sandbox-field-edge: "#3f5870"
  sandbox-field-text: "#d2e3f2"
  sandbox-accent: "#8de2c6"
typography:
  display:
    fontFamily: "Segoe UI, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "clamp(32px, 4.3vw, 48px)"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-1px"
  headline:
    fontFamily: "Segoe UI, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "Segoe UI, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.4
  subtitle:
    fontFamily: "Segoe UI, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.5
  body-lesson:
    fontFamily: "Segoe UI, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.8
  body-article:
    fontFamily: "Segoe UI, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.8
  body-tool:
    fontFamily: "Segoe UI, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Segoe UI, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: "Segoe UI, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "Consolas, SFMono-Regular, Liberation Mono, monospace"
    fontSize: "13px"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  xs: "4px"
  sm: "6px"
  md: "7px"
  lg: "8px"
  xl: "10px"
  2xl: "12px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.phosphor-mint}"
    textColor: "{colors.darkroom-black}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.phosphor-mint-hover}"
    textColor: "{colors.darkroom-black}"
  button-secondary:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.raised-surface-hover}"
  button-lesson-primary:
    backgroundColor: "{colors.phosphor-mint-soft}"
    textColor: "{colors.mint-deep-ink}"
    rounded: "{rounded.md}"
    padding: "14px 22px"
    height: "54px"
  chip-current:
    backgroundColor: "{colors.darkroom-black}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "2px 10px"
  chip-done:
    textColor: "{colors.mint-ink}"
    rounded: "{rounded.sm}"
    padding: "2px 10px"
  chip-default:
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    padding: "2px 10px"
  input-numeric:
    backgroundColor: "{colors.sandbox-field}"
    textColor: "{colors.sandbox-field-text}"
    typography: "{typography.mono}"
    rounded: "{rounded.xs}"
    padding: "3px 6px"
    width: "78px"
  metric-tile:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
  formula-block:
    backgroundColor: "{colors.formula-well}"
    textColor: "{colors.text-primary}"
    padding: "4px 18px"
  lab-panel:
    backgroundColor: "{colors.bench-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.2xl}"
    padding: "18px"
  button-path:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "40px"
  button-path-primary:
    backgroundColor: "{colors.phosphor-mint}"
    textColor: "{colors.darkroom-black}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
    height: "48px"
  control-mark:
    backgroundColor: "{colors.darkroom-black}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.circle}"
    size: "28px"
  control-mark-partial:
    backgroundColor: "{colors.darkroom-black}"
    textColor: "{colors.phosphor-mint}"
  control-mark-done:
    backgroundColor: "{colors.phosphor-mint}"
    textColor: "{colors.darkroom-black}"
  control-mark-planned:
    backgroundColor: "{colors.darkroom-black}"
    textColor: "{colors.text-faint}"
  control-mark-current:
    backgroundColor: "{colors.mint-wash}"
    textColor: "{colors.text-primary}"
  source-tag-mine:
    textColor: "{colors.phosphor-mint}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
  source-tag-reference:
    textColor: "{colors.estimate-amber}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
  source-tag-missing:
    textColor: "{colors.text-faint}"
    typography: "{typography.caption}"
    rounded: "{rounded.xs}"
    padding: "0 8px"
  path-nav-button:
    backgroundColor: "{colors.raised-surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "5px 12px"
    height: "34px"
  path-nav-station:
    backgroundColor: "{colors.mint-wash}"
    textColor: "{colors.text-primary}"
  path-menu:
    backgroundColor: "{colors.bench-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "8px"
    width: "280px"
  station-switcher:
    backgroundColor: "{colors.bench-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.2xl}"
    width: "min(620px, calc(100vw - 32px))"
  station-tab:
    textColor: "{colors.text-muted}"
    padding: "8px 18px"
    height: "46px"
  station-tab-selected:
    textColor: "{colors.text-primary}"
  resume-card:
    backgroundColor: "{colors.mint-wash}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "24px 28px"
  activity-card:
    backgroundColor: "{colors.bench-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "14px 18px"
  activity-card-primary:
    backgroundColor: "{colors.mint-wash}"
    textColor: "{colors.text-primary}"
---

# Design System: Structured Light Lab · 結構光實驗室

## Overview

**Creative North Star: "The Darkroom Optical Bench"（暗室光學平台）**

結構光實驗本來就在暗處進行：關燈，只留投影的條紋與相機的讀數。介面延續這個場景，以接近黑的深藍灰（`darkroom-black`）為底，介面本身退到背景，讓條紋影像、相位圖、點雲、公式成為畫面上最亮的東西。整套系統只有一個強調色：**Phosphor Mint（螢光薄荷）**，像示波器上的螢光軌跡，只出現在「現在在這裡」、「下一步做這個」、「這筆資料有效」三種地方。

密度依工作區調整，但規則一致。教學頁（一步一步學、Calibration 課程）是閱讀優先：18–20 px 正文、1.8 行高、860 px 以內的段落寬度。工具頁（3D 沙盒、AOI、3D 實驗室）是操作優先：15 px 正文、緊湊的數值欄位、等寬數字。兩者共用同一套色彩、邊框與元件語言，所以從課程跳到實驗室不會像換了一個產品。

層次只靠色階與 1 px 細邊框表達，不使用陰影，不使用漸層，也不靠裝飾性發光。明確拒絕「AI SaaS 儀表板」的常見樣式：紫藍漸層、卡片套卡片、裝飾性 glow、每個標題上方都放一個圓角圖示方塊。

**Key Characteristics:**

- 暗室底色，介面安靜，資料與影像是主角。
- 單一強調色 Phosphor Mint，少量使用，作為訊號。
- 裝置與資料有固定的顏色語意：Camera 青、Projector 淡紫、估計值琥珀、真值白、錯誤鮭紅。
- 平面：用色階與細邊框分層，沒有陰影。
- 數字一律等寬、表格數字（tabular-nums）。
- 繁體中文為主，技術名詞保留英文；字型堆疊以 Segoe UI + Microsoft JhengHei 為主。

## Colors

深藍灰的暗室中性色，加一個螢光薄荷強調色，再加上一組只用於資料語意的裝置色。

### Primary

- **Phosphor Mint**（#5ee4bd）：主要動作按鈕（進入 3D 實驗室、拍攝、執行校正）、目前所在位置（路線圖「本頁」、啟用中的步驟／分頁）、有效或通過的資料（偵測成功的角點、✓ 標記）、焦點框、slider 與 checkbox 的 `accent-color`。Hover 時提亮為 **#7ef0cf**。
- **Soft Phosphor**（#88e0bc）：教學頁的大型主要按鈕；文字配 **Mint Deep Ink**（#0b2118）。比主色柔和，避免長時間閱讀時太刺眼。
- **Mint Ink**（#8fd8c0）：連結、目錄、管線圖中的箭頭等「可前往」的文字。
- **Mint Wash**（#11231f）：目前項目、callout 的底色，搭配 Phosphor Mint 邊框。學習路徑的「繼續」卡、主要實驗卡、目前站的檢查點圓圈也用它。
- **Mint Edge**（#2f7a63）：低一階的薄荷邊框：導覽列的目前站按鈕、已完成的理論／實驗小標籤、「你的結果」來源標籤；也是文字反白（`::selection`）的底色。表示「屬於目前／已完成」，但不搶主動作。

### Secondary（資料語意色，只用於代表裝置或資料，不作為 UI 強調色）

- **Camera Cyan**（#69d9ff）：Camera 本體、視錐、Camera 射線。
- **Projector Lavender**（#b7a0fa）：Projector 本體、視錐、光平面，以及多序列圖的第二條線。
- **Estimate Amber**（#ffd166）：「估計值」與「目前選取」：估計的 Projector／主點、選取中的拍攝縮圖、任務清單標題。在學習路徑中也代表「參考值」來源：不是學習者自己算出來的資料。邊框用 **Amber Edge**（#746241）。
- **Error Salmon**（#ff9b85）：錯誤、重投影誤差向量、失敗標記（`.bad`）。
- **Stale Amber**（文字 #ffe1a5、底色 #302818、邊框 #746241）：結果已過期、正在重算的提示。

### Neutral

- **Darkroom Black**（#0c1017）：頁面底色（課程、教學、實驗室）。
- **Instrument Well**（#0b1118）：影像、SVG 示意圖、canvas 的底，比頁面再暗一階，讓影像像放在凹槽裡。
- **Bench Surface**（#0f161f）：大型實驗區塊（`.calib-lab`）的底色。
- **Formula Well**（#121a24）：公式區塊的底色。
- **Raised Surface**（#141c26）：次要按鈕、管線圖節點、指標磚的底色；hover 為 **#1d2834**。
- **Hairline**（#263240）：區塊分隔線、h2 上緣線、表格列線、canvas 外框。
- **Control Edge**（#3a4757）：按鈕、下拉選單等可操作元件的邊框；也是檢查點圓圈的未完成外框與路線圖連線的顏色。
- **Scrim**（#05080ccc）：站點切換對話框（`<dialog>`）後方的遮罩。
- **Text Primary**（#e7edf5）：正文與數值；在 3D 場景中也代表「真值」。
- **Text Secondary**（#c6d2df）：導言段落、說明文字。
- **Text Muted**（#a6b4c4）：圖說、工具列文字。
- **Text Label**（#93a4b8）：欄位標籤、表頭、指標名稱。
- **Text Faint**（#7f8fa3）：次要提示、「規劃中」狀態。

### Sandbox 變體

3D 沙盒有一組自己的 CSS 變數（`.sandbox-shell` 上的 `--sb-*`），色溫偏藍：panel #0f1925、field #102232、field 邊框 #3f5870、accent #8de2c6。這是現有實作的分支，不是另一套系統；新工作區請使用上面的主中性色。

### Named Rules

**The Phosphor Signal Rule.** Phosphor Mint 只代表三件事：主動作、目前位置、有效資料。不拿來當裝飾、插圖填色或大面積背景（Mint Wash 除外）。一個畫面上同時出現的 Phosphor Mint 主按鈕不超過一個。

**The Device Color Rule.** Camera 永遠是青色、Projector 永遠是淡紫、估計值永遠是琥珀、真值永遠是白色。同一個概念在 3D 場景、SVG 示意、圖例中都使用同一個顏色，真值與估計值絕不共用顏色。

**The Honest Source Rule.** 每一筆跨站使用的產出都標示來源：薄荷＝你的結果、琥珀＝參考值、灰色虛線＝尚未產生。參考值絕不使用薄荷，也不省略標籤，避免把參考值偽裝成學習者自己的結果。

## Typography

**Body Font:** Segoe UI（fallback：Microsoft JhengHei、system-ui、sans-serif）
**Mono Font:** Consolas（fallback：SFMono-Regular、Liberation Mono、monospace）
**Math:** KaTeX（公式字級為正文的 1.08 倍，公式區塊內 1.18 倍）

**Character:** 系統字型的無襯線體負責中英混排的可讀性，等寬字負責所有數值與程式碼，讓讀數看起來像儀器輸出。舊版的 1D 儀表板根層字型堆疊以 Inter 開頭，在 Windows 上通常會退回 Segoe UI。

### Hierarchy

- **Display**（600，clamp(32px, 4.3vw, 48px)，1.4，字距 −1px）：教學單元的開場標題。
- **Headline**（700，34px，1.3）：課程文章 h1。學習路徑的站點標題同為 34px／700／1.25；首頁「繼續」卡標題為 34px／650／1.3。860px 以下站點標題降為 26px、「繼續」卡標題降為 24px。
- **Title**（700，26px）：課程章節 h2，上方有 Hairline 分隔線與 18px 間距。檢核頁的「通過條件」也是 26px，但不加上緣線。
- **Subtitle**（700，20px）：h3，顏色 #cfe0f0。學習路徑首頁的區塊標題（九站路線、我的專案產出）與站內實驗區塊標題也是 20px，字重 650、行高 1.4。
- **Body – Lesson**（400，18px，1.8）：一步一步學的正文；導言 20px／1.95。
- **Body – Article**（400，17px，1.8）：Calibration 課程正文；段落最寬 860px。
- **Body – Tool**（400，15px，1.6）：沙盒、3D 實驗室等操作介面。
- **Label**（400，14px，1.4）：欄位標籤、按鈕、表格。
- **Caption**（400，13px）：圖說、場景提示、圖例。學習路徑中用於站點狀態（已通過／進行中 · 檢核 1/2）、來源標籤、產出出處、工作台選單說明與切換器的副行。
- **Mono**（400，13px，tabular-nums）：數值欄位、指標、座標、像素讀數。

### Named Rules

**The Readable Lesson Rule.** 教學頁正文不小於 18px，圖表刻度不小於 14px；工具頁才可以降到 15px。

**The Instrument Digits Rule.** 會變動的數字一律使用等寬字或 `font-variant-numeric: tabular-nums`，避免數值更新時文字跳動。

## Layout

- **課程與教學頁**：單欄文章，容器最寬 1080–1180px，左右 padding 28–32px；正文段落、公式、程式碼區塊限制在 860px 內。頂部 sticky header 使用半透明底色加 6px 模糊。
- **實驗區塊**：兩欄 grid，左側 290px 的控制欄（sticky），右側是結果；1000px 以下改為單欄。
- **3D 實驗室**：兩欄 grid（`1.15fr` 場景 / `minmax(380px, 1fr)` 任務與結果），場景欄 sticky；1100px 以下改為單欄。
- **3D 沙盒**：滿版編輯器式工作區（100vh），左側參數分頁、中間 3D 視窗、右側指標。
- **學習路徑首頁**：容器最寬 1400px，padding 28px 28px 56px；最上方滿寬「繼續」卡，下方兩欄 grid（`minmax(0, 1fr)` 路線圖 / 360px 產出清單，間距 24px），最底一列工作台。1100px 以下改為單欄；860px 以下 padding 改為 16px，路線圖改為直列。
- **站點頁**：頁首與分頁列最寬 1180px、左右 padding 28px；內容沿用課程文章容器，輸入清單、實驗卡、檢核清單限制在 860px 內。
- 舊版各頁各自的路線圖已由學習路徑首頁的九站路線取代；不要再做第二套路線圖。
- **間距節奏**：4 / 8 / 12 / 16 / 20 / 28px；元件內距多為 6×12px，區塊間距 12–20px。
- **斷點**：主要在 560、680、860、1000、1100、1280px（860px 是學習路徑的手機版切換點）。教學頁必須在 390px 寬可用。
- 支援 `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast: more`。

## Elevation & Depth

系統是平面的。深度靠「色階往下挖」而不是「往上浮」：頁面是 Darkroom Black，影像與 canvas 放在更暗的 Instrument Well，可操作元件是略亮的 Raised Surface，再以 1px Hairline 或 Control Edge 邊框收邊。唯一的模糊效果是 sticky header 的 `backdrop-filter: blur(6px)`。

浮在內容上的層（工作台選單、站點切換對話框）也照同一套做法：Bench Surface 底、1px Control Edge 邊框、10–12px 圓角；對話框後方再加 Scrim 遮罩，把底下的頁面壓暗。

### Named Rules

**The No-Shadow Bench Rule.** 不使用 box-shadow 表達層級。需要區隔時，改用色階或 1px 邊框；需要強調時，改用 Phosphor Mint 邊框加 Mint Wash 底色。

**The Stale Dimming Rule.** 參數改變後、新結果算出之前，舊結果的透明度降到 0.45–0.55，並顯示 Stale Amber 提示；不讓過期結果看起來像目前的量測。

## Shapes

圓角小而一致，帶一點工具感：輸入框 4px、小按鈕與縮圖 6px、一般按鈕 7px、程式碼與指標磚 8px、callout 與示意區塊 10px、大型實驗區塊 12px。編號徽章是圓形。公式區塊沒有圓角，只有左側 3px 的 Phosphor Mint 邊線，像筆記本的頁邊標記。任務清單使用虛線邊框（#4b5d70），表示「待完成」。

學習路徑沿用同一套語言：檢查點是 2px 外框的圓圈，「規劃中」改為虛線外框；路線圖上規劃中的連線也是虛線（6 6）；「尚未產生」的來源標籤是虛線框。虛線一律代表「還不存在」。

## Components

### Buttons

- **Shape:** 7px 圓角，1px 邊框，內距 6px 12px，14px 字，圖示與文字間距 6px。
- **Primary:** Phosphor Mint 底、Darkroom Black 字、600 字重；hover 提亮為 #7ef0cf。
- **Secondary:** Raised Surface 底、Control Edge 邊框；hover 為 #1d2834。
- **Lesson Primary:** 教學頁的大按鈕：Soft Phosphor 底、Mint Deep Ink 字、內距 14px 22px、最小高度 54px。
- **Path（學習路徑）:** 一般 40px 高、內距 8px 16px、15px 字，樣式同 Secondary；主要按鈕 48px 高、內距 10px 20px、16px／600，Phosphor Mint 底，hover #7ef0cf。右側附 16–18px 箭頭圖示。每個分頁結尾的「下一步」區：上方 36px 間距、Hairline 上緣線、一個主要按鈕（讀完了，前往實驗／前往檢核／前往第 n 站）。
- **Text Button:** 13px、Text Label、底線 offset 3px，hover 變 Text Primary；用於「重設進度」這類低頻、會跳確認的動作。
- **Active / Toggle:** Phosphor Mint 邊框與文字，加上 Mint Wash 底。
- **Disabled:** 透明度 0.45，`cursor: not-allowed`。
- **Focus:** 全域 2px Phosphor Mint outline，offset 4px。按下時 `filter: brightness(0.88)`。

### Chips（站內進度）

- **Style:** 1px Control Edge 邊框、6px 圓角、內距 2px 10px、14px 字、tabular-nums；左側 15px 圖示（理論書本、實驗燒瓶、檢核清單；完成後換成勾號）。用在「繼續」卡中的「理論／實驗／檢核 n/m」。
- **State:** 已完成：Mint Edge 邊框、Mint Ink 字。目前這一部分：Phosphor Mint 邊框、Darkroom Black 底（在 Mint Wash 卡上往下挖）、Text Primary 字。未開始：Text Muted。
- 舊版課程路線圖的「圓形編號＋狀態字」項目已移除，由下方的 Control Mark 與 Course Map 取代。

### Cards / Containers

- **Corner Style:** 8–12px。
- **Background:** Bench Surface（實驗區塊）、Raised Surface（指標磚）、#101821（示意區塊）。
- **Shadow Strategy:** 無；見 Elevation & Depth。
- **Border:** 1px（#2f3d4d、#2a3644、Hairline）。
- **Internal Padding:** 14–18px；指標磚 6px 12px。

### Inputs / Fields

- **Numeric field（沙盒）:** 78px 寬、Sandbox Field 底、#3f5870 邊框、4px 圓角、13px 等寬、靠右對齊；上方標籤，下方整列 slider。
- **Slider / Checkbox:** 原生控制項，`accent-color` 使用 Phosphor Mint（沙盒用 #7ad9b2）。
- **Select:** Raised Surface 底、Control Edge 邊框、5px 圓角。
- **Focus:** 與按鈕相同的 2px Phosphor Mint outline。

### Navigation

- **Header:** sticky，半透明 Darkroom Black 加 6px 模糊，底部 1px 分隔線；左側是品牌（Phosphor Mint 圖示 + 名稱 + 13px 副標），右側是動作按鈕。
- **Tabs（沙盒）:** 平均分配寬度、14px 字；選中時文字變亮、底部 2px accent 線、底色 #13212f。
- **Step tabs（3D 實驗室）:** 一排次要按鈕，選中時套用 Active 樣式。
- **Path header:** 學習路徑頁的 header 內距 10px 28px（860px 以下 16px），底色 #0c1017f0。左側品牌（16px／600，Phosphor Mint 圖示，點擊回首頁）；首頁品牌後接麵包屑「學習路徑 › 第 n / 9 站 · 名稱」（14px，Text Muted，目前站為 Text Primary／600）；右側是 Path Nav（手機版換行、靠左）。

### Path Nav（學習路徑導覽組）

所有頁面共用的一組導覽，放在學習路徑頁與工具頁的 header 右側。順序固定：學習路徑（首頁不顯示）→ 目前站 → 跳到…（Ctrl K）→ 工作台。

- **按鈕:** 34px 高、內距 5px 12px、7px 圓角、Raised Surface 底、Control Edge 邊框、14px 字，間距 6px；hover #1d2834。「學習路徑」圖示為 Phosphor Mint。
- **目前站:** Mint Edge 邊框＋Mint Wash 底，文字「第 n / 9 站 · 名稱」；點擊回到該站的實驗分頁。只在從某站進入工具時出現。
- **跳到…:** 最小寬 150px、Text Muted 字，右側 `kbd`（Ctrl K，12px Consolas、Control Edge 邊框、4px 圓角、Text Label）。全域 Ctrl／⌘ + K 打開站點切換器。
- **工作台選單:** 原生 `<details>`，summary 是同樣的按鈕加 15px 向下箭頭；展開時 summary 邊框變 Phosphor Mint。選單 280px 寬、靠右、在按鈕下方 6px：Bench Surface 底、Control Edge 邊框、10px 圓角、8px 內距。第一行是 13px Text Label 說明「自由使用的工具，不計入進度。」；每項是兩行（名稱＋13px 說明）、內距 7px 10px、7px 圓角，hover／focus 為 #1d2834。點選單外關閉。
- **Compact（密集工具 header）:** 3D 沙盒這類 header 已經很滿的工具頁使用圖示優先版：學習路徑只留圖示（以 `aria-label` 提供名稱）、目前站縮成「第 n 站」、跳到…只留放大鏡與 Ctrl K、工作台不變。一般工具頁（3D 實驗室）使用完整版。

### Station Switcher（Ctrl K 對話框）

- **結構:** 原生 `<dialog>`（`showModal`），寬 `min(620px, 100vw − 32px)`、最高 `min(640px, 100vh − 80px)`、距頂 10vh；Bench Surface 底、Control Edge 邊框、12px 圓角，後方 Scrim 遮罩。
- **搜尋列:** 內距 12px 16px、底部 Hairline；左側 18px 放大鏡（Text Label）、無框 17px 輸入框（placeholder 為 Text Faint）、右側 Esc `kbd`。輸入框是 `role="combobox"`，以 `aria-activedescendant` 指向目前選項。
- **結果:** `role="listbox"`，內距 6px；每項 `role="option"`、內距 8px 10px、8px 圓角、間距 12px，左側是 24px Control Mark（非站點項目用 24px、6px 圓角的 Control Edge 空框），右側是 15px／600 名稱加 13px Text Label 說明。目前項底色 #1d2834。
- **操作:** ↑↓ 移動、Enter 前往、Esc 或點遮罩關閉；滑鼠移入即設為目前項。無結果時顯示「沒有符合「…」的站點或工具。」。項目順序：學習路徑首頁 → 九站 → 工作台工具。

### Formula Block（招牌元件）

KaTeX 公式區塊：Formula Well 底、左側 3px Phosphor Mint 邊線、內距 4px 18px、最寬 860px，可水平捲動。行內 `code` 使用 #16202b 底、#9fe8cf 字、4px 圓角。

### Metric Tile

小型讀數磚：12px 標籤（Text Label）在上，17px tabular 數值在下；Raised Surface 底、1px 邊框、8px 圓角。多個指標磚以 10px 間距水平排列並自動換行。

### Task Box

任務清單：1px 虛線邊框（#4b5d70）、10px 圓角、#121a23 底、15px 字；標題使用 Estimate Amber。

### Control Mark（定向越野檢查點，招牌元件）

學習路徑的站點編號：圓形、內含站號，字型 Consolas 600、tabular-nums，字級為直徑的 0.46 倍。同一個元件用在所有尺寸：「繼續」卡 64px、站點頁首 56px、路線圖 36px、切換器 24px、圖例 14px。

- **未開始:** 2px Control Edge 外框、Darkroom Black 底、Text Muted 數字（空心）。
- **進行中:** Phosphor Mint 外框與數字，底仍是空的。
- **已通過:** Phosphor Mint 實心底、Darkroom Black 數字。
- **規劃中:** 外框改為虛線、Text Faint 數字。
- **目前這一站:** 疊加在上述狀態之上：外加 2px Phosphor Mint outline、offset 3px（雙圈），底色 Mint Wash、數字 Text Primary。圖例尺寸改為 1px、offset 2px。外層預留 6px margin，讓外圈不被裁切。
- 數字是裝飾性的（`aria-hidden`）；站名與狀態一定另外以文字呈現。

### Course Map（九站路線）

把九站畫成定向越野路線：編號檢查點之間以直線連接，形成一個「⊃」形回圈（1–4 上排向右、5 在右側轉折、6–9 下排向左）。

- **容器:** 比例 3 : 1；連線是一張 `viewBox="0 0 100 100"`、`preserveAspectRatio="none"` 的 SVG，站點以百分比座標絕對定位在同一個框內。
- **連線:** 2px、`vector-effect: non-scaling-stroke`。預設 Control Edge；起點站已通過時為 Phosphor Mint；任一端是規劃中時為虛線（6 6）。
- **標籤位置:** 上排（1–4）標籤在圓圈上方；轉折站（5）標籤在圓圈右側、靠左對齊；下排（6–9）標籤在圓圈下方。標籤一律不覆蓋連線方向。
- **標籤:** 最寬 170px、Bench Surface 底、內距 2px 6px、6px 圓角（把經過的連線挖開）；站名 15px／600、狀態 13px Text Label tabular。目前站的站名為 Phosphor Mint；規劃中的站名為 Text Muted。
- **互動:** 整個站點（圓圈＋標籤）是一個按鈕，進入該站理論分頁；目前站帶 `aria-current="step"`。Hover／focus 時圓圈放大到 1.12 倍（0.18s、`cubic-bezier(0.2, 0.8, 0.2, 1)`，reduced-motion 時取消），focus-visible 時站名加 Phosphor Mint 底線。
- **下方:** Hairline 分隔後是章節列（「1–2 系統與 Camera」…，14px Text Muted），再下是圖例（14px Control Mark＋13px 文字，涵蓋已通過／進行中／未開始／目前這一站／規劃中）。
- **860px 以下:** 隱藏 SVG 連線，改為直列；左側以一條 2px Control Edge 直線（x = 17px）串起所有圓圈，標籤一律在圓圈右側。

### Source Tag（來源標籤）

小型文字標籤：13px、行高 1.6、內距 0 8px、4px 圓角、不換行，靠右對齊在列尾。語意見 The Honest Source Rule。

- **你的結果:** Mint Edge 邊框、Phosphor Mint 字。
- **參考值:** Amber Edge 邊框、Estimate Amber 字（目前所有產出與輸入都顯示這個標籤）。
- **尚未產生:** 虛線 Control Edge 邊框、Text Faint 字。

### Artifact Rows（產出／輸入清單）

沒有卡片的細線列表：清單上緣一條 Hairline，每列下緣一條 Hairline。

- **我的專案產出（首頁）:** 兩欄 grid（`1fr auto`），內距 9px 2px；名稱 15px／600、右側 Source Tag、下一行 13px Text Label「第 n 站產出」。外框是 Bench Surface 底、Hairline 邊框、10px 圓角、內距 20px 22px。
- **本站的輸入（實驗分頁）:** 三欄 grid（名稱／14px Text Label 「第 n 站」／Source Tag），內距 8px 0、15px；標題 15px／600 Text Label；清單下方以 14px Text Label 說明目前使用參考值。沒有輸入的站只顯示一句 Text Muted 文字。

### Resume Card（「繼續」卡）

首頁的第一個元素，滿寬：Phosphor Mint 邊框、Mint Wash 底、10px 圓角、內距 24px 28px、間距 28px。左側 64px「目前」Control Mark，中間標題（34px／650，「繼續：站名」或「下一站：站名」）、17px Text Secondary 說明（最寬 72ch）、站內進度 Chips，右側一個主要按鈕（回到實驗／繼續讀理論／開始第 n 站）。860px 以下改為直向堆疊、內距 20px。

### Station Head & Tabs（站點頁首與理論／實驗／檢核）

- **頁首:** 最寬 1180px、內距 30px 28px 18px、間距 24px。左側 56px「目前」Control Mark；中間站名（34px／700／1.25）、18px Text Secondary 摘要（最寬 72ch）、14px Text Label 中繼資料「第 n / 9 站 · 章節 · 產出：…」；右上角「上一站／下一站」Path 按鈕（端點時 disabled、透明度 0.45）。860px 以下換行，站名 26px，前後站按鈕移到下一列。
- **分頁:** `role="tablist"`，底部 Hairline；每個分頁 46px 高、內距 8px 18px、16px Text Muted、左側 17px 圖示。選中時 Text Primary／600、底部 2px Phosphor Mint 線。已完成的分頁尾端加 Phosphor Mint 勾號；檢核分頁附 13px Consolas Text Label 計數「n/m」。分頁順序固定為理論 → 實驗 → 檢核。

### Activity Card（實驗入口卡）

實驗分頁中前往工具的入口：最寬 860px、內距 14px 18px、10px 圓角、間距 20px；左側標題 18px＋15px Text Secondary 說明，右側「開啟 →」按鈕。

- **主要實驗:** Phosphor Mint 邊框、Mint Wash 底、Path 主要按鈕。每站最多一張。
- **其他實驗:** Control Edge（#3a4757）邊框、Bench Surface 底、Path 一般按鈕。
- 860px 以下改為直向堆疊，按鈕滿寬。

### Soft-Check List（通過條件）

檢核分頁的清單。提示，不是關卡：未通過也能前往下一站，頁尾的「前往第 n 站」永遠可按。

- **結構:** 最寬 860px；26px 標題（不加上緣線）、15px Text Muted 說明句明寫「這些是提示，不是關卡」；清單為 Hairline 細線列、內距 10px 2px、16px／1.6 Text Secondary。
- **實驗室判定項:** 左側 18px 虛線圓（Text Faint），達成後換成 Phosphor Mint 勾號；右側 12px 「實驗室判定」標籤（Control Edge 邊框、4px 圓角、Text Label）。達成一次就保留。
- **自行勾選項:** 18px 原生 checkbox（`accent-color` Phosphor Mint），整列都是 label。
- **達成:** 該列文字變 Text Primary。
- **摘要:** 清單下方 15px Mint Ink「已通過 n / m 項。」，`role="status"`。

## Do's and Don'ts

### Do:

- **Do** 讓 Phosphor Mint（#5ee4bd）只出現在主動作、目前位置與有效資料上（The Phosphor Signal Rule）。
- **Do** 在 3D 場景、SVG、圖例中一致使用裝置色：Camera #69d9ff、Projector #b7a0fa、估計值 #ffd166、真值 #e7edf5、錯誤 #ff9b85。
- **Do** 用色階（#0b1118 → #0c1017 → #141c26）加 1px 邊框分層。
- **Do** 所有變動數值使用等寬字或 tabular-nums。
- **Do** 教學正文維持 18px 以上、1.8 行高、段落寬度 860px 以內。
- **Do** 結果過期時把透明度降到 0.45–0.55，並顯示 Stale Amber 提示。
- **Do** 圖例使用小色塊（12×3px 線段或色點）加文字，不只靠顏色傳達意義。
- **Do** 以 Control Mark 的五種狀態表示站點進度：空心＝未開始、薄荷空心＝進行中、薄荷實心＝已通過、虛線＝規劃中、雙圈＝目前這一站；並且一定附上文字狀態。
- **Do** 跨站使用的每一筆產出都加上 Source Tag（The Honest Source Rule）。
- **Do** 在工具頁 header 放入 Path Nav；header 已經很滿的工具頁使用 Compact 版。

### Don't:

- **Don't** 用 box-shadow 表達層級，也不要加裝飾性 glow。
- **Don't** 使用紫藍漸層、卡片套卡片、標題上方的圓角圖示方塊等「AI SaaS 儀表板」樣式。
- **Don't** 再引入新的強調色；資料語意色（青、淡紫、琥珀、鮭紅）不拿來當 UI 裝飾。
- **Don't** 讓真值與估計值共用同一個顏色或線型。
- **Don't** 在教學頁把正文縮到 18px 以下，或把圖表刻度縮到 14px 以下。
- **Don't** 新工作區沿用沙盒的偏藍 `--sb-*` 中性色；以 Darkroom Black 系列為準。
- **Don't** 用通過條件鎖住下一站或任何按鈕；檢核只提示。
- **Don't** 在個別頁面再做一套路線圖；九站路線只存在於學習路徑首頁，其他頁面以 Path Nav 與 Ctrl K 切換。
- **Don't** 用 Phosphor Mint 或省略標籤來呈現參考值。
