# 團隊每週貢獻紀錄

每週追蹤團隊做了什麼，方便回顧和給回饋。

**完成定義**：PR merge 到 staging 即算完成（不需要到 main/production）。

**團隊**：Young @Youngger9765（lead dev）、靖杭 @if-else-master（實習）、啟翔 @stgst（實習）

---

## 6/22 ~ 6/26

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | 聚光燈/重點表內容 QA 系統化（#2400, #2404~2408）| 「內容放錯課」系統性修復、證據 gate + golden TDD、4 課 fail-close placeholder、10 課 shadowed 還原題目、6 課破圖剝除、G8-L14 還原蝴蝶蘭 + rebinding 護欄 |
| Young | ✅ | 雙 Pipeline QA Board + ratchet（#2409, #2412, #2414）| 聚光燈 + 重點表 每課×6 階段逐站證據 board、決定性 ratchet 4 指紋（結構/source/content/schema，drift 即 FAIL）|
| Young | ✅ | testset 跑分閉環（#2390, #2393, #2395, #2398）| 跑分結果持久化 + 時間戳、修 401 re-login + /presentation 301、79 課假佔位圖清除 + 1103 旅人鴿課文 → prod |
| Young | ✅ | 朗讀評估動畫（#2396）| 統一逐段 + 全文朗讀評估進度，duration 動態緩動、去假掃描 |
| 靖杭 | 🔧 | PR #2411 open（#2410）| 快速登入加「登入朗讀測試頁面」按鈕，幫測試者一鍵直達朗讀測試頁，CI 待 review |
| 啟翔 | ⏳ | #2200 / #2153 QA 七課驗收 | 本週無 PR，負責全平台 UX 七課人工驗收（needs-testing）|

---

## 6/15 ~ 6/18

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | 朗讀/live-tutor 批次（#2230~2236, #2239, #2245, #2249）| STT/LLM console debug、eval rules + CPM/全形對齊鎖測試、擋 Web Speech 蓋掉 Gemini transcript、pending 錄音三按鈕 + 隱藏舊評估、全文朗讀結果分段縮排、self-assessment 改用 lesson benchmark feedback |
| Young | ✅ | 教授 demo story structure / 聚光燈 / 重點表（#2256~2261）| 聚光燈 block-sequence v2、profile-driven demo、keypoints 136 課同步 DOCX 版面表格、how-to-play coach + fill-blank demo、隱藏 placeholder 空答案、L1-L5 story structure QA 驗證 gate |
| Young | ✅ | vocab UX 批次（#2237~2248）| 拖拉詞庫雙欄 + 釘選示範對、coach 寬度對齊、word search 引導 demo onboarding、fill-in-blank 引導 tooltip、MCQ↔拖拉自由切換、移除拖拉 TTS、學習單 PDF 改下載 |
| Young | ✅ | infra（#2229, #2251, #2252）| GEMINI.md 從 CLAUDE.md auto-sync、staging→main release、stepper 解鎖報告步驟（每步可自由導航）、diff 注音 ruby |
| 靖杭 | 🔧 | PR 2255 open（#2192 item 5）| 閱讀聚光燈 申論/填空 AI 即時批改（+468/-12, 10 檔），6/17 push，CI 綠待 review |
| 啟翔 | 🔧 | PR 2254 open | 朗讀正確率不再超過 100%（分母改用 token 統計，+97/-3），6/17 push，CI 綠待 review |

> 本週兩位實習生 0 merged，各 1 open PR 待 Young review。方大哥 6/17 測試簡化版朗讀回報評分過低（58%）+ 流程 UX 問題，列為 6/18 會議核心。

---

