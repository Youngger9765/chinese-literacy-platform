# 7 篇文章進度 Pitch — 5/1 會議承諾 vs 5/13 實際

> **用途**：給方大哥 / 教授團隊 / 林校長看的進度證明文件。HTML 投影片 source-of-truth。
> **Audience**：教授+校長為主，方大哥為輔。
> **目的**：5/1 教授給 7 篇文章 + 2 模組 deadline 7/1 → 5/13（剩 49 天）證明走在路上。
> **下游**：本 md 為思考稿 → `frontend/public/presentation/7-lessons-progress.html` → 之後轉 pptx

---

## 一、5/1 會議重要決議（source: docs/meetings/2026-05-01-experts-review.md）

### 範疇定錨
方大哥 5/1 拍板：**不再追求功能完整，追求兩個模組做到極致**。

| 元素 | 內容 |
|------|------|
| **單元 A** | 4 課 G6-L22~25 — **摘要策略**（問題.解決.結果結構）|
| **單元 B** | 3 課 G7-L28~30 — **圖文整合**閱讀策略（7/1 必含）|
| **核心模組 1** | 閱讀聚光燈 AI 助教 + **語音互動** |
| **核心模組 2** | 圖文整合介面 — **文圖左右並陳，可獨立滾動** |
| **Deadline** | **7/1 product launch**（6/1 教授 review，6/1~7/1 開發教師功能初版）|

### 教學細節（5/1 教授拍板）
1. 字體**不要黑體**（近視學生會糊在一起）
2. 注音**僅標難字**
3. 生字練習**部件拆解上色**（同部首同色，最後合體再回到同色）
4. 練習次數**至少 2 次**：仿寫 → **再生回憶**（拿掉左側刺激，強制憶寫）
5. 詞彙流程：**詞語理解 → 詞語應用 → 造句**（造句可選修）
6. 閱讀聚光燈：**AI 答錯主動引導**（5 步驟 SOP：理解 → 找段落 → 復述 → 拉回 → 直接教）
7. **隱藏**次要功能避免失焦：生字、造句、聽力 先關閉

### 校長最想許願的功能
> 「閱讀聚光燈如果能變成**語音交談**，會是我最想許願的功能。」 — 林國源校長

---

## 二、5/13 進度盤點（截至本日）

### 7 課 backend e2e ready（5/2 完成）

| Code | Story ID | HTTP | YAML fast path | rows |
|------|---------|------|----------------|------|
| G6-L22 「贏得喝采的輸家」 | 1076 | 200 | 84ms | 9 |
| G6-L23 | 1077 | 200 | 85ms | 5 |
| G6-L24 | 1078 | 200 | 83ms | 4 |
| G6-L25 | 1079 | 200 | 74ms | 4 |
| G7-L28 | 1108 | 200 | 85ms | 6 |
| G7-L29 「從四張圖，看地球暖化的現象」 | 1109 | 200 | 76ms | 22 |
| G7-L30 | 1110 | 200 | 70ms | 25 |

**全 7 課 backend 60-80 倍快過 AI fallback**（PR #1391/#1392/#1395 merge）。

### 5/1 教授指定改動 — 完成狀態

| 5/1 承諾 | 對應 PR / Issue | 狀態 |
|----------|----------------|------|
| 字體非黑體 | 既有設定 | ✅ |
| 注音僅難字 | 既有設定（StepperNav 中已有「難字 / 全 / 無」3 選項） | ✅ |
| **生字部件拆解上色**（N 部件 N 色 + RadicalDecomposition）| #1530（5/13 merged） | ✅ |
| 仿寫 + 再生回憶（第 2 次拿掉刺激）| #1342 / #1499（5/8 merged） | ✅ |
| 詞彙：理解 → 應用 → 造句 | StepperConfig 既有順序 + StepperNav 標籤 | ✅ |
| 文圖左右並陳介面 | #1531（5/13 merged）+ #1539 抽 `GraphicTextImageStrip` 共用元件 | ✅ |
| **閱讀聚光燈 AI 助教 redesign**（新 dialog UI + 新 DB table `McqAttempt` + workflow）| #1547（啟翔，5/13 merged） | ✅ |
| AI 助教**語音**互動 | #1340（5/9 起接手，未完）| 🟡 進行中 |
| 文章重點表（structure_table）| #1535 banner + #1537 hook fix（5/13 merged） | ✅ |
| 學生端 step navigation 修復 | #1543（5/13 merged） | ✅ |
| Enrollment 流程修復 | #1542（5/13 merged） | ✅ |
| 隱藏次要功能（生字、造句、聽力） | stepConfig.ts 已調 | ✅ |
| OMO Cold Start | #1343 backlog | ⬜ 未開工 |
| 教師後台 MVP | #1510 epic 已 close 後拆 4 P1 sub-tickets | 🟡 部分完成（#1542/#1543 已 merged）|

