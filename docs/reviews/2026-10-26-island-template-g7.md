# G7 逐畫面審查 — 喝采島 3D template（#3780）

> PR #3783，分支 `feat/issue-3780-island-3d-lab`，對應 PRD `docs/prd/2026-10-26-reading-island-3d-prd.md`
> 進行中，每截一批畫面就更新這份檔案並 commit，額度中斷時下一個 session 接得下去。

## 目前進度（截至本次更新）

| 代號 | 狀態 | commit |
|---|---|---|
| A 島嶼模板 | ✅ 已 commit + push | `830c27b58` |
| 清單模式（PRD §8） | ✅ 已 commit + push | `684efea9d` `c3177ed71` |
| ③ 逐站完成路徑審查 | ✅ 已 commit + push | `f6ba7feec` `5e08aeb75` `db6ca9fd3` |
| G7 樹擋視野修正 | ✅ 已 commit + push，等部署後補 after 截圖 | `7d63e588c` |
| B 第一課玩通 | 進行中 | — |
| D1-D4 遊戲區入口／群島頁 | D2 成本分析已回報 team-lead，待決策 | — |
| C 全課自動檢查 | 未開始 | — |

## 已發現並修正的畫面缺陷

### 1. 出生點視野被樹擋住（Young 2026-10-26 親自看截圖發現）

- **問題**：第一人稱出生點畫面右邊約三分之一被一棵前景大樹擋住，看不清楚港口燈塔和路
- **根因**：105 棵程序生樹只排除「離站點太近」（< 2.7），沒排除「離出生點太近」。21 號樹離出生點 `(-2, 16.5)` 只有 1.79 單位
- **修法**：新增 `isSceneryExcluded()`（`islandTemplate.ts`），同時檔站點跟出生點兩種太近的情況，排除半徑 4
- commit：`7d63e588c`
- **修改前截圖**：`/private/tmp/.../scratchpad/island-template/b-playthrough/02-after-opening.png`（本機路徑，審查核對用）
- **修改後截圖**：*被 2. 的白屏 bug 擋住，還沒補上——後面那個 bug 修好、重新部署、親眼確認場景有畫出來之後才會補*

### 2. 🔴 Task A 引入的白屏 race：3D 世界在特定時機下完全不渲染（2026-10-26 自己拍截圖時發現，team-lead 退件確認）

- **問題**：為了拍 1. 的「修改後」截圖，連續 3 次對預覽站截圖，畫面只有天空漸層背景跟 UI（進度列/側欄/按鈕都正常），`canvasRef` 的 div 底下 0 個子元素——不是「樹擋住了」，是整個 3D 場景（島、建築、路、樹、人物）完全沒有畫出來，而且沒有任何 JS 錯誤（`window.addEventListener('error')` 全域攔截確認過）
- **根因**：`ReadingIslandLab.tsx` 的 `createIslandWorld` useEffect 原本 deps 是 `[student, STOPS, BABIES]`。20011 走手刻覆蓋分支，`STOPS`/`BABIES` 在 `lesson` 還是 `null`（`fetchStory` 還沒 resolve）時就已經是 `STOPS_20011`/`BABIES_20011` 這兩個模組級穩定參照。但 `if (!lesson || STOPS.length === 0) return <main>載入中` 這個 render-gate 在 `lesson` 還是 null 時完全不渲染 `<div ref={canvasRef}>`——所以 effect 第一次執行時 `host` 一定是 null、提早 return。等 `lesson` 真正載入、畫面換成含 canvasRef div 的那次重新渲染，三個 deps 完全沒變（同一顆 STOPS_20011 參照），effect 不會重跑，canvasRef 雖然這時候已經掛上 DOM，但再也沒有人去建立 3D 世界。後端夠熱、`fetchStory` resolve 得夠快時這個 race 不會暴露（今天稍早 02:29 截圖成功過一次，就是因為快），後端變慢就會讓整個 3D 功能靜默完全失效
- **是誰引入的**：Task A（`830c27b58`）。改之前沒有 `!lesson` 這個 render-gate，`canvasRef` div 從第一次 render 就存在，不會有這個 race——用 `git show 830c27b58` 核對過
- **修法**：deps 加上 `lesson` → `[student, STOPS, BABIES, lesson]`。順手一起修了 code-reviewer 在審這個修法時發現的同族問題：world 建立當下要立刻用 `progressRef` 餵一次目前的進度，不能只靠另一個獨立 `setProgress` effect（避免「伺服器進度比 lesson 先到」時世界卡在預設的 unlockedZone=0/completed=[]）
- **測試**：`ReadingIslandLab.worldMount.test.tsx` 3 條，全部驗證過拿掉 `lesson` deps 會紅（mutation 驗證，不是只看綠燈）
- **誠實揭露**：`progressRef` 那條修正，對 20011 這個具體案例做 mutation 測試時「拿掉也還是綠的」——因為 `doneIndexes` 透過 `stepFor`/`sequence` 跟 `lesson` 的載入時機剛好耦合在一起，另一個既有的 `setProgress` effect 剛好會在同一輪重跑補上。這行修正本身無害、更穩健、reviewer 要求保留，但這支測試沒有真正「獨立證明這行是必要的」，寫在這裡不隱瞞
- commit：*待 code-reviewer 最終 PASS 後補上*