## 5/22 ~ 5/29

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| 靖杭 | ✅ | PR #1977（#1973）| OMO grader 結果依 YAML 題號排序（先 fb_* → mc_* → se_*），fix 雙頁 _split_spread 後題號跳序問題，在 service 層做不是 frontend hack |
| 靖杭 | ✅ | PR #1979（#1976）| OMO 收 PDF！後端用 pypdfium2 拆每頁為 JPEG，下游 pipeline 完全不改。lib 選型有 rationale（Cloud Run 友善 + Apache-2.0），+503/-59 6 檔，首次引入 backend 新 dep |
| 靖杭 | ✅ | PR #1980（#1975）| OMO 批改記錄頁：backend list endpoint（精簡 8 欄位 + thumbnail）+ frontend 歷史頁 + 上傳頁加入口，list vs detail endpoint 有意識拆分，+906/-5 9 檔 |
| 靖杭 | 🔧 | PR #1978 open（#1974）| OMO 多頁上傳 UX — 縮圖 / 排序 / 確認再送，5/26 push 待 review |
| 啟翔 | 🔧 | PR #1601 open（#1549，stale）| step_progress 統一儲存，自 5/22 起 0 update，目前 CONFLICTING — ⚠️ 已 stale 兩週 |
| 啟翔 | ⏳ | 本週 0 PR | 連續第二週停滯（上次 merge 是 5/8 #1480）— 會議直接對話了解卡點 |
| Young | ✅ | OMO refactor + ops（5/22-5/23）| 60+ PR refactor split monoliths：admin / teacher / student / learning-session / ai_base / pinyin / stt / omo / strategy-exercise / mcq_rescue / ClassroomDetail / SemesterPanel / AdminTreeSidebar 等。配合 6/1 教授 review 之前做 deep clean |
| Young | ✅ | UX polish batch（5/23）| #1914 vocab 錯誤回饋、#1915 teacher-report empty state、#1923 閱讀聚光燈 empty copy、#1922 teacher/student onboarding toast、#1921 OMO three UX gaps（all-blank guard / candidate chips / reasoning expansion） |
| Young | ✅ | Admin / security 修補（5/23）| #1919 admin dashboard crash + classroom scope、#1918 admin terms role badge、#1920 移除 seed PII gmail + 修 admin roles、#1934 修 staging PII rows、#1924/#1933 CSP blob: 允許 OMO crop preview |
| Young | ✅ | Teacher/Student 資料隔離（5/26）| #1985 教師 dashboard 隱藏 dev/test classrooms、#1986 ClassroomDetail 8 tabs 排 2 行、#1987 join code 改 accordion、#1982 assignment start 500 修、#1983 移除 copyright checkbox、#1984 教師問候不重複「老師」後綴 |
| Young | ✅ | Assignment + 日期 i18n（5/26）| #1988/#2005 native date input 改為 zh-TW custom picker、#1989 assignment form 分 3 section、#1990 difficulty pill solid fill + aria-pressed、#1999 dev/test filter + fastapi pin、#2003 assignment.is_active regression contract |

---

## 5/12 ~ 5/15

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| 啟翔 | ✅ | PR #1547 MCQ rescue（#1387）| MCQ rescue dialog 重設計 + 接入閱讀聚光燈 + log attempts，#1387 Phase 1 體驗端關鍵組件 |
| 啟翔 | 🔧 | PR #1601 open（#1549）| 統一 learning-step 進度儲存到 step_progress，待 review |
| 靖杭 | 🔧 | PR #1599 open（#1598）| 課文簡介 AI 生成 + 學習策略獨立 hint 區，待 review |
| 靖杭 | 🔧 | PR #1600 open（#1597）| 朗讀歷史趨勢線圖 — 自己跟自己比，待 review |
| Young | ✅ | OMO Phase 1a backend（#1573，refs #1343）| upload / attempt / identify / grade 4 個核心 endpoint，7/1 demo 主軸 |
| Young | ✅ | OMO Phase 1b 學生 UX sprint（#1583 umbrella）| #1588 image hash dedup + regrade、#1590 3-tier 信心度確認 + GET /api/omo/lessons、#1592 結果頁 per-question + flag modal、#1593 loading/toast/image resize |
| Young | ✅ | OMO 品質修正 | #1581 conf<0.4 過濾、#1602 逐字相同強制 score=1、#1606 上傳上限 5→20、#1607 identify 對齊全 168 課 |
| Young | ✅ | OMO test + docs | #1596 3-tier confirm contract + render tests、#1589 master docs、#1595 test plan |
| Young | ✅ | 環境分隔（Phase 1c env hardening）| #1579 staging Cloud SQL 從 prod 拆、#1576 prod demo accounts 關 + OMO GCS bucket 拆、#1580 staging JWT_SECRET_KEY 注入、#1604 logging env tag + cron audit + OAuth docs |
| Young | ✅ | Pitch deck（5/13 評審用）| #1551/#1557/#1567/#1574 七課 7/1 deadline 進度簡報 + 字體 2x + 修破圖 |
| Young | ✅ | UX 小修 | #1564 預設無注音、#1566 stepper 放大 + 首字 label、#1568 vocab-application filter、#1570/#1572 displayChar per step、#1546/#1548 stepper 單擊導航、#1555 G7 圖文 2:1 ratio |

