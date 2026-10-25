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
- **證據**（截圖存在本機 scratchpad，不進 repo，路徑供審查核對）：
  - 修改前：`/private/tmp/claude-501/-Users-young-project-chinese-literacy-platform/4b0a5225-3edc-455d-b8d2-a925784bd7aa/scratchpad/island-template/b-playthrough/02-after-opening.png`
  - 修改後：*等 commit `7d63e588c` 的預覽部署完成後補上*
- commit：`7d63e588c`

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