### 今日（5/13）合的 PR 一覽
- #1530 還原筆順示範動畫 + 部首多色（靖杭）
- #1531 G7 圖文三欄擁擠 → 左疊圖文+右題目（靖杭）
- #1535 文章重點表黃/灰標籤改橫向 banner（靖杭）
- #1537 fix(story-structure): useCallback after early return 觸發 React #310 → 修
- #1538 fix(story-structure): VITE_API_URL fallback
- #1539 refactor(comprehension): extract GraphicTextImageStrip
- #1541 docs(audit): teacher MVP 95% built — #1510 rescoped
- #1546 fix(enrollment): unhide 加入班級 sidebar entry
- #1547 feat(rescue): redesign MCQ rescue dialog + wire spotlight + log attempts（啟翔，新 DB table）
- #1548 fix(stepper): single-tap navigation on step dots

**總計**：10 個 PR merged 一天，4 個 issue close (#1504/#1529/#1534/#1507)。

---

## 三、投影片 narrative 設計（HTML slide deck plan）

### 受眾分層
- **教授**：教學法正確性、AI 助教引導品質、7 課可用性
- **校長**：學生實際操作流程、AI 語音許願功能進度
- **方大哥**：開發進度 vs 7/1 deadline 距離

### 投影片骨架（推薦 12-15 slides）

| # | Slide title | 內容要點 |
|---|------------|---------|
| 1 | 封面 | "7 課 7/1 deadline — 5/13 進度證明" + lead dev + date |
| 2 | 5/1 會議承諾回顧 | 2 模組 + 7 課 + deadline + 校長許願 |
| 3 | 7 課 backend e2e ready | 7 課表格 + 200 + < 100ms（5/2 完成） |
| 4 | 單元 A：G6-L22 摘要策略 | 課文 + 文章重點表 demo（screenshot）|
| 5 | 單元 A：G6-L23~25 | 各課 thumb + rows |
| 6 | 單元 B：G7-L28 圖文整合（demo） | 圖文左右並陳 screenshot |
| 7 | 單元 B：G7-L29「從四張圖看地球暖化」| 圖文 strip + 課文 + 題目 |
| 8 | 單元 B：G7-L30 | 同上 |
| 9 | 閱讀聚光燈 AI 助教 redesign | rescue dialog screenshot + workflow + 校長許願功能 |
| 10 | 生字練習 — 部件拆解上色 | 「近」字 emerald 走旁 + amber 讀音 + 筆順 canvas |
| 11 | 5/1 教授指定改動 — 完成度 | 表格（綠/黃/灰）|
| 12 | 進度條 — 5/1 → 5/13 → 7/1 | 時程 visualization |
| 13 | 剩 49 天 backlog | AI 語音、OMO Cold Start、教師 MVP |
| 14 | 引述 | 三位教授+校長的 quote |
| 15 | 下一階段：教授 review @ 6/1 | next steps |

### Screenshot 需要的 staging URL（截圖時序）
所有截圖需在 staging 上跑（小明 demo 帳號）：

| Slide | URL | 截圖時點 |
|-------|-----|---------|
| 4-5 G6 課 | `/learn/{1076-1079}/story-structure` | StoryStructureTable 橫向 banner |
| 6-8 G7 課 | `/learn/{1108-1110}/comprehension` | 圖文左右並陳 |
| 9 AI 助教 | `/learn/1108/reading-strategy` → 選錯 MCQ → 觸發 rescue dialog | 小語老師對話框 |
| 10 生字 | `/learn/1109/vocab` | 「近」字部件上色 |
| 6 圖文整合 | `/learn/1108/comprehension` 或 G7-L30 | mobile + desktop |

---

## 四、HTML 投影片設計選擇

### 風格（match 既有 /presentation/short.html）
- 白底簡潔
- 標題 + 重點 bullets + 截圖
- 投影片之間 fade（已有的 reveal.js 或自寫 nav）
- 中文字體要可讀（非黑體，per 5/1 教授）

### 互動 demo（投影片可嵌）
- Slide 6-8：圖文整合介面，可點開 modal 預覽
- Slide 9：rescue dialog 可在投影片裡截圖加箭頭標 hotspot

### URL slug
`frontend/public/presentation/7-lessons-progress.html`（清楚目的）

---

## 五、開工 todo

- [ ] 截圖 staging 上 7 課（按 slide 4-10 順序）
- [ ] 建 HTML 投影片骨架
- [ ] 嵌截圖 + 文字 + nav
- [ ] 在投影片裡標 5/1 承諾 → 5/13 結果（顏色標 ✅🟡⬜）
- [ ] Read 截圖 + 投影片 PNG 自我驗證（per CLAUDE.md slide delivery rule）
- [ ] 給 Young 看 → 確認 → 轉 pptx（之後）

---

## 附：來源 doc

- `docs/meetings/2026-05-01-experts-review.md`（5/1 會議）
- `docs/ceo-review-2026-05-02.md`（Approach B 7 課專修）
- `docs/qa-evidence-2026-05-02-7-lessons-readiness.md`（backend e2e proof）
- `docs/meetings/2026-05-08-record.md`（5/8 週會）
- 今日 staging 截圖：`/tmp/staging-1547-*.png` / `/tmp/staging-1530-recheck.png` / `/tmp/staging-1531-recheck.png` / etc