---

## 5/4 ~ 5/8

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| 靖杭 | ✅ | PR #1459 字體（#1351）| zhuyin-off 場景 BpmfZihiSerif 字嗨宋體 + 11 元件 + fonts.ts helper |
| 靖杭 | ✅ | PR #1461 toolbox Phase 1（#1460）| 10 獨立 toolbox session tables + AppShell a11y aria-label toolbox-aware |
| 靖杭 | ✅ | PR #1464 toolbox CTA polish（#1462）| per-tool 完成畫面「重做 + 回到工具箱」共用元件 + 9 個 reading-step 接入 |
| 靖杭 | ✅ | PR #1465 toolbox Phase 2+3（#1463）| 後端 toolbox.py + 前端 toolboxApi.ts + 學習紀錄頁分區，useEffect mount + recordedRef guard 解設計衝突 |
| 啟翔 | ✅ | PR #1480 造句練習 polish | AI 評估語氣軟化（拆 is_correct=true/false 規則）+ amber 配色（badge/border/feedback/paste warning）+ 麥克風 wrapper layout 修正 |
| Young | ✅ | PR #1470 VocabWordSearch（#1469）| 「孤寂感」grid 空白 root cause = L02.yml YAML 含 U+0020 空格；fix L02 + L34 + 前端 .replace defensive guard |
| Young | ✅ | PR #1472 alembic infra（#1471）| preview deploy 容器 exit 255 = stale alembic_version；entrypoint.sh truncate + re-stamp + retry |
| Young | ✅ | PR #1479 parser tools | 5/2 WIP triage：scripts/generate_layer2_thumbnails.py + spotlight _REVIEW.md |
| Young | ✅ | 5 follow-up issues（#1473–#1477）| toolbox tech-debt（POST+PATCH 合併、JSONB DEFAULT '{}'、text_id FK、route order、entrypoint env guard）|
| Young | ✅ | 流程改善 | intern-review label（11 個 ai-qa-passed 標保留實習生眼驗）+ needs-rebase/needs-fix labels |
| Young | ✅ | PR #1482 fix(ai)（#1481）| is_correct=True 時強制 suggestion=""（ai_generation.py L292 一行 defensive fix，#1480 claude-bot L285 finding）|
| Young | ✅ | PR #1485 feat(skill) | meeting-prep skill 首建：4 份文件自動產出 + worktree + PR 到 staging 全流程 |
| Young | ✅ | PR #1487 feat(skill)（#1486）| 泛化 meeting-prep：不假設週五、AskUserQuestion 問日期、DOW_ZH case 支援週一到週日 |
| Young | ✅ | PR #1493 test(mcq-rescue)（#1387）| 28 contract tests for Phase 1 backend：fail-closed 驗證、empty reasoning 偵測、start_session error path、blank resume fallback |
| Young | ✅ | PR #1495 feat(data)（#1398 #1444）| infill 4 missing story_structure YAMLs（G5-L5/G8-L8/G9-L2/文-L10）+ 2 worksheet PDFs（G9-L15-16/G9-L17-19）→ 208/208 coverage |
| 靖杭 | ✅ | PR #1497 fix(csp)（#1496）| SecurityHeadersMiddleware frame-src 加入 `storage.googleapis.com`，解除 GCS PDF popup 被 CSP 封鎖 |
| 靖杭 | ✅ | PR #1498 fix(content)（#1388）| G7-L29/L30 文章重點表從 22 行平文字重構為 5 行結構化填空（主題/觀察/推論/趨勢/反論）+ fill-blanks，2 輪 review 精修 |
| 靖杭 | ✅ | PR #1499 feat(vocab)（#1342）| VocabPractice `practiceMode` prop（3 variants）+ `radicalColorMode` prop，Round 1 outlined+radical colors / Round 2 no-aids，4 輪 @claude review |

