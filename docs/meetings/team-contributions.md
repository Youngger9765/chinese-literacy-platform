# 團隊每週貢獻紀錄

每週追蹤每位開發者做了什麼，方便回顧和給回饋。

**完成定義**：PR merge 到 staging 即算完成（不需要到 main/production）。

---

## Young @Youngger9765

### 3/7 ~ 3/12 這週

| 狀態 | Issue | 做了什麼 |
|------|-------|---------|
| ✅ | Demo 4 批量開發 | 44 PRs merge 到 staging（作業系統、遊戲化、聽力、家長端、OAuth、E2E 等） |
| ✅ | #368 教師自建課文 | 我的課文 CRUD + 段落/生字編輯 + 預覽 UI |
| ✅ | #367 catch-up migration | 補齊手動建立的資料表 |
| ✅ | Bug fixes × 4 | story slug 422→404、gamification date crash、difficulty filter、student dashboard 500 |
| ✅ | E2E 測試 | 87/87 全通過，修正 storageState auth + modal handling |
| ✅ | CI/CD | RUN_MIGRATIONS 開關 + CSP connect-src 修正 |
| ✅ | 文件大更新 | CHANGELOG（+118 行）、README 重寫、TRD v2.0、ROADMAP v2.0、PRD v1.3、MRD 修正 |
| ✅ | Issue 管理 | 開了 38+ 個 issue 給實習生（#401-#438），每個都附思考方向 |
| ✅ | Code review | 靖杭 PR #230 review + merge |

### 3/3 ~ 3/6 上週

| 狀態 | Issue | 做了什麼 |
|------|-------|---------|
| 🔧 | #223 統一用戶模型 | users 表取代 Teacher/Student、RBAC 8 角色、JWT auth（bcrypt + HS256）、Alembic 手寫 migration（可逆）、Preview DB 建置、前端登入/註冊/auth gating、班級管理 API（7 endpoints）+ 前端 UI（Dashboard + Detail）、Admin 樹狀側邊欄、257 pytest + 7 Playwright E2E。PR #225 待 merge |
| ✅ | #171 學習紀錄持久化 | 合併到 #223。learning_sessions 加 JSONB 欄位（reading/comprehension/vocab/full_reading_result）+ status/story_slug/overall_score。API CRUD 完成 |
| ✅ | #221 code review | Review 靖杭的 IME fix，確認正確後 merge，簡化 isComposing 寫法 |
| ✅ | 文件整理 | PRD-ORGANIZATION、DEMO2_GAP_ANALYSIS、.gitignore 清理 |
| ✅ | 基礎設施 | 建立 Preview DB（lingoleap-preview-db）、Docker entrypoint 條件式 migration、preview-deploy.yml 更新 |
| ✅ | 文件清理 | PR #226/#227：移除所有文件中的敏感人名（33 檔案），merged staging + main |
| ✅ | Code review × 3 | Review 啟翔 PR #228（approved + merged）、PR #229（request changes：4 個問題）、靖杭 PR #224（approved + merged） |
| ✅ | 專案管理 | 7 個 open issues 補上 Milestone + Project board、close #215/#216/#218、清理 4 條已 merge remote branches |

### 2/24 ~ 2/28 上週

| 狀態 | Issue | 做了什麼 |
|------|-------|---------|
| ✅ | #85 段落進度條 | LiveTutor 段落完成/進行中/鎖定狀態顯示。PR #212 merged |
| ✅ | #169 #172 報告 UX | 預設摺疊過長區段、改善離開考試干擾選項。PR #208 merged |
| ✅ | #167 #173 Stepper 修復 | session rebuild、retry reset、whitespace fallback |
| ✅ | #198 #199 UI 修正 | StepperNav 步驟順序、英文→中文標籤 |
| ✅ | 文件 | MRD、TRD、BRD/PRD 校正、ROADMAP、班師生管理 PRD、Copilot 指引（8 PRs） |
| ✅ | Onboarding | 2/27 開發團隊 Onboarding 會議，分配任務給兩位學生 |

---

## 靖杭 @if-else-master

### 3/7 ~ 3/12 這週

| 狀態 | Issue | 做了什麼 |
|------|-------|---------|
| ✅ | #222 星星等級 | PR #230 merged（由 Claude 協助 merge，靖杭 assign） |
| 🔧 | #217 語音輸入 | 有在 issue 留修正說明（emoji 朗讀 bug），但尚未開 PR。功能已由 Claude 先實作並部署 |
| 🔧 | PR #314 SQLite/PG 相容 | 自主發現本地 DB 相容問題，開了 PR。方向需討論（JSONB→JSON 改法可能影響效能） |

本週沒有新的自己寫的 PR merge。但 PR #314 顯示開始理解後端，且會自主發現問題。

### 3/3 ~ 3/6

| 狀態 | Issue | 做了什麼 |
|------|-------|---------|
| ✅ | #216 中文輸入 Enter 送出 bug | IME 組字中按 Enter 會觸發送出，加了 isComposing 判斷解決。PR #221 merged staging，一次過 review。Issue closed |
| ✅ | #215 AI 指令區提示改善 | 提示從「請朗讀上方段落」改成「請閱讀左側文章的第1段：OOO...」，新用戶更清楚。PR #224 merged staging，code review 一次過。Issue closed |
| 🔧 | #217 語音朗讀功能 | 自己研究 Web Speech API 做出 TTS，還修了語音會連 emoji 一起唸的問題。有在 issue 留說明，還沒開 PR |
| ⬜ | #222 星星等級 | 還沒開始 |

本週完成 2 個（#216、#215 都一次過 review），進行中 1 個，未開始 1 個。表現很好，會主動研究、會在 issue 留說明。

### 2/24 ~ 2/28 上週

| 狀態 | Issue | 做了什麼 |
|------|-------|---------|
| 🔧 | #216 | 開始研究 IME 問題 |

---

## 啟翔 @stgst

### 3/7 ~ 3/12 這週

| 狀態 | Issue | 做了什麼 |
|------|-------|---------|
| ✅ | #220 生字練習 UX | PR #229 merged 3/7（經過 4 次 review 才通過） |
| ✅ | #219 破音字注音 | 啟翔在 issue 留了深度根因分析（指出人工規則無底洞問題 + 建議 AI 方案），後由 Young/Claude 根據分析實作 PR #290 修復（3/8 merged） |

本週 1 個 merge + 1 個高品質技術分析。PR #229 經過 4 輪 review，code quality 有進步。#219 的根因分析顯示啟翔有獨立思考能力，能看到架構層面問題。

### 3/3 ~ 3/6

| 狀態 | Issue | 做了什麼 |
|------|-------|---------|
| ✅ | #218 朗讀段落進度條 | LiveTutor 加段落進度條，+24 行。PR #228 merged staging，code review 一次過 |
| 🔧 | #220 改善生字練習 UX | WriteCharacter UX 重構（+96/-69 行）：自動開始練習、完成動畫、返回首頁流程。PR #229 open，code review request changes — 要修死碼 CtrlBtn、setTimeout 記憶體洩漏、StepGuidance 文字過時、handleRetry 重複邏輯 |
| ⬜ | #219 破音字注音顯示錯誤 | 還沒開始 |

本週完成 1 個，進行中 1 個（待修 review 意見），未開始 1 個。開始有產出了，PR #228 寫得乾淨。

### 2/24 ~ 2/28 上週

- 無紀錄

---

*最後更新：2026-03-12*
