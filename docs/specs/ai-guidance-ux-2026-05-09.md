# AI 引導 UI/UX Redesign Spec (Issue #1507)

> **Status**: Draft v1 — 待啟翔實作確認 + 教授決策
> **Owner**: Young Tsai
> **Assignee**: 啟翔 @stgst
> **Source**: 5/8 walkthrough（17:02–19:40, 41:27–45:46 時段）+ Phase 1 backend #1387
> **Related specs**: `docs/specs/ai-tutor-prompt-template-2026-05-01.md` (#1373)
> **Deadline**: 7/1 product launch

---

## 背景與問題

5/8 週會 walkthrough 時發現三個 UI/UX 問題：

1. **觸發失敗**（17:02）— 啟翔回報：答錯選項時，5 步驟 AI 引導完全沒有跳出來。後確認原因是 `McqRescueDialog` 只掛在 `MultipleChoiceExercise.tsx` 內，但 5/8 walkthrough 是在「閱讀理解」步驟（`ComprehensionMcqPage`）測試，該頁面的 rescue 呼叫路徑與閱讀聚光燈（reading spotlight）不同。
2. **SOP 步驟暴露**（41:27–43:51）— Young：「你引導的時候，不會把自己的步驟跟學生說。」現有 UI 把「確認題意 / 找線索 / 復述 / 選答案 / 直接教學」5 個 step label 直接顯示在 progress bar 上。
3. **UI 風格**（42:23–42:45）— 啟翔：「這個 UI 好像是什麼中國…豆包什麼的。」— 當前 dialog 視覺風格像中國 AI 產品，與 LingoLeap 中島風格不符。

---

## Section 1: 觸發機制

### 1.1 觸發時機定義

| 場景 | 觸發時機 | 說明 |
|------|---------|------|
| 學生點選答案（MCQ）| **選取後立即** — 不等 submit | 選錯 = 立刻開 rescue，避免學生反覆點 + 降低受挫感 |
| 手動觸發 | 學生點「問 AI」按鈕 | 答對也可以按，不限制（走 socratic_agent，非 rescue 流程） |
| 連續答錯 N 題 | 不觸發強制 rescue（Phase 1）| 記錄數據，不鎖題。強制機制等教授決定 N 值後 Phase 2 實作 |

**不在此 spec 的場景**：
- 開放題答錯（`understood=False`）— 走既有 `ComprehensionChat`，不走 `mcq_rescue`
- 學生切步驟回來 — session TTL 30 min，resume 最後 step（既有行為，不改）

### 1.2 Frontend Event Flow

```
MultipleChoiceExercise.tsx
  └── handleSelect(label: string)
        ├── if label === q.answer → 答對，update score，進下一題
        └── if label !== q.answer → 答錯
              ├── setRevealed(true)  // 顯示對錯
              ├── setRescueContext({ questionId, lessonId, wrongChoice, ... })
              └── setRescueOpen(true)  // 立即打開 McqRescueDialog
```

**現有流程確認**（Phase 1 已實作，但 5/8 走的是 ComprehensionMcqPage，未整合）：
- `MultipleChoiceExercise` 已有 rescue 邏輯（`handleSelect` → `setRescueOpen`）
- `ComprehensionMcqPage` 不直接用 `MultipleChoiceExercise`，需補整合

**5/8 觸發失敗根因**：閱讀聚光燈（Reading Spotlight）步驟的選擇題 component 不是 `MultipleChoiceExercise`，需確認正確的 component 路徑並補掛 `McqRescueDialog`。

### 1.3 手動觸發按鈕

在 MCQ 答題區域右下角加「問 AI」按鈕：
- **位置**：選項區塊下方，「下一題」按鈕左側
- **顯示時機**：題目顯示時即出現（不限正確或錯誤）
- **點擊後**：開 `McqRescueDialog`，context 帶當前題目（`wrongChoice = ''`，rescue agent 處理為學生主動發問模式）
- **Label**：「問 AI」（短，不用「AI 引導」，避免「引導」帶有被糾正的負面聯想）

### 1.4 mcq_rescue Backend 呼叫時序

```
[選錯] → handleSelect()
           → setRescueOpen(true)
           → McqRescueDialog useEffect on isOpen=true
              → mcqRescueStart(token, { question_id, lesson_id, wrong_choice, ... })
              → POST /api/learning/mcq-rescue/start
              → Backend: start_session() → AI 開場白（Step 1）
              → 回傳 { session_id, ai_first_message, current_step: 1 }
           → 顯示第一句 AI 開場白
           → 學生打字 → mcqRescueRespond()
           → POST /api/learning/mcq-rescue/respond
```

呼叫點：`mcqRescueStart` 在 dialog 打開時（`useEffect [isOpen, questionId]`），不在選題時呼叫（避免學生反悔還沒看到 dialog 就關）。

---

## Section 2: 引導呈現方式

### 2.1 三個候選方案

#### 方案 A: Pop-up Modal（現有實作）

彈出覆蓋在課文上方的 dialog，backdrop 半透明。

**優點**：
- Focus trap 容易實作，鍵盤可及性佳
- 學生注意力集中在引導對話，不分心
- 不改動現有課文佈局

**缺點**：
- 遮擋課文 — 學生在 Step 2（回課文找段落）需要同時看課文，被 modal 擋住需切換或縮小視窗
- 5/8 Young（43:51）：「應該要放在旁邊一點，然後課文還是留著。」— 明確指出 modal 遮課文是問題

**Accessibility**：role="dialog" + aria-modal + aria-labelledby + useFocusTrap — 已在 Phase 1 實作。

---

#### 方案 B: Side Panel（右側面板）

課文區縮為 60% 寬，右側展開 40% 的 AI 引導面板。

**優點**：
- 課文與 AI 引導可同時看，Step 2「找段落」最關鍵的需求被滿足
- 不遮擋，沉浸感強
- Young（43:51）：「引導要放在下面，還是...彈跳出來在這邊...然後課文還是留著都可能」— 方案 B 最接近 Young 描述的「課文還是留著」

**缺點**：
- 需改動課文頁面佈局（flex row 拆欄），實作複雜度較高
- 在窄螢幕（手機）上兩欄擠壓嚴重，課文字變小難讀
- 目前課文頁已是三欄（課文 + 圖文 + 重點表）超載（Young 5/8 7:00-7:30 提到「電梯超載」），再加 side panel = 四欄更亂

**Accessibility**：可做 aria-live region 通知面板打開，但 focus 管理複雜（focus 落在面板還是課文？）

---

#### 方案 C: Inline Expand（題目下方展開）

學生答錯後，該題目下方滑出一個展開區塊顯示 AI 引導對話，課文保持滾動可見。

**優點**：
- 不遮擋課文，也不改佈局
- 自然：「我在這題答錯，AI 就跟著這題回應我」，context 清楚
- Young（43:51）：「引導應該放在下面」— 直接對應 inline expand below question

**缺點**：
- 使用者需要向上捲才能看到課文，Step 2 仍有「在 expand 區與課文間上下捲動」的問題
- 頁面拉得很長，題目多時體驗差
- Keyboard trap 難做：focus 如果留在 expand 區，學生按 Tab 可能跳到頁面其他元素

**Accessibility**：需要 `aria-expanded` + `aria-controls`，螢幕閱讀器體驗挑戰較大。

---

### 2.2 推薦：方案 A（改良版 Modal）+ 課文快速參照功能

**推薦方案 A，理由如下**：

1. **Accessibility 最完整** — Phase 1 已有完整實作（focus trap / role / aria），改其他方案需重做
2. **手機優先** — 課程跑在學生裝置（平板/手機比例高），side panel 和 inline expand 在手機上體驗最差
3. **「遮課文」問題用 UI 功能解決，不用換架構**

**改良點（解決遮課文問題）**：

在 modal 頭部加「查看課文」按鈕，點後 modal 縮為 bottom sheet（下方固定 30vh 高），課文恢復可見，學生找到段落後再展開 modal 繼續對話。

```
[正常狀態] full modal (max-w-lg, max-h-90vh)
    ↓ 點「查看課文」
[縮小狀態] bottom sheet (fixed bottom-0, h-[30vh], w-full)
    ↓ 點「返回引導」
[正常狀態] 恢復 full modal
```

此方案：
- 保留 focus trap 的 accessibility 優勢
- 讓學生在 Step 2 需要找課文時有辦法看到課文
- 不重做佈局

**ASCII Wireframe（改良版 Modal 含縮小按鈕）**：

```
┌──────────────────────────────────────┐
│ AI 助教引導         [查看課文] [✕]  │  ← 「查看課文」= 縮為 bottom sheet
│──────────────────────────────────────│
│ [●●●○○] 目前：找線索               │  ← 進度點（不顯示步驟名稱，見 Section 3）
│──────────────────────────────────────│
│ 你答錯的題目：                       │
│ 作者用什麼例子支持「努力比運氣重要」 │
│ 你選了：B                            │
│──────────────────────────────────────│
│                                      │
│  [小語老師]                          │  ← AI 泡泡
│  課文哪一段有舉例子？                │
│                                      │
│                     [我覺得第三段]   │  ← 學生泡泡
│                                      │
│  [小語老師]                          │
│  對！第三段就是。你能說說            │
│  茱蒂做了什麼事嗎？                  │
│                                      │
│──────────────────────────────────────│
│ [_輸入你的想法___________] [送出]   │
└──────────────────────────────────────┘

縮小後（bottom sheet）：
┌──────────────────────────────────────┐
│              課 文 內 容              │
│  茱蒂雖然窮，但她每天讀書寫信，      │
│  最後考上大學。...                   │
│                                      │
│ ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ │
│ [返回引導] AI 助教正在等你 ●●●○○   │  ← 30vh bottom bar
└──────────────────────────────────────┘
```

---

## Section 3: Prompt 隱藏式（5 步驟不暴露給學生）

### 3.1 問題描述

現有 `McqRescueDialog.tsx` 的 progress bar 顯示：

```
確認題意  找線索  復述  選答案  直接教學
  [●]      [ ]    [ ]    [ ]    [ ]
```

Young（43:03）：「通常你引導的時候，不會把自己的步驟跟學生說。應該是藏起來，Prompt 在裡面。」

### 3.2 Frontend 規格

**絕對禁止**：
- 不在 UI 顯示步驟名稱（確認題意 / 找線索 / 復述 / 選答案 / 直接教學）
- 不顯示「第 N/5 步」文字
- 不顯示任何「今天要走幾個關卡」的 meta 資訊

**允許**：
- 顯示簡易進度指示（進度點 `●○○○○`），讓學生知道「對話會結束」，不帶 label
- 或完全拿掉 progress indicator（待確認，需教授意見）

**改法**：

```tsx
// 現有：
const STEP_LABELS = { 1: '確認題意', 2: '找線索', ... }

// 改為：不顯示 label
// 只顯示匿名進度點
{[1, 2, 3, 4, 5].map((step) => (
  <div
    key={step}
    className={`w-2 h-2 rounded-full ${
      step <= currentStep ? 'bg-blue-400' : 'bg-gray-200'
    }`}
  />
))}
```

進度點目的：讓學生知道引導是有限的（不會一直問），減少焦慮。不暴露 SOP 內容。

### 3.3 Backend Prompt 規格

後端已走 5 步驟（`current_step` 欄位追蹤），但 AI 輸出給學生的文字必須是自然對話，不帶 meta。

**禁止的 AI 輸出**：
- ❌ 「現在我們到第二步，我要帶你回去找課文段落。」
- ❌ 「這是 Step 3：用自己的話復述。你可以嗎？」

**允許的 AI 輸出**：
- 「好，你抓到題意了！那你覺得課文哪一段跟這題有關？」
- 「對，第三段就是答案的位置。那段在說什麼，你說說看？」

**Prompt 原則**（backend system prompt 注入）：
```
【對話風格規定】
- 不要讓學生知道你有幾個步驟
- 每個 turn 只問一個問題
- 每次回應最多 2 句話（1 句反饋 + 1 句問題）
- 語氣像對話，不像考試
- 用「你覺得」「你說說看」「沒關係」，不用「請回答」「試著說明」
```

---

## Section 4: 行為數據 Tracking

### 4.1 Schema 決定

**使用現有 `mcq_rescue_session` table**（Phase 1 已建），不新建 table。Phase 1 table 欄位：
`id, user_id, question_id, lesson_id, wrong_choice, started_at, ended_at, total_turns, final_step, outcome, retry_count`

**需新增欄位**（在現有 migration 加，或新開 migration）：

| 新欄位 | 型別 | 說明 |
|--------|------|------|
| `used_ai_guidance` | `Boolean, default=False` | 學生是否與 AI 至少互動一次（clicked 不算，有發文字才算） |
| `wrong_count_before_rescue` | `Integer, default=1` | 同一題觸發 rescue 前連續答錯次數（記錄重試） |
| `rescue_trigger` | `String(16)` | 觸發來源：`'auto'`（答錯自動）/ `'manual'`（學生點問 AI）|

**5/8 Young（44:33）**：「連續答五題都打錯，然後還不問 AI。反正你們就多這一下，都把它記下來。對啊，然後等到教授或老師考回來，說哎，我覺得我們產品不能這樣做。」— 記錄 `used_ai_guidance = False` 就能追蹤連續答錯但不問 AI 的行為。

### 4.2 教師後台儀表板指標

以下指標從 `mcq_rescue_session` 聚合，供教師後台呈現：

| 指標名稱 | 計算方式 | 意義 |
|---------|---------|------|
| `rescue_trigger_rate` | 有 `mcq_rescue_session` 記錄的答錯 / 總答錯 | 有多少答錯學生看到了 rescue dialog |
| `ai_engagement_rate` | `used_ai_guidance=True` / 有 rescue session | 有多少學生真的跟 AI 說話（不是關掉） |
| `rescue_success_rate` | `outcome='passed'` / total | 引導後答對率（曾教授「努力分」依據） |
| `direct_teach_rate` | `outcome='direct_teach'` / total | 需要直接教學（難題 flag） |
| `cold_streak_count` | 同 lesson 連續 `used_ai_guidance=False` 的 session 數 | 學生連續不問 AI 的次數（老師介入信號）|

**查詢起點**（非最終 SQL，供工程師參考方向）：
```sql
-- 每位學生在某課的引導使用率
SELECT
  user_id,
  lesson_id,
  COUNT(*) AS total_rescues,
  SUM(CASE WHEN used_ai_guidance THEN 1 ELSE 0 END) AS ai_engaged,
  SUM(CASE WHEN outcome = 'passed' THEN 1 ELSE 0 END) AS passed
FROM mcq_rescue_session
WHERE lesson_id = :lesson_id
GROUP BY user_id, lesson_id;
```

### 4.3 個資保留期限

- `mcq_rescue_session` 資料含 `user_id`（個人可識別），歸類為學習行為紀錄
- 保留期限：跟隨既有 LingoLeap 平台政策（目前未定），建議對標 FERPA（美國）或 PDPA（台灣）：**課程結束後 3 年，或學生申請刪除後 30 天內刪除**
- 對話內容（學生打的文字）**不存 DB**（Phase 1 設計如此：session 存 in-memory，只存結果 outcome）。若未來要存對話內容需另外評估個資影響。

---

## Section 5: 教授決策清單（實作前必問）

以下問題在 5/8 走查時未定案，需在 6/1 教授 review 前確認：

### Q1: 連續答錯幾題後強制 AI 引導？

**5/8 草案（Young）**：「先做彈性版，數據先收。」連續答錯 N 題後鎖題逼用 AI — N 值未定。

**需要教授決定**：
- N = 1（每題答錯必走 AI 引導，不可跳過）
- N = 3（連錯三題才鎖）
- 沒有強制（學生可以永遠跳過）

**實作影響**：N=1 需在 `MultipleChoiceExercise` 加「此題必須完成引導才能繼續」的 gate，UI 複雜度較高。Phase 1 先實作 N=∞（無強制），數據回來後再調。

---

### Q2: AI 引導對話 max turns 上限？

**現有 spec 建議**（`ai-tutor-prompt-template-2026-05-01.md`）：12 turns（5 步驟 × 2 turns + 容錯）

**需要教授決定**：12 是否太多？學生是否會中途放棄？建議從 12 開始，上線後依 `avg_turns_to_resolve` 數據調整。

---

### Q3: progress indicator 要不要顯示？

5 步驟不暴露步驟名稱（Section 3 已定），但是否需要任何進度指示（進度點 `●○○○○`）仍未定。

**選項**：
- (a) 完全不顯示 — 最乾淨，學生不焦慮「還有幾步」
- (b) 顯示匿名進度點 — 讓學生知道對話會結束（降低對「無限對話」的焦慮）
- (c) 只顯示「AI 正在幫你想想看」，不帶任何進度

本 spec 建議 (b)，但需教授確認學生心理面。

---

### Q4: 「問 AI」按鈕的出現時機？

答對時是否要顯示「問 AI」按鈕（讓學生主動提問）？

**目前規格**：全時段顯示（見 Section 1.3）。但有風險：有些教師可能不希望學生在「對」的情況下也打開 AI（時間管理問題）。

**需要教授決定**：
- (a) 全時段都顯示（推薦，增加學生自主性）
- (b) 只在答錯後顯示（減少干擾）

---

### Q5: 「連鎖」課文顯示 — 引導期間課文高亮支援？

5/8 walkthrough（43:51）Young 提到：「這黃標黃色這樣就是都可以試試看。」— AI 引導時，能否在課文對應段落自動高亮？

**實作前提**：AI Step 2 回傳的 `referenced_paragraph`（已在 `EVALUATION_SCHEMA` 中）需要 frontend 接收並傳回課文 component 做高亮。這涉及 `McqRescueDialog` 和課文 component 之間的跨 component 通訊（可用 callback prop 或 context）。

**需要教授確認**：是否需要課文段落高亮功能？以及高亮的樣式偏好（黃色底、左邊框標記、還是微動畫？）— 這可以是 Phase 2 功能，Phase 1 先不做。

---

## 變更歷史

| 日期 | 版本 | 改動 | 作者 |
|------|------|------|------|
| 2026-05-09 | v1 draft | 初稿，根據 5/8 walkthrough + Phase 1 backend 設計 | Young / Claude |
