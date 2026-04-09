# 團隊每週貢獻紀錄

每週追蹤團隊做了什麼，方便回顧和給回饋。

**完成定義**：PR merge 到 staging 即算完成（不需要到 main/production）。

**團隊**：Young @Youngger9765（lead dev）、靖杭 @if-else-master（實習）、啟翔 @stgst（實習）

---

## 4/4 ~ 4/10

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | PR #1023 使用條款 | ToS + 著作權同意流程（教師4勾+學生簡化版） |
| Young | ✅ | PR #1025 推薦課文 | 報告頁底部加推薦課文，關閉學習迴路 |
| Young | ✅ | PR #1024 成就恢復 | 恢復成就功能到學生側邊欄 |
| Young | ✅ | PR #995 教師報告 | 教師端查看學生報告 + AI 評語（#930） |
| Young | ✅ | PR #1027 學生關聯 | student-teacher 關聯 feature flag（#457） |
| Young | ✅ | PR #1026 統一計數 | 統一已完成課文數量計算 |
| Young | ✅ | PR #1022 slug 正規化 | 集中 story_slug 正規化 |
| Young | ✅ | PR #1021 session 去重 | get_or_create + client-side guard |
| Young | ✅ | PR #1010 遲到學生 | 遲到學生自動建立 assignment submissions |
| Young | ✅ | PR #1009 圖書館修正 | 圖書館正確顯示指派課文 |
| Young | ✅ | PR #1008 教師報告UX | 評語在報告上方，隱藏空區塊 |
| Young | ✅ | PR #1003 多音字重試 | exponential backoff retry |
| Young | ✅ | PR #1002 個人資料 | PATCH /users/me |
| Young | ✅ | PR #1001 作業同步 | 建立作業時同步 story_id 到 classroom_texts |
| Young | ✅ | PR #1000 回溯建立 | 學生加入班級後回溯建立作業 submissions |
| Young | ✅ | PR #992 UI 清理 | 報告頁移除 AI 分析 + 字體統一 Noto Sans TC |
| Young | ✅ | PR #970 Socratic 持久化 | SessionStore 從 in-memory 改存 DB |
| Young | ✅ | PR #978 CI/CD | post-deploy health check |
| Young | ✅ | PR #976 清理 | 移除 E2E Playwright tests（-12,202 行） |
| Young | ✅ | 孤兒清理 | 清掉 4 個孤兒 preview Cloud Run services |
| Young | ✅ | Staging QA | 10 步驟全部通過 + 進度條/全形修正驗證 |
| 靖杭 | ✅ | PR #987 tab 鎖定 | 詞語定義 tab 前置鎖定提示（feat #925） |
| 靖杭 | ✅ | PR #986 記錄分離 | 自學和作業記錄分離（feat #926） |
| 靖杭 | ✅ | PR #979 進度條 | 作業進度條顏色改綠色 + 排版每5格換行（fix #924） |
| 靖杭 | ✅ | PR #1031 全形修正 | 詞語應用全形/半形答案修正（fix #1029） |
| 靖杭 | 🔧 | PR #988 排序 | 學習歷史排序功能（feat #435）— 需 rebase |
| 靖杭 | 🔧 | PR #1030 學習紀錄 | 學生練習紀錄查詢頁面（feat #416）— review 中 |
| 啟翔 | ✅ | PR #959 造句單位 | 造句練習改以詞為最小單位（feat #927） |
| 啟翔 | ✅ | PR #969 防複製貼上 | 造句批改驗證真實性 + 防複製貼上（fix #928） |
| 啟翔 | ✅ | PR #913 rate limit | rate limiter 改為僅限 cache miss（fix #911） |

---