---

## 4/18 ~ 4/24

> ⚠️ 本週未開會，僅活動紀錄（見 [2026-04-24-record.md](./2026-04-24-record.md)）

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | PR #1143 Firebase multi-site | prod/staging/dev 分站部署 |
| Young | ✅ | PR #1151/#1213/#1231 Release | 三次 staging → main release |
| Young | ✅ | PR #1199 alembic | 合併 3 個 dangling heads 解封所有 PR deploy |
| Young | ✅ | PR #1200 Junyi SSO | Junyi Academy SSO Part 3（#1198） |
| Young | ✅ | PR #1201/#1202/#1205 SSO 修正 | callback origin + env var + login entry |
| Young | ✅ | PR #1177 TTS 語意切分 | regex → LLM semantic chunking（#1176） |
| Young | ✅ | PR #1209 TTS v2 | Opus segmentation + prompt-only Taiwan style |
| Young | ✅ | PR #1212 TTS 4-state button | loading/playing/idle/error UX（#1210） |
| Young | ✅ | PR #1214 TTS prefetch | char-weighted progress + prefetch（#1211） |
| Young | ✅ | PR #1218 N+1 修復 | 修 6 個 route 的 N+1 query（#1217） |
| Young | ✅ | PR #1221 N+1 regression 測試 | harden coverage |
| Young | ✅ | PR #1226 DB indexes | 熱門查詢欄位加索引（#1223） |
| Young | ✅ | PR #1227 dashboard aggregate | push-down to SQL + cross-text N+1（#1224） |
| Young | ✅ | PR #1228 async TTS | async TTS routes + SQL push-down + heatmap guard（#1225） |
| Young | ✅ | PR #1232 perf 文件 | 4/22~23 backend perf sprint log |
| Young | ✅ | PR #1154 主頁合併 | 主頁+成就合併 + 練習工具箱（#1153） |
| Young | ✅ | PR #1155 閱讀標記右欄 | ReadingAnnotation 右側「我的記號」面板 |
| Young | ✅ | PR #1160 a11y | GamificationHero 對比度（#1159） |
| Young | ✅ | PR #1161 班級 filter | 班級 pill filter on 班級作業頁（#1158） |
| Young | ✅ | PR #1164 sidebar dedupe | 移除重複的成就 sidebar entry（#1163） |
| Young | ✅ | PR #1166 練習工具箱 | 2-column 單課單工具 MVP（#1165） |
| Young | ✅ | PR #1168 student home layout | 空間優化（#1167） |
| Young | ✅ | PR #1171 gradient 修復 | 移除 broken inline style（#1170） |
| Young | ✅ | PR #1173 DESIGN.md | 重寫為 Tactile Scholar palette |
| Young | ✅ | PR #1216 /student polish | 頁面設計打磨（#1215） |
| Young | ✅ | PR #1219 Book Jacket | StudentHome Book Jacket variant |
| Young | ✅ | PR #1229 生字改名 | 字典查詢 card → 我的生字（#1222） |
| Young | ✅ | PR #1157 login dedupe | dedupe login API calls（#1156） |
| Young | ✅ | PR #1242 org scope | 強制 org_admin role checks（#1241） |
| Young | ✅ | PR #1244 TTS auth | TTS endpoints auth guard（#1240） |
| Young | ✅ | PR #1246 dev token gate | reset/verification token 僅 dev 回傳 |
| Young | ✅ | PR #1250 學習歷史修復 | 作業紀錄顯示 + 字太小 + 得分不一致（#1245） |
| 靖杭 | ✅ | PR #1142 Step 2 停止鈕 | 停止鈕修復 + 漏讀偵測 + 句子切分（#1096） |
| 靖杭 | ✅ | PR #1144 跨裝置 session | GET-first + 後端 dedup（#1074） |
| 靖杭 | ✅ | PR #1145 步驟同步 | current_step 與 steps_completed 同步（#1073） |
| 靖杭 | ✅ | PR #1148 句子級重練 UI | 鼓勵語 + tier3 擋關 + 逐句 UI（#1096） |
| 靖杭 | ✅ | PR #1175 無聲音提示 | Step 2 錄音後無聲音主動提示（#1174） |
| 靖杭 | ✅ | PR #1193 unique index | LearningSession partial unique index（#1179） |
| 靖杭 | ✅ | PR #1194 ON DELETE | AssignmentSubmission.session_id ON DELETE SET NULL（#1178） |
| 靖杭 | ✅ | PR #1195 進度版本機制 | step_progress 版本防進度倒退（#1187） |
| 靖杭 | ✅ | PR #1197 beforeunload 修復 | VocabApplication 覆蓋 steps_completed（#1196） |
| 靖杭 | ✅ | PR #1204 造句持久化 | 造句練習完整持久化（#1203） |
| 靖杭 | ✅ | PR #1207 IME Enter | 造句 + 聽寫 Enter 鍵忽略 IME composition（#1206） |
| 靖杭 | 🔧 | PR #1233 Opus 語意切分 | 句子級重練改用 Opus JSONL（#661 refactor） |
| 啟翔 | ✅ | PR #1128 Step 5 部件教學 | 點擊回饋 + 常用字相關字 + moedict 字義（#1099） |
| 啟翔 | ✅ | PR #1130 Step 1 修復 | 閱讀標記選取偏移 + 紅線歪斜 + YAML 空白（#1095） |
| 啟翔 | 🔧 | PR #1141 全域 UX | 點點箭頭 + 分數移除 + 語音輸入共用（#1094）— review 中 |

