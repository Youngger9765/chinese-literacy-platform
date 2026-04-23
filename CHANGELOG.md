# CHANGELOG — LingoLeap 國語文閱讀學習平台

產品功能變更記錄。

---

## [Unreleased]

（無）

## 2026-04-23（大掃除日 — 8 次 prod release）

### 🔒 Security 強化
- **TTS 三個 endpoint 加 auth** (#1244/#1240) — `/tts/synthesize` `/tts/sentence` `/tts/regenerate` 從無 auth → 加 `Depends(get_current_user)`，`/regenerate` 限 system_admin。前端 `ttsApi.ts` 同步加 auth header。堵死匿名洗 TTS 帳單 + 刪快取 attack
- **org_admin 跨組織隔離** (#1242/#1241) — `require_role("system_admin", "org_admin")` 原只檢查角色存在，未驗 `UserRole.scope_id` 匹配。修補 `users.py` / `gamification.py` / `feedback.py` 加 org scope check（個資法 §20）
- **Reset/verification token gating** (#1246/#1239) — `/auth/register`、`/auth/forgot-password`、`/auth/resend-verification` 之 token 僅在 dev env 返回 JSON；prod 返回 null，堵住「不需收信即可 takeover」路徑
- **LLM endpoint rate limit 補齊** (#1254/#1266/#1270) — `/generate-ai-comment` + `/stories/{id}/structure/grade` 補 5/min rate limit。#1270 把 rate-limit 檢查移到 cache validation 之後，避免 cache-miss 400 也燒配額

### ⚡ 效能優化
- **6 N+1 查詢消除** (#1218/#1221) — routes + services 雙層，21 regression tests
- **DB 熱欄位 index** (#1226/#1267/#1280) — `LearningSession.status` + `(student_id, status)` compound、6 個 FK 欄位（ClassroomStudent/Classroom/Assignment/UserRole）補 `index=True`、`ai_usage.teacher_id` 補 annotation
- **SQL 聚合下推** (#1227) — `learning_dashboard` cumulative stats + `teacher_analytics` time-stats 從 Python 雙 loop 改 SQL `func.count/avg/sum(case)` + `group_by(func.date)`
- **I/O 非同步** (#1228) — TTS 路由改 `async def` + `asyncio.to_thread()`，5 concurrent 2.5s → 0.51s（~5x）

### 🎨 UX / Design
- **/student /assignments /vocabulary 設計統一** (#1268/#1248) — 全部對齊 `/student` 主頁基準的 design tokens（`tertiary`、`accent`、`surface`），字級放大、shadcn 元件
- **/learning-history 全修** (#1250/#1282/#1245) — 字級放大、得分/準確率統一（overall_score 優先 → accuracy fallback → 「—」）、作業紀錄不再空白（`list_my_sessions` assignment-aware status fix）、學習報告 render 空白修復（`hasNoData` 邏輯 + JSON string parse）
- **Step 9/11 UX** (#1272/#1103/#1104) — ComprehensionChat 5 題後加「下一關 →」按鈕引導；KnowledgeStation 未完成關卡時加缺漏提示 + 快速跳轉
- **Step 7/8 UX** (#1283/#1101/#1284/#1102) — 詞語定義保留炮灰選項 + MC 按鈕置中；拖拉配對飛掉動畫修復 + 捲動 + 填充炮灰
- **library 課文狀態 label** (#1274/#1230 → 字典頁；library status via earlier 部分) — `/library` 每篇課文帶「作業中 / 練習中 / 已完成 / 未開始」狀態 badge
- **/dictionary 新頁** (#1274/#1230) — 學生查字義、注音、例句；rate limit 60/min + auth，無 Redis cache

### 🧹 Tech Debt 清理
- **Dead code + heuristic hard cap** (#1263/#1261/#1262) — 移除 `_user_has_admin_role` dead code、`/learning-history` `sql_fetch_limit` 上限由 `+50` buffer 改為 `min(limit+50, 500)` 硬上限
- **CLAUDE.md 覆寫規則** (#1276/#1273) — 14 天反覆 bug 類別註冊 PostToolUse hooks + skills：`sqlalchemy-model-safety` / `llm-endpoint-hardening` / `alembic heads` 自動檢查
- **Backend regression test** (#1278/#1251) — `list_my_sessions` assignment 完成狀態 14 個 test case

### 📝 Docs
- **Weekly wrap-up** (#1259/#1258) — ROADMAP、meeting record、contributions、skill trees、blog
- **Perf sprint CHANGELOG + PRD** — PRD 系統效能 table 加「現況」欄位 + 5 PR 總結

### 🎯 Prod release 順序（今天 8 次）
1. `dc3906d7` 6 N+1 修復
2. `edb9d42c` perf + library + rate limit
3. `49e2a20c` cleanup + docs
4. `f06fdac6` LLM security + design unify
5. `d42a7ec1` rate-limit fix + Step UX + FK indexes
6. `10b75c0d` dictionary page
7. `a0d47bdc` docs + index annotation
8. `3e69703b` learning-history render + Step 7/8 UX

## 2026-04-22 ~ 2026-04-23

### 效能優化（後端熱路徑大掃除）

**N+1 查詢消除（routes 層）** — PR #1218 / #1221
- `/api/assignments/my`（學生首頁）從 2N+1 → 3 queries（batch pre-load sessions + texts）
- `/api/classrooms/{id}/assignments`（教師作業清單）從 N+1 → 2 queries
- 教師熱力圖 + 錯字熱力圖 加 `joinedload(ClassroomStudent.student)`
- CSV export（`/admin/reports/export`）三層 lazy load → 1 joinedload（student + classroom + school）
- Gamification leaderboard + `_assert_can_view` 加 `joinedload(UserRole.role)`
- 21 regression tests（含 query count bound assertions）

**DB Index（熱欄位補齊）** — PR #1226
- `LearningSession.status` 單欄 index + `(student_id, status)` compound index
- `AssignmentSubmission.student_id` / `CharacterError.session_id` 補 SQLAlchemy `index=True` 宣告（DB 層 index 2026-04-04 已建）
- Migration 用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS` 避免 prod lock table

**SQL 聚合下推（service 層）** — PR #1227
- `learning_dashboard` cumulative stats：Python 雙 loop → 單 SQL aggregate（`func.count/avg/sum(case)`）
- `teacher_analytics` time-stats：移除 `.limit(5000)` cap，改 SQL `group_by(func.date)`
- `cross_text_analysis_service._completed_sessions_with_text` 漏網 N+1 修復（改 `joinedload(LearningSession.text)`）
- 16 regression tests + before/after query count 對比

**I/O 非同步化 + 查詢邊界** — PR #1228
- TTS 三個路由（`/tts/synthesize`、`/tts/sentence`、`/tts/regenerate`）改 `async def`，內部用 `asyncio.to_thread()` 包同步 SDK 呼叫
  - 5 concurrent requests 實測：sync 2.5s → async 0.51s（~5x speedup，mock 0.5s 延遲驗證）
- `learning_path_service` 的 `story_slug IS NOT NULL` 過濾推 SQL WHERE
- Teacher heatmap 超過 5,000 sessions 改 raise 400（取代靜默截斷），匹配 `_ADMIN_EXPORT_ROW_LIMIT` pattern

## 2026-03-09 ~ 2026-03-12

### 新功能
- 教師自建課文庫 UI「我的課文」— CRUD + 段落/生字編輯 + 預覽 (#368)
- Catch-up migration：補齊手動建立的資料表 (#367)

### 修正
- Story slug 422 → 404 + 前端 legacy slug 防護 (#366)
- 遊戲化 date() crash（date vs datetime 型別）
- 課文難度篩選、作業 null crash、跨課文 display_name

## 2026-03-06 ~ 2026-03-08

### 新功能
- 學生儀表板 500 修正（naive datetime）+ 首頁隱藏 stepper
- CI/CD 加入 RUN_MIGRATIONS 開關 + E2E 測試腳本 + 實習生指南
- Classroom teachers 表 + classroom_texts 欄位 migration

### 修正
- E2E 測試 87/87 全通過 — storageState auth、modal 處理、selector 修正
- Terms modal + onboarding dismissal 加入 E2E fixtures
- CSP connect-src 加入 *.run.app 以解除 API 呼叫阻擋
- Health endpoint 移除不必要的 GOOGLE_CLOUD_PROJECT 檢查
- IME 中文輸入 isComposing 修正 (#216)

### 文件
- 使用者旅程測試指南（手動 QA 用）

## 2026-03-03 ~ 2026-03-05

### 新功能（Demo 4 批量開發 — 44 PRs）

**作業系統**
- 教師作業管理系統 (#23)
- 學生作業檢視 + 通知模板 (#24)
- 教師作業批改 + 批量提醒 UI (#23)
- 學生作業自動提交 + 繼續流程 (#24)
- 作業副本策略 + DB migration (#143)

**學習優化**
- 自學模式優化 + 進度追蹤 (#25)
- 卡點偵測 + 個別化學習建議 (#91)
- 教師特別教學指示 + AI 蘇格拉底對話整合 (#90)
- 課文目標設定（語速、正確率門檻）(#84)
- 段落漸進式朗讀解鎖 (#85)
- 學習路徑引擎 + 五模組完成度追蹤 (#257)
- AI 個別化學習路徑推薦 (#252)
- 預測學習困難偵測（規則引擎）(#254)
- 跨課文學習模式分析 (#253)

**遊戲化 & 互動**
- 遊戲化系統：XP、成就、連續登入 (#26)
- 星星等級顯示（完成 6 步驟後）(#222)
- 學習完成慶祝動畫 (#272)
- 學生字體大小調整 (#262)

**帳號 & 安全**
- Google OAuth 登錄 (#27)
- 密碼強度驗證 + 忘記密碼流程 (#255)
- 多租戶 middleware + 可重用 auth 依賴 (#18)
- Prompt injection 防護 (#270)
- 使用條款同意流程

**教師端**
- 教師儀表板 + 分析 API（Recharts）(#21, #22)
- 班級表現熱力圖 (#87)
- 班級警報 + 學生學習曲線 (#86, #93)
- 教師通知中心 — 學習預警收件匣 (#256)
- 學生標籤系統 (#299)
- 多教師共同教學 (#244)
- 著作權確認（指派課文時）(#108)
- 課文上架 API + Admin 管理介面 (#7)
- 課文自動清理（學期結束）(#92)

**學生端**
- 聽力理解模組（TTS + AI 評估）(#251)
- 聽寫練習模組 (#96)
- 造句練習 (#109)
- 發音練習 + 錄音比對 (#89)
- 部件拆解（生字學習）(#88)
- 學生錄音 + 回放 (#77)
- 語音輸入（STT → ComprehensionChat）(#217)
- 錯字矯正機制 + 生字推薦 (#248)
- 蘇格拉底對話歷史紀錄 (#242)
- 3 級理解評分 (#243)
- AI 朗讀診斷（報告第六環節）(#241)
- Session 續接（中斷後繼續）(#271)
- 學生 Onboarding 引導流程 (#264)
- 教育部字典 API + DB 快取 (#259)
- 家長儀表板 — 查看孩子學習進度 (#95)
- 生字練習 UX 改善 + 動畫 (#220)

**品質 & 基礎設施**
- E2E 測試（Playwright）+ 路由級 code splitting (#28)
- Production 部署腳本 + 監控 (#29)
- Locust 壓力測試（30 concurrent users）(#260)
- 安全掃描 CI（npm audit + pip-audit）(#273)
- WCAG 2.1 AA 無障礙稽核 (#258)
- GA4 Analytics 追蹤 (#246)

**文件**
- 使用手冊 + /help 頁面 (#30)
- Beta 上線套件（指南、FAQ、支援模板）(#263)

## 2026-02-28 ~ 2026-03-02

### 新功能
- 統一用戶模型：users 表取代 Teacher/Student + RBAC 8 角色 + JWT auth (#223)
- 學習紀錄持久化：learning_sessions JSONB 欄位 (#171)
- 班級管理 API（7 endpoints）+ 前端 Dashboard + Detail UI (#19)
- Admin 樹狀側邊欄
- Preview DB 建置（lingoleap-preview-db）
- 257 pytest + 7 Playwright E2E

### 修正
- IME 中文輸入 Enter 送出 bug (#216)
- AI 指令區提示改善 (#215)

## 2026-02-27

### 新功能
- 步驟導航顯示完成狀態與學習摘要 (#167)
- 錯字詞清單新增「前往生字練習」按鈕 (#81)
- AI 助教語氣統一「溫暖但堅定」，前端門檻集中管理 (#54)

### 修正
- 步驟順序修正：課文理解↔生字練習對調 (#198)
- 英文介面文字翻為繁體中文 (#199)
- 報告頁無朗讀資料時顯示引導提示 (#137, #173)
- 導航列字體加大 (#130)
- 生字練習在無朗讀結果時顯示正確訊息 (#139)

### 文件
- 新增 MRD 市場需求文檔 (#195)
- 新增 TRD 技術規格文檔 (#196)
- 四大文件交叉引用 + 文件索引頁 (#197)

## 2026-02-26

### 新功能
- Step 6 朗朗上口六環節診斷報告 (#107)
- 出場卷 Exit Ticket — 報告底部學習驗收小測驗 (#106)
- 朗讀流暢度分析：正確字數 CPM 計算 (#78)
- 逐句差異比對顯示（原文 vs 辨識結果）(#80)
- 57 篇課文改由後端 API 提供 (#142, #149)

### 修正
- 出場卷：缺字也觸發出題 (#106)
- 報告頁邏輯修正 + 全文朗讀引導 + 出場卷干擾項改善 (#168, #170, #172)

## 2026-02-24 – 2026-02-25

### 新功能
- 手機 / 平板 / 桌面三種 RWD 佈局 (#125)
- 課文庫搜尋功能 + 載入骨架動畫

### 修正
- 注音字型行距調整 (#116, #118, #120, #122, #126)
- 段落間距加大 (#114)
- 文字色彩對比度提升 (#111)

## 2026-02-23

### 新功能
- 57 篇課文 + AI 生成縮圖上線 (#55, #58, #59)
- 全站切換為淺色主題 (#61)
- AI 助教人格「溫暖但堅定」(#54)

### 修正
- 全文朗讀聽寫文字可讀性 (#100, #104)

## 2026-02-22

- 朗讀結果串接蘇格拉底對話 (#17)
- 蘇格拉底對話答錯判定加嚴 (#44)
- 跳過朗讀進對話不再報錯 (#48)
- Session 過期後自動重建 (#49)
- 聊天氣泡排版修正 (#31, #42)

## 2026-02-21

- 完整六步驟學習流程上線（簡介→朗讀→課文理解→生字練習→全文朗讀→報告）
- 蘇格拉底式 AI 對話
- 注音符號切換 + 筆順練習
- 語音辨識 + 文本比對
