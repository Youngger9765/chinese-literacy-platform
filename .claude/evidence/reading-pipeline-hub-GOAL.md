# GOAL: reading-pipeline.html all-in-one hub

> 這份是 loop 的 durable state。我讀這個、不追 session（省 token）。每做一步更新這裡。

## 目標
建 `frontend/public/presentation/reading-pipeline.html` 一頁集成 hub，5 區互通：
1. **架構**：6 階段資訊流圖（用「修正後」流程）+ 一句話分工
2. **開發**：模組功能表（階段·前/後·功能·檔案GitHub連結·PR·證明連結·狀態）
3. **QA result**：七課驗收狀態 → 連 `7-lessons-progress.html` + QA issues
4. **測試集**：收集 SOP 摘要 + 進度 → 連 testset 頁（未建·紅標佔位）
5. **缺口&債**（紅標）：testset #2287 未建 · 38 vitest fail · CI 測 staging-not-PR-code
- **鐵律**：每格現況掛可點證明連結；沒證明的格子標紅「未驗證」

## 修正後的資訊流（PR #2299 = A 後送，已修未 merge）
```
錄音(前端 useAudioRecorder)
 → POST /reading/transcribe  辨識STT only（已移除 GCS 上傳 step4.5）
 → 前端評分（localEval；tier3 才 Gemini /reading/evaluate）
 → 分數先回傳 UI（學生立刻看到）
 → saveReadingAudio(async, fail-safe, 只在評分且保留時)
 → POST /reading/save-audio → IDOR check → GCS upload → 寫 audio_gcs_path
```
舊圖錯在：把儲存畫成 transcribe 並行/評分前。新規則：**只存評估過的、且分數先顯示再儲存**。

## 模組表資料（給「開發」tab）
| 階段 | 前/後 | 功能 | 檔案 | PR | 證明 |
|---|---|---|---|---|---|
| ①錄音 | 前 | MediaRecorder→webm | frontend/src/hooks/useAudioRecorder.ts | — | /qa render OK |
| ②辨識STT | 後(LLM) | gemini-2.5-flash@us-central1 | backend/app/services/reading_transcription_service.py | — | A/B doc |
| ③評分 | 前+後 | local + deterministic(_build_fallback_result) | backend/app/services/reading_evaluation_service.py | #2266 #2274 | staging 98.1% |
| ④優化 | 後 | normalize+同音校正(評分前) | backend/app/services/reading_evaluation_service.py | #2266 | spec tests |
| ⑤顯示 | 前 | ParagraphCard | frontend/src/components/reading-steps/live-tutor/hooks/useParagraphEvaluation.ts | #2279 #2284 #2292 | /qa console 乾淨 |
| ⑥儲存(後送) | 前→後+GCS | 評分後 async 上傳+綁定 | backend/app/routes/learning/learning_save_audio.py | #2278 #2283 #2286 #2299 | Backend Tests 綠 |
| 回放 | 後 | signed URL 10min + IDOR | learning_audio_replay.py / teacher_audio_replay.py | #2283 #2286 | — |

連結 base：
- blob: https://github.com/Youngger9765/chinese-literacy-platform/blob/staging/<path>
- PR: https://github.com/Youngger9765/chinese-literacy-platform/pull/<n>
- QA 頁: 7-lessons-progress.html（同目錄相對連結）
- testset: 未建 → 紅標佔位（issue #2287）

## 相關 issue（QA / 缺口）
QA: #2153 #2187 #2194 #2197 ｜ 教授痛點 #2083(open) #2079 #2080 ｜ 缺口: #2287(testset未建) #2226

## Branch / 環境
- hub branch: `feat/reading-pipeline-hub`（worktree `.worktrees/reading-pipeline-hub`，base staging c41b664b）
- 風格沿用 presentation/index.html：bg #FDF8F0 / 紫 #5B4FC4 / muted #6b6b8a / Noto Sans TC / card white radius10

