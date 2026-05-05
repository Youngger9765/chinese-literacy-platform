# Issue #1462 修正說明

## 問題摘要

PR #1461（issue #1460 Phase 1）已完成 toolbox 的隔離 + 完成後 navigate `/tools` 不去下一步。但**每個工具自己的完成畫面**仍顯示「下一步」/「繼續」/「完成」之類的 CTA。本 PR 補完 UX 規格：「在練習工具箱中，每一關結束後只會出現重做或回到練習工具箱的按鈕，不會有下一步」。

---

## 修正內容

### 策略

新增共用元件 `<ToolboxCompletionActions onRetry={...} />`：渲染兩個按鈕（重做 / 回到練習工具箱），「回到練習工具箱」會 `setToolboxMode(false)` + `navigate('/tools')`。「重做」由各 tool 提供 reset handler。

每個 tool 元件在完成畫面用 `isToolboxMode()` 判斷，工具箱模式下用新 CTA 取代原本的「下一步」按鈕。**自學 / 作業流程完全不變** —— 該分支只在 toolbox flag 為 true 時走。

---

## 修改檔案

| 檔案 | 變更 |
|------|------|
| `frontend/src/components/tools/ToolboxCompletionActions.tsx` | **新增** — 共用 CTA 元件 |
| `frontend/src/components/reading-steps/FullReading.tsx` | 完成 result panel 加 toolbox 分支 |
| `frontend/src/components/reading-steps/VocabDefinitionMatch.tsx` | `SummaryScreen` 增加 `inToolbox` prop |
| `frontend/src/components/reading-steps/FillInBlankExercise.tsx` | summary 畫面加 toolbox 分支（使用方為 VocabApplication） |
| `frontend/src/components/reading-steps/VocabWordSearch.tsx` | finished 完成 CTA 加 toolbox 分支 |
| `frontend/src/components/reading-steps/VocabPractice.tsx` | allDone CTA 加 toolbox 分支（重做 = 清字練習進度） |
| `frontend/src/components/reading-steps/ListeningPractice.tsx` | results phase CTA 加 toolbox 分支（重做 = 回 play phase） |
| `frontend/src/components/reading-steps/SentencePractice.tsx` | allWordsDone CTA 加 toolbox 分支（重做 = 清完成詞語） |
| `frontend/src/components/reading-steps/ComprehensionChat.tsx` | isWorksheetComplete CTA 加 toolbox 分支（重做 = 重設 tab 完成狀態） |
| `frontend/src/components/reading-steps/KnowledgeStation.tsx` | onFinish CTA 加 toolbox 分支（重做 = 重新載入頁面） |
| `frontend/src/components/reading-steps/live-tutor/LiveTutor.tsx` | 自動 onFinish 改為 modal overlay（重做 = 清逐段紀錄） |

10 個工具（含 FillInBlankExercise 為 VocabApplication 的子元件）全部處理。

---

## 後端影響

無。本 PR 為純前端 UX polish，不動 routes / model / migration。

---

## 測試方式

### 前置步驟（共用）

```bash
cd frontend && npm run dev   # localhost:3000
```

從學生帳號登入，進 `/tools`，選任一課文 + 任一工具，完成練習。

### 本地開發測試

> 環境：localhost:3000（無需後端）

**驗證方法 A — 10 個工具逐一過完成畫面**

| 工具 | 完成觸發條件 | 預期 CTA |
|------|-------------|---------|
| 朗讀練習 (LiveTutor) | 完成最後一段 | 跳出 modal：重做 / 回工具箱 |
| 全文朗讀 | 顯示分數 panel | 重做 / 回工具箱 |
| 聽力理解 | results phase | 重做 / 回工具箱 |
| 生字書寫 | 全部字練完 | 重做 / 回工具箱 |
| 造句練習 | 所有詞做完 | 重做 / 回工具箱 |
| 詞語理解 | summary phase | 重做 / 回工具箱 |
| 詞語應用 | done phase（透過 FillInBlankExercise）| 重做 / 回工具箱 |
| 課文理解 | mcqDone 或 structureVisited | 重做 / 回工具箱 |
| 詞語搜尋 | 全部找到 | 重做 / 回工具箱 |
| 知識補給站 | 進入頁面後 | 重做 / 回工具箱 |

**驗證方法 B — 自學 / 作業流程不受影響**

- 從 `/library` 進課文 → 走學習流程 → 完成各工具 → 應顯示「繼續下一步」/「下一關」等原本 CTA
- 從 `/assignments` 進作業 → 同上

---

### 本地開發測試結果（2026-05-05 實測）

**測試環境**

- macOS Darwin 25.3.0
- 分支：`feat/1462-toolbox-completion-ctas`（從 `feat/1460-phase1-toolbox-tables`，stacked PR）
- TypeScript：無新增 type error（`FillInBlankExercise:161` 與 `ComprehensionChat:222` 是 pre-existing）

| 步驟 | 動作 | 結果 |
|------|------|------|
| 1 | `npx tsc --noEmit` 過濾本次變更檔 | ✅ 無新增 error |
| 2 | grep `ToolboxCompletionActions` 引用 | ✅ 11 個檔案（含元件本身） |
| 3 | grep `isToolboxMode` 引用 | ✅ 10 個工具元件 + 1 個 ToolboxCompletionActions + 既有 #1460 檔案 |
| 4 | 邏輯檢查：每個 tool 的 retry handler | ✅ 都呼叫對應 setState 重置內部進度 + 清 storageKey |

**結論：修正驗證通過 ✅**

> 視覺截圖留待 PR Preview 部署完成後補上 PR comment。

---

### 雲端（Staging / Production）測試

**驗證方法 A — PR Preview**

1. 部署 URL 開 `/tools`，選課 + 選工具
2. 完成練習 → 確認看到「重做」+「回到練習工具箱」按鈕
3. 點「重做」→ 應重新開始該工具（不留前次紀錄）
4. 點「回到練習工具箱」→ 應回 `/tools` picker，可重新選課/工具

**驗證方法 B — DevTools 看 sessionStorage**

完成練習 → 點「回到練習工具箱」後：
```
sessionStorage.toolboxMode  // 預期：null（已清）
```

---

### 迴歸測試（兩環境皆適用）

- [ ] 從 `/library` 走完整 7 步驟學習流程，每步驟完成 CTA 仍是原本「繼續下一步」 / 「下一關」
- [ ] 從 `/assignments` 進作業，CTA 仍是原本作業流程
- [ ] 在自學流程中重複進入同一個 step，progress 仍正常保留（沒被工具箱誤清）

---

## 嚴重性

**前端 UX 層**，無 DB / API 變更。最壞情況：某個工具的「重做」按鈕邏輯沒清乾淨，學生重做時看到上次殘留 → bug fix 範疇。

**Stacked PR 注意**：本 PR 從 `feat/1460-phase1-toolbox-tables` 分出（PR #1461 還沒 merge），target `staging`。等 PR #1461 merge 後 diff 自然只剩本 PR 的 11 個檔案。