---

## 4/11 ~ 4/17

| 人 | 狀態 | Issue / 項目 | 做了什麼 |
|----|------|-------------|---------|
| Young | ✅ | PR #1068 Bridge 三步驟 | 錯誤處理蘇格拉底 prompt 升級（#1064） |
| Young | ✅ | PR #1069 overall_score | session completion 計算 overall_score（#1063，修永遠 null bug） |
| Young | ✅ | PR #1082/#1083 重點表互動化 | 填空 + 勾選 + AI 批改（beta roadmap 額外完成） |
| Young | ✅ | PR #1084 選字偏移 | ReadingAnnotation 注音 PUA selector 位移修復 |
| Young | ✅ | PR #1077~#1080 Claude 審查 | PR auto-review + @claude trigger + REVIEW.md + inline comments |
| Young | ✅ | Pitch 簡報 | 5/1 會議用 3+1 頁 pitch |
| Young | ✅ | 學習單 matrix | 57 篇課文 vs 平台功能對照表 + 文言文欄位整併 |
| Young | ✅ | Staging QA | #1082 重點表、#909 進步曲線、#1076 句子重練全驗證 |
| Young | ✅ | PR #1088~#1091 follow-up | CORS warmup、mobile top bar 截斷、admin redirect race、LiveTutor scroll |
| Young | ✅ | PR #1092/#1093 AR cleanup | AR cleanup 卡 1h+ 根因修復（soft deadline） |
| Young | ✅ | 4/17 Staging QA | desktop + mobile 全掃，9 PR 驗證，health 90/100 |
| 靖杭 | ✅ | PR #1075 Self-practice | 完成狀態持久化到後端（fix #1070） |
| 靖杭 | ✅ | PR #1076 句子重練 | 逐段朗讀支援句子級重練（feat #661，方大哥長期項） |
| 靖杭 | ✅ | PR #1085 跨裝置 | Self-practice 跨裝置紀錄修復（fix #1071，4/17 merged） |
| 靖杭 | ✅ | PR #1086 Debounce | Step 進度 debounce 5 秒修復（fix #1072，4 輪 review，4/17 merged） |
| 靖杭 | 🔧 | 5 個 bug issue | 建 #1070~#1074 進度同步系列（#1070/#1071/#1072 已解，#1073/#1074 進行中） |
| 啟翔 | ✅ | PR #1087 沈浸式學習 | 前端 50 files 大改 + 字體改黑體（feat #1081，4/17 Young 解 conflict 後 merged） |
| 啟翔 | ⛔ | P1 data integrity 停滯 | #984/#985/#982 連續 8+ 天未更新（beta blocker，後 Young 4/18 接手） |

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