## 3/28 ~ 4/3

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | UI 改善 6 項 | 字體分層/font-weight/按鈕/卡片/留白/模組色彩（52+ files，staging 已部署） |
| Young | ✅ | 數位讀寫網分析 | `docs/research/eliteracy-uiux-design-analysis.md` 完整設計分析 |
| Young | ✅ | API tests | 38 cases covering all 10 AI routes（`db8e046`） |
| Young | ✅ | API source field | #836 sentence example API 加 source 欄位（PR #902） |
| 靖杭 | ✅ | PR #905 按鈕修正 | 閱讀標記浮動工具列座標計算修復 |
| 靖杭 | ✅ | PR #899 標記欄位 | 標記課文紀錄欄位 |
| 靖杭 | ✅ | PR #898 進度條 | 作業進度條與對話紀錄學習進度顯示 |
| 靖杭 | ✅ | PR #662 skeleton | Loading skeleton |
| 靖杭 | ✅ | PR #644 整合 | 合併「我的作業」「學習進度」「對話紀錄」 |
| 靖杭 | ✅ | PR #805 家長頁 | 隱藏家長頁面 |
| 靖杭 | 🔧 | PR #900 部件拆解 | 生字練習部件拆解修正，已 rebase 解衝突 |
| 靖杭 | 🔧 | PR #652 UI 優化 | 課文理解 UI 優化（WIP） |
| 啟翔 | ✅ | PR #912 造句 cache | 造句練習改用 vocabulary 生字，修正 cache 命中率（已 merge） |
| 啟翔 | 🔧 | PR #913 rate limit | 造句例句 rate limit 改為僅限 cache miss |

---

## 3/14 ~ 3/20

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | 重構 × 4 | learning.py / teacher.py / classrooms.py / App.tsx 拆分模組（PR #543~#546） |
| Young | ✅ | #550 教師側邊欄 | 我的課文、作業管理提升到 sidebar（PR #565） |
| Young | ✅ | WorkspaceContext | 多角色/多學校切換（PR #566） |
| Young | ✅ | #559 Project Hub | `/hub` 頁面（PR #560） |
| Young | ✅ | #521/#525 效能 | SQLAlchemy connection pool + 消除 N+1 query（PR #532/#534） |
| Young | ✅ | AI 穩健性 | Gemini content filter 錯誤處理 + AI report cache invalidation（PR #533/#570） |
| Young | ✅ | #235 CSV 匯出 | 教師班級學習進度 CSV 下載（PR #514） |
| Young | ✅ | #515 無障礙 | WCAG 2.1 AA：aria labels、focus styles、progress bars（PR #515） |
| Young | ✅ | CI/CD | schema drift 自動檢查 + smoke test + Sentry 錯誤追蹤（PR #587~#589） |
| Young | ✅ | Bug fixes × 8 | story slug 正規化、story title 顯示、/progress UX、JWT logout、semesters migration 等 |
| Young | ✅ | 多校切換 UI | 教師端多校切換（PR #600，Fixes #572） |
| Young | ✅ | Release to main | staging → main 62 commits（PR #537） |
| Young | ✅ | 實習生技能樹 | raymond.json 技能更新（PR #573/#575 評估） |
| 靖杭 | ✅ | #568 作業發派 422 | PR #573 merged — 前後端 API schema 不一致導致 422，跨層修復（backend schema + frontend api + 測試） |
| 靖杭 | ✅ | #574 留言按鈕 UI | PR #575 merged — emoji 改文字按鈕，提升教師端可讀性 |
| 靖杭 | 🔧 | #217 語音對話模式 | PR #451 open — 需 rebase + 改用 useSpeechRecognition hook |
| 靖杭 | 🔧 | PR #314 SQLite/PG | 決議統一用 PG，PG 設好後可關閉此 PR |
| 啟翔 | 🔧 | #262 字體大小即時同步 | PR #450 open — 需改用 CustomEvent 取代 StorageEvent |

---

## 3/13（前週收尾）

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | 文件更新 | P7→P8 feature 重分配、模組架構重設計、ROADMAP v3.3 |
| Young | ✅ | 實習生技能樹 | 互動式 HTML 技能樹 + 20 堂教材 + PBL 課程 + review agent/skill |
| Young | ✅ | 會議 3/13 | 平台實測 + AI 協作流程 + 減法開發策略 + 遊戲化願景 |
| 啟翔 | ✅ | #445 生字練習崩潰 | PR #448 merged — useMemo hooks 順序修復 |

---

