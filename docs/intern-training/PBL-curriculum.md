# LingoLeap 實習生 PBL 課程綱要

**對象**：靖杭、啟翔（高中生實習生）
**專案**：LingoLeap — 國語文閱讀學習平台
**更新**：2026-03-13

---

## 為什麼用 PBL？

傳統教學法是「先學概念，再找地方用」。但你們已經在一個真實產品裡了 — 真實的用戶、真實的 bug、真實的程式碼。

PBL（專題導向學習）的邏輯是反過來的：**從真實問題出發，需要什麼技能就去學什麼**。

這意味著：
- 你修的每一個 bug，都有真實的國小老師或學生受益
- 你寫的每一行程式碼，都在 GitHub 上留下記錄
- 你遇到的困難，跟業界工程師面對的困難是一樣的

不會有人一開始就把所有東西學完再動手。就算是 Young 也是邊做邊查。

---

## 技能樹總覽

每完成一個 issue，就解鎖一個技能節點。技能分四個層級：

```
Tier 1 — 讀程式碼、找問題、用 Git
Tier 2 — 改程式碼、測試、開 PR
Tier 3 — 設計功能、全端開發、API 整合
Tier 4 — 架構分析、技術文件、Code Review、帶人
```

以下四個專案對應四個 Tier，可以依序進行，也可以在同一週並行。

---

## 專案 1：Bug 修復挑戰

**Tier 1-2 技能**

### 驅動問題

> 「為什麼使用者會看到這個 bug？我要怎麼找到它、修好它？」

修 bug 是進入一個陌生程式碼庫最好的方式。你不需要先看完所有檔案 — 你只需要找到「出問題的那一個地方」。

### 真實 Issues