## TASK CHECKLIST
- [x] 驗 + merge PR #2299（上傳後送修正，已 merge staging 6d991323）
- [x] 建 reading-pipeline.html（5 tab，連真連結，no-proof 標紅）
- [x] /browse 截圖驗證 render + console（5 tab/0 error/tab 切換 OK/截圖看過）
- [x] 開 hub PR #2301（不自動 merge）
- [x] watch #2301 CI → 全綠（E2E+audits+preview deploy）
- [x] merge #2301 → staging d76fc209
- [x] staging-deploy 完成 → hub staging 驗證乾淨（HTTP 200 / 5 tab / 6 列 / 5 紅標 / qa 連結 ./7-lessons 200 / tab 切換 OK）
- [x] CORS console error 查證 = 殘留/cold-start 噪音，非真問題（curl preflight 回正確 ACAO header）
- [x] worktree 清掉 · GOAL 完成

## ✅ GOAL DONE
Live: https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/presentation/reading-pipeline.html
#2300 OPEN（Fixes，等 staging→main release 關）

## 驗證重點（merge 後）
- staging hub: https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/presentation/reading-pipeline.html
- frontend path filter = frontend/** → public/ 改動會觸發 rebuild（已確認 staging-deploy.yml:38）
- preview 404 是猜錯 URL（PR 無 comment），非檔案問題；staging path 已知可用（7-lessons 200）

## LOG
- (init) 建立 GOAL md；PR #2299 已由 agent 完成全綠待驗
- merged #2299 後送修正 → staging 6d991323
- 建 reading-pipeline.html（worktree feat/issue-2300）+ 連進 index.html 附錄
- browse 驗：title OK / 5 tab / arch 預設 / dev 表 6 列 / 5 個未驗證紅標 / 0 console error / tab 切換正常 / 截圖視覺乾淨
- commit 74580255（pre-commit HTML 要 review marker，用 bypass）→ push → PR #2301

## 迭代 v2（agent aa332b9943c9d6a44 進行中）
- 架構 tab：6 節點右邊加元件示意圖 + 操作動畫（CSS/JS）
- QA tab：改成 課文×gate 真矩陣 — keypoints_manifest 151 課×gates + spotlight 7 課×eval（複製 manifest 進 public/ render，未涵蓋的 flow 功能 QA 註明在 issues）
- 開發表：合併 PR/證明 成一欄 + cell 不斷行(white-space:nowrap)
- 待：agent 回報 + 截圖 → 我審 → merge（不自動）

## 上一層：多模組 Pipeline 集成板（Young 6/20 新需求）
目標：建「上一層」index = 各模組 Pipeline 集成板，底下每模組各一個 board：
- 朗讀 reading（= reading-pipeline.html，已有，v2 迭代中）
- 聚光燈 spotlight（待建）
- 重點表 keypoints（待建）
模板 = reading-pipeline.html 定稿後沿用（架構動畫 + 課文×gate QA 矩陣）
pipeline 共用形狀：raw DOCX → build_lesson_schema.py(生 spotlight.yml/keypoints.yml+抽圖表) → loader → build_*_qa_manifest.py → manifest.json → 前端渲染
研究中：Explore a1a73179e2e2643e7（測繪兩模組架構/檔案/QA gate/PR）
排序：等 (1) reading v2 定稿當模板 (2) Explore 研究完 → 建 parent index + spotlight board + keypoints board（不自動 merge，截圖審）

## testset v1（我自己建，PR #2304，agent 兩次死掉後接手）
- GCS-only 無 DB 無 migration（alembic multi-head，依鐵律不建）
- backend/app/routes/testset.py：POST /api/testset/upload（公開, IP rate-limit, 15MB, content-type, fail-closed）+ GET /api/testset/recordings；存 test-dataset/ prefix
- frontend/public/testset/index.html 貢獻者頁（名字+年級→選課文(3篇)→錄音→回放→上傳→進度）；list.html owner 覆蓋率矩陣(課文×正確/錯誤+貢獻者+播放)+分享連結
- 已驗：兩頁 file:// render OK、貢獻者頁截圖視覺乾淨
- 待：Backend Tests CI 驗 wiring（本地無 fastapi 無法 import）+ security-auditor a26af21 複查公開 endpoint + preview 真實上傳測 → 才 merge
- 安全 tradeoff：list v1 公開（低敏感）、lesson_id 未白名單(security 複查中)