## 3/7 ~ 3/12

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | Demo 4 批量開發 | 44 PRs merge 到 staging（作業系統、遊戲化、聽力、家長端、OAuth、E2E 等） |
| Young | ✅ | #368 教師自建課文 | 我的課文 CRUD + 段落/生字編輯 + 預覽 UI |
| Young | ✅ | #367 catch-up migration | 補齊手動建立的資料表 |
| Young | ✅ | Bug fixes × 4 | story slug 422→404、gamification date crash、difficulty filter、student dashboard 500 |
| Young | ✅ | E2E 測試 | 87/87 全通過，修正 storageState auth + modal handling |
| Young | ✅ | CI/CD | RUN_MIGRATIONS 開關 + CSP connect-src 修正 |
| Young | ✅ | 文件大更新 | CHANGELOG（+118 行）、README 重寫、TRD v2.0、ROADMAP v2.0、PRD v1.3、MRD 修正 |
| Young | ✅ | Issue 管理 | 開了 38+ 個 issue 給實習生（#401-#438），每個都附思考方向 |
| Young | ✅ | Code review | 靖杭 PR #230 review + merge |
| 靖杭 | ✅ | #222 星星等級 | PR #230 merged（由 Claude 協助 merge，靖杭 assign） |
| 靖杭 | 🔧 | #217 語音輸入 | 有在 issue 留修正說明（emoji 朗讀 bug），尚未開 PR。功能已由 Claude 先實作並部署 |
| 靖杭 | 🔧 | PR #314 SQLite/PG 相容 | 自主發現本地 DB 相容問題，開了 PR。方向需討論（JSONB→JSON 可能影響效能） |
| 啟翔 | ✅ | #220 生字練習 UX | PR #229 merged 3/7（經過 4 次 review 才通過） |
| 啟翔 | ✅ | #219 破音字注音 | 在 issue 留了深度根因分析（指出人工規則無底洞 + 建議 AI 方案），Young/Claude 據此實作 PR #290（3/8 merged） |

---

## 3/3 ~ 3/6

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | 🔧 | #223 統一用戶模型 | users 表取代 Teacher/Student、RBAC 8 角色、JWT auth、Alembic migration、Preview DB、前端 auth、班級管理 API + UI、Admin 側邊欄、257 pytest + 7 E2E。PR #225 待 merge |
| Young | ✅ | #171 學習紀錄持久化 | 合併到 #223。learning_sessions 加 JSONB 欄位 + status/story_slug/overall_score |
| Young | ✅ | Code review × 3 | 啟翔 PR #228（approved + merged）、PR #229（request changes）、靖杭 PR #224（approved + merged） |
| Young | ✅ | 文件清理 | PR #226/#227：移除敏感人名（33 檔案）、PRD-ORGANIZATION、.gitignore |
| Young | ✅ | 基礎設施 | Preview DB 建置、Docker entrypoint 條件式 migration、preview-deploy.yml |
| Young | ✅ | 專案管理 | 補 Milestone + Project board、close #215/#216/#218、清理 remote branches |
| 靖杭 | ✅ | #216 中文輸入 Enter 送出 | IME isComposing 判斷。PR #221 merged，一次過 review |
| 靖杭 | ✅ | #215 AI 指令區提示改善 | 提示改為「請閱讀左側文章的第1段：OOO...」。PR #224 merged，一次過 review |
| 靖杭 | 🔧 | #217 語音朗讀功能 | 自己研究 Web Speech API 做出 TTS，修了 emoji 朗讀 bug。有在 issue 留說明 |
| 啟翔 | ✅ | #218 朗讀段落進度條 | LiveTutor 加段落進度條，+24 行。PR #228 merged，一次過 review |
| 啟翔 | 🔧 | #220 生字練習 UX | WriteCharacter UX 重構（+96/-69 行）。PR #229 open，request changes — 死碼、記憶體洩漏、文字過時、重複邏輯 |

---

## 2/24 ~ 2/28

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | #85 段落進度條 | LiveTutor 段落狀態顯示。PR #212 merged |
| Young | ✅ | #169 #172 報告 UX | 預設摺疊過長區段、改善離開考試干擾選項。PR #208 merged |
| Young | ✅ | #167 #173 Stepper 修復 | session rebuild、retry reset、whitespace fallback |
| Young | ✅ | #198 #199 UI 修正 | StepperNav 步驟順序、英文→中文標籤 |
| Young | ✅ | 文件 | MRD、TRD、BRD/PRD 校正、ROADMAP、班師生管理 PRD、Copilot 指引（8 PRs） |
| Young | ✅ | Onboarding | 2/27 開發團隊 Onboarding 會議，分配任務給兩位學生 |
| 靖杭 | 🔧 | #216 | 開始研究 IME 問題 |
| 啟翔 | — | — | 無紀錄 |

---

*最後更新：2026-04-08*