| Issue | 描述 | 難度 | 對應技能 |
|-------|------|------|---------|
| [#371](https://github.com/youngtsai/chinese-literacy-platform/issues/371) | StoryCard 顯示 `filename` 內部資料外露給使用者看 | 入門 | 找到 component、改顯示邏輯 |
| [#373](https://github.com/youngtsai/chinese-literacy-platform/issues/373) | 文章類型顯示「單/多*2/多*3」— 對教師不友善，應顯示中文標籤 | 入門 | 字串轉換、條件渲染 |
| [#378](https://github.com/youngtsai/chinese-literacy-platform/issues/378) | Onboarding 說「六步驟」但實際學習流程已超過六個步驟 | 入門 | 找到文字內容、更新說明 |
| [#382](https://github.com/youngtsai/chinese-literacy-platform/issues/382) | StepperNav 硬編碼「等級 12」假資料，沒有接真實使用者資料 | 進階入門 | 理解 props 傳遞、追蹤資料來源 |
| [#383](https://github.com/youngtsai/chinese-literacy-platform/issues/383) | StepperNav 頭像顯示空灰圓，缺乏身份識別（應顯示使用者縮寫或頭像） | 進階入門 | 條件渲染、Fallback UI 設計 |

### 七步驟學習流程

每個 bug 跑一遍這七步，不要跳過任何一步：

**步驟 1：讀懂問題**
- 在 GitHub Issue 上讀完整描述
- 把「預期行為」和「實際行為」用自己的話寫下來
- 不懂的名詞先查，還是不懂就問

**步驟 2：在 staging 重現**
- 打開 `https://lingoleap-frontend-staging-958347263320.asia-east1.run.app`
- 自己走一遍，親眼看到 bug
- 截一張圖，留在 Issue 的留言區

**步驟 3：找到相關檔案**
- 用 VS Code 搜尋功能（Cmd+Shift+F）搜關鍵字
- 例如：看到畫面上顯示「filename」就搜 `filename`
- 鎖定到 1-3 個相關檔案

**步驟 4：理解程式碼**
- 慢慢讀，不懂的行就在旁邊加註解問自己「這行在做什麼」
- 不需要讀懂整個元件，只需要讀懂「出問題的那個部分」

**步驟 5：修改**
- 改最少的程式碼，解決問題就好
- 不要順手「優化」其他東西（範圍蔓延是 bug 修復的大敵）

**步驟 6：本地測試**
```bash
cd frontend && npm run dev
```
- 打開 `localhost:3000`，確認 bug 消失了
- 確認你沒有弄壞其他東西

**步驟 7：開 PR**
```bash
git checkout -b fix/issue-371-storycard-filename
git add .
git commit -m "fix: hide internal filename from StoryCard display (#371)"
git push origin fix/issue-371-storycard-filename
```
- 在 GitHub 上開 PR，target branch 是 `staging`
- PR 描述寫：做了什麼改變、為什麼這樣改
- 在 Issue 留言：「PR 已開，請 review」

### 本專案練習到的技能

- Git：建立 branch、commit、push、開 PR
- 閱讀 React 元件程式碼
- 瀏覽器 DevTools 基礎（找到 DOM 元素、查看 Console）
- 字串處理、條件渲染
- 溝通：在 Issue 留言說明進度

---

## 專案 2：UX 改善任務

**Tier 2-3 技能**

### 驅動問題

> 「怎樣的介面才能讓國小老師一看就會用？」

UI bug 和功能 bug 不一樣 — 功能 bug 是「壞掉了」，UI bug 是「用起來很痛苦」。這個專案要你學會從使用者的角度思考，然後用程式碼把「痛苦的地方」修好。

### 真實 Issues

| Issue | 描述 | 難度 | 對應技能 |
|-------|------|------|---------|
| [#380](https://github.com/youngtsai/chinese-literacy-platform/issues/380) | ClassroomDetail 有 8 個 tab，手機端溢出螢幕無法左右捲動 | 中等 | Tailwind responsive、overflow-x-auto |
| [#381](https://github.com/youngtsai/chinese-literacy-platform/issues/381) | Header 導覽列觸控目標太小（12px），不符 WCAG 44px 標準 | 中等 | 無障礙設計、min-h/min-w |
| [#385](https://github.com/youngtsai/chinese-literacy-platform/issues/385) | MyTextsTab 的 modal 缺少 Escape 鍵關閉和 focus trap | 中等 | 鍵盤事件、useEffect、DOM focus |
| [#430](https://github.com/youngtsai/chinese-literacy-platform/issues/430) | 課文理解對話介面在小螢幕上難以使用，需要 UI/UX 改善 | 挑戰 | 整體元件重構、RWD 設計 |
| [#433](https://github.com/youngtsai/chinese-literacy-platform/issues/433) | Modal 元件普遍缺少焦點鎖定（focus trap）功能 | 挑戰 | 可重用 Hook、可及性模式 |

### 四步驟學習流程

**步驟 1：學習 WCAG 無障礙標準基礎**

在開始改程式碼之前，先了解「為什麼這算問題」：
- 讀 [WCAG 2.1 中文摘要](https://www.w3.org/WAI/WCAG21/quickref/)（只需要了解觸控目標大小、鍵盤導航、焦點管理這三項）
- 在自己的手機上測試看看，感受一下 12px 觸控目標有多難點

**步驟 2：手機端測試**
- Chrome DevTools → 切換至 Mobile 模式（iPhone 12 Pro 或 Pixel 5）
- 實際操作，找出「哪裡壞了」
- 截圖，標注問題位置

**步驟 3：設計改善方案**
- 在 Issue 留言說明你打算怎麼改
- 例如：「我打算在 tab 容器加上 `overflow-x-auto` 和 `whitespace-nowrap`」
- 等 Young 確認方向正確後再動手（避免改錯方向白費力氣）

**步驟 4：Tailwind responsive 實作**

LingoLeap 使用 Tailwind CSS，responsive 的寫法：
```tsx
// 手機優先（sm: 以下是手機預設）
<div className="flex overflow-x-auto sm:overflow-visible">

// 觸控目標
<button className="min-h-[44px] min-w-[44px] p-3">

// focus trap 鍵盤事件
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };
  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [onClose]);
```

**步驟 5：鍵盤導航測試**
- 完全不用滑鼠，只用 Tab 鍵和 Enter 鍵操作你改過的功能
- 確認 focus 的順序合理，Modal 打開後 focus 落在 Modal 內部

### 本專案練習到的技能

- Tailwind CSS：responsive prefix、overflow、spacing
- 無障礙設計：觸控目標、鍵盤導航、focus management
- React Hooks：useEffect、useRef、自訂 Hook
- 元件設計模式：controlled/uncontrolled Modal
- 手機端測試方法

---

## 專案 3：功能開發

**Tier 3-4 技能**

### 驅動問題

> 「我能不能從零開始，獨立完成一個功能？」

修 bug 是「找到問題的那一行然後改掉」。開發功能是「從需求開始，自己決定要建什麼、怎麼建」。這是更高一層的挑戰。

### 真實 Issues

| Issue | 描述 | 難度 | 對應技能 |
|-------|------|------|---------|
| [#436](https://github.com/youngtsai/chinese-literacy-platform/issues/436) | 註冊頁面：email 已被註冊時沒有「去登入」連結，使用者不知道怎麼辦 | 中等 | 錯誤處理、條件渲染、路由導航 |
| [#421](https://github.com/youngtsai/chinese-literacy-platform/issues/421) | 診斷報告需要列印友好版本（隱藏 nav、調整排版、CSS print media query） | 中等 | CSS print、@media print、版面調整 |
| [#434](https://github.com/youngtsai/chinese-literacy-platform/issues/434) | 課文庫缺少排序功能（依難度/年級/字數）和書籤功能 | 挑戰 | API 整合、狀態管理、LocalStorage |
| [#438](https://github.com/youngtsai/chinese-literacy-platform/issues/438) | 我的生字本：缺少按課文篩選 + 批量練習功能 | 挑戰 | 複雜狀態管理、篩選邏輯、UI 設計 |

### 七步驟學習流程

**步驟 1：分析需求（寫 Acceptance Criteria）**

在動手之前，把「完成的定義」寫清楚。格式：
```
Given（前提條件）
When（使用者做了什麼）
Then（應該發生什麼）
```

範例（#436）：
```
Given 使用者在註冊頁面輸入已被使用的 email
When 點擊「註冊」按鈕
Then 顯示錯誤訊息「此 email 已被使用」
  AND 顯示「前往登入」按鈕
  AND 點擊按鈕導向登入頁面，並預填該 email
```

把這個 Acceptance Criteria 貼到 Issue 留言，等 Young 確認。

**步驟 2：設計 UI wireframe**

不需要精美的設計圖，用純文字或手繪描述：
```
[錯誤狀態的 email 欄位]
此 email 已被使用。
[前往登入] <-- 這是按鈕，點擊後跳到登入頁
```

**步驟 3：拆解成子任務**

把一個功能拆成小塊，每塊大約 1-2 小時能完成：
```
[ ] 找到註冊 API 的錯誤回應格式
[ ] 在前端 catch 「email 已存在」的錯誤
[ ] 顯示對應錯誤訊息
[ ] 加入「前往登入」按鈕
[ ] 實作跳轉邏輯（帶 email 參數）
[ ] 測試完整流程
```

**步驟 4：實作**

LingoLeap 前端架構重點：
- API 呼叫都在 `frontend/src/services/api.ts`
- 錯誤處理用 try/catch，API 錯誤格式是 `{ detail: string }`
- 路由跳轉用 `useNavigate()`（React Router）
- 狀態管理用 `useState`，不需要 Redux

**步驟 5：寫測試**

至少寫一個手動測試清單（如果有時間，可以寫 Playwright 自動化測試）：
```markdown
## 手動測試清單
- [ ] 輸入從未使用過的 email → 正常註冊
- [ ] 輸入已存在的 email → 出現錯誤訊息 + 「前往登入」按鈕
- [ ] 點擊「前往登入」→ 跳到登入頁，email 欄位預填
- [ ] 手機版：版面正常，按鈕可以點到
```

**步驟 6：Code Review**

開 PR 之後，在 PR description 裡說明：
- 你做了什麼決定，以及為什麼（例如「我選擇用 query string 傳 email，而不是 localStorage，因為...」）
- 哪些地方你不確定，想聽 Young 的意見

**步驟 7：部署到 staging 測試**

PR merge 進 staging 之後，GitHub Actions 會自動部署。確認：
- `https://lingoleap-frontend-staging-xxx.asia-east1.run.app` 上功能正常
- 走完你的手動測試清單
- 在 Issue 留言：「功能已部署至 staging，請測試」

### 本專案練習到的技能

- 需求分析：從使用者故事到 Acceptance Criteria
- 前端狀態管理：useState、useEffect、受控元件
- API 整合：呼叫後端、處理錯誤、載入狀態
- CSS 進階：@media print、列印版面設計
- 完整開發週期：需求 → 設計 → 實作 → 測試 → 部署
- PR 寫作：讓 reviewer 快速理解你做了什麼

---

## 專案 4：技術深潛

**Tier 4 技能**

### 驅動問題

> 「這個系統是怎麼運作的？我能不能教別人？」

當你能夠向別人解釋一個系統，代表你真的理解了它。這個專案沒有固定的 issue，而是幾個探索任務。

### 四個探索任務

**任務 A：追蹤一次完整學習流程的資料流**

選擇「課文理解」這個步驟，追蹤從學生送出一句話，到 AI 回應出現在螢幕上的完整路徑：

```
學生輸入 → ComprehensionChat.tsx
  → api.ts 的 sendMessage()
  → POST /api/learning/chat
  → backend/app/routes/learning.py
  → socratic_agent.py
  → Vertex AI Gemini
  → 回傳 JSON
  → 前端顯示
```

畫一張資料流程圖（用任何工具，甚至手繪），然後在 Slack 或 GitHub Discussion 上分享給團隊。

**任務 B：寫一份技術文件**

選一個你已經修過 bug 或開發過功能的模組，寫一份技術說明文件：

```markdown
# [模組名稱] 技術說明

## 這個模組做什麼
（一段話說明）

## 主要檔案
（列出相關檔案及其用途）

## 資料流
（輸入是什麼 → 處理邏輯 → 輸出是什麼）

## 常見問題
（你修 bug 時學到的坑）
```

**任務 C：Review 一個 PR**

選一個隊友開的 PR，認真 review：
- 讀懂他改了什麼
- 測試他修改的功能
- 在 GitHub 上留至少三條有建設性的 review 留言
  - 一條「我學到了什麼」
  - 一條「建議可以怎麼改進」
  - 一條「問一個你真的不懂的問題」

**任務 D：Pair Programming**

當另一位實習生在卡 bug 的時候，不要直接告訴他答案。改用這個方式：
1. 讓他說明他認為問題在哪裡
2. 問「你怎麼知道問題在那裡？你有什麼證據？」
3. 一起設計一個最小測試來驗證你們的假設
4. 引導，不要代勞

### 本專案練習到的技能

- 系統思維：理解模組間的依賴關係
- 技術寫作：用文字解釋複雜的技術概念
- Code Review：給出有建設性、具體的 feedback
- 帶人：引導式提問而非直接給答案

---

## 每週節奏

```
週一：選一個 issue → 讀懂問題 → 在 staging 重現 → 在 Issue 留言「我來做這個」
週二-四：開發 → 遇到問題先查 30 分鐘（Google + 程式碼搜尋），還是解不了再問
週五：PR review + 技能樹更新 + 寫週記
```

### 遇到問題怎麼辦

**卡住 < 30 分鐘**：先自己查
**卡住 30-60 分鐘**：在 Slack 問，附上你試過的方法
**卡住 > 1 小時**：直接找 Young，帶著你的螢幕一起看

問問題的好格式：
```
我在做 #XXX，卡在 [具體問題]。
我試過 [方法一] 和 [方法二]，但是 [出現了什麼結果]。
我懷疑問題可能是 [你的猜測]，但不確定。
```

---

## 週記模板

每週五填寫，提交到 `docs/intern-training/weeklogs/` 目錄。

```markdown
## 本週學習週記 — Week N

**姓名**：靖杭 / 啟翔
**日期**：YYYY-MM-DD

### 完成的 Issue
- #XXX：（簡述做了什麼、解決了什麼問題）

### 學到的技能
- （對應技能樹的哪個節點，例如：「Tier 2 — React Props 傳遞」）
- （用一兩句話說明你是怎麼學到的）

### 遇到的困難
- （卡住的點是什麼）
- （你怎麼解決的，或是還沒解決）

### 讓你最有成就感的一件事
- （可以是技術的，也可以是非技術的）

### 下週目標
- #XXX：（計畫做哪個 issue，為什麼選它）
```

---

## 評量方式

**不打分數。** 用技能樹進度追蹤。

| 評量項目 | 說明 |
|---------|------|
| Issue 完成數 | 每個 merged PR 解鎖對應技能節點 |
| PR 品質 | review 來回次數越少，代表溝通越清楚 |
| 週記填寫 | 反思深度比字數重要 |
| 月末 1-on-1 | Young + 實習生各自說一件「做得好的事」和「想改進的事」 |

**技能樹里程碑**：

| 里程碑 | 條件 | 象徵意義 |
|--------|------|---------|
| 第一個 merged PR | 完成任何一個 Tier 1 bug 修復 | 你是真正的貢獻者了 |
| 第一個獨立功能 | 完成任何一個 Tier 3 功能開發 | 你可以負責一個完整需求 |
| 第一次成功 review | 你的 review 幫助隊友改進了程式碼 | 你開始影響別人的程式碼品質 |
| 教會別人 | 靖杭教會啟翔一個技能，或反過來 | 你理解到可以教別人的程度了 |

### 最終成果展示

實習結束時，你們會有：

1. **GitHub contribution graph** — 一整排的綠格子，代表你每天的貢獻
2. **技能樹截圖** — 你從 Tier 1 走到了哪裡
3. **作品集** — 你主導的 issue 列表，可以放在履歷或學習歷程

這些東西在大學申請和未來找工作時，比任何考試成績都有說服力。

---

## 給 Young 的課程設計備注

**意圖**：讓實習生感覺「我在做真正的事」，而不是「我在做練習題」。

**關鍵原則**：
- issue 難度分配是刻意設計的 — 前幾個一定要讓他們成功，建立信心
- 鼓勵在 Issue 留言、問問題 — 這是真實工作流程，也是歷史紀錄
- 週五 review session 不是檢查，是「一起看程式碼學到什麼」的時間
- 卡關時不要直接給答案，用問題引導（Socratic method，跟我們的 AI 一樣）

**觀察指標**（月末 1-on-1 用）：
- 他們提問的品質有沒有提升？（從「這怎麼做」到「我試了 X 但出現 Y，我猜是 Z 的問題」）
- 他們有沒有開始主動找 issue，而不是等人分配？
- 他們有沒有開始關心使用者，而不只是「程式能跑就好」？