## 故事模式「一次一關」逃脫路徑審查（任務③，team-lead 指派）

逐一查過 20011 全部 10 站的「做完」handler 最後走哪條路徑，以及可能把學生帶離島嶼的其他按鈕：

| 檢查對象 | 結果 | 處置 |
|---|---|---|
| lesson-intro 的「開始閱讀」 | 原本就正確呼叫 `notifyIslandStepDone`，不 navigate | 無需修改（已有測試 `useLearningStepNavigation.islandStart.test.ts`） |
| 其餘 9 站的「完成」handler | 全部走共用的 `dispatchStepFinish → navigateAfterFinish`，沒有個別頁面自己 navigate | 鎖住共用開關（`useLearningStepNavigation.islandGenericFinish.test.ts`），等同保護全部 9 站 |
| ReportPage 的「前往這一關」跳轉按鈕 | 🔴 真的會發生：zone 2 四站無順序限制，可能先進 report 站，未完成卡片的跳轉按鈕會把 iframe 帶走 | 已修（`f6ba7feec`），故事模式下 `onGoToStep` 傳 `undefined` |
| ReportPage 的「作業尚未完成」警示（含兩個 navigate） | 🔴 真的會發生：學生從「我的作業」SPA 導航切來島上，sessionStorage 殘留 activeAssignmentId，zone 2 無序撞到此分支 | 已修（`5e08aeb75`），故事模式整塊跳過 |
| StepRoute 的 crash-fallback「跳過此步驟」 | 🔴 真的會發生：任何一站的學習頁故事模式下壞掉，原本的「跳過此步驟」會 navigate 到下一關 | 已修（`db6ca9fd3`），改叫「回到島上」且送新訊號 `ISLAND_STEP_ABORTED`（不算完成，不點燈） |
| KeyPassageReadingPage 的 `onBack` prop | 死碼：宣告了但整個元件從未渲染/呼叫 | 不需修改（無法渲染的程式碼沒有攻擊面） |
| ComprehensionPage | 死碼：未被路由，已被 ComprehensionMcqPage 取代 | 不需修改 |
| DictationPractice 的「返回」按鈕 | 真的會渲染，但 dictation 全站停用、不在任何島的 15 種 step id 裡，今天沒有島會載入這頁 | 已修（`db6ca9fd3`）比照 IntroPage 模式防禦性處理，不賭「用不到」 |

## 畫面截圖清單（待補：桌機 + iPad，所有狀態）

> B 完成後在這裡逐張列出：路徑、判定（有問題/無問題）。目前只有 G7 樹木問題一組截圖，
> 完整的「每一站、每個狀態」清單要等 B 的 `verify-b-listmode.mjs` 跑完才能填。

- [ ] 冷開場（點擊前）
- [ ] 開場插畫 6 張（20011 專屬）/ 4 句（其他課）
- [ ] 出生點第一人稱視野（已修正，待補 after 截圖）
- [ ] 10 站各自：進入提示卡、開門動畫、學習頁（0 頂部導覽）、回島、亮燈
- [ ] 清單模式：開啟、各站狀態（未開始/已亮燈/還在霧裡）、進入
- [ ] 區域解鎖與霧散（zone 0→1、zone 1→2）
- [ ] 全島亮完結局
- [ ] 桌機 1440px
- [ ] iPad 尺寸（768/1024 視角）

## 已知限制（誠實列出，不是積著不做）

- 文字寶貝（文字寶寶）目前沿用 20011 的 6 張通用佔位圖循環，沒有逐字生成的專屬美術（PRD §4.2 明列本期不做）
- 文言文 4 種專屬建築造型用簡單幾何，不做精緻美術（PRD §4.2 明列本期不做）
- lesson-intro 的「做過」判定目前仍用 sessionStorage（`visited`），換裝置不保留 —— 這是 D3 的工作範圍，PRD §6 已標註「D3 完成前這條不算通過」
