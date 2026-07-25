# CLAUDE.md - 國語文閱讀學習平台 (LingoLeap)

## 專案背景

國語文閱讀學習平台 — 協助國小教師與學生的 AI 閱讀教學工具。
前端 React 19 + Vite + Tailwind，後端 FastAPI + PostgreSQL + SQLAlchemy，部署於 GCP Cloud Run。

**團隊**：Young (lead dev) + 方大哥/Shinjou (product owner) + 高中生實習團隊
**用戶**：國小高年級～國中生 + 教師


## Session 啟動必讀

- `docs/PRD.md` — 產品需求文檔
- `docs/BRD.md` — 商業需求文檔
- `docs/PLATFORM_VISION_FANG.md` — 方大哥的產品構想
- `private/STRATEGY.md` — Young 的策略背景（gitignored）

## 技術架構

```
Frontend (React 19 + Vite + Tailwind)  →  Cloud Run (lingoleap-frontend)
  └── API calls via VITE_API_URL
Backend (FastAPI + SQLAlchemy)          →  Cloud Run (lingoleap-backend)
  ├── PostgreSQL (Cloud SQL: lingoleap-db)
  ├── Vertex AI Gemini (service account auth, 不需 API key)
  └── Redis (選用)
```

## GCP 部署資訊

### gcloud config

```bash
gcloud config configurations activate lingoleap
```

| 設定 | 值 |
|------|-----|
| Config name | `lingoleap` |
| Account | `youngtsai@junyiacademy.org` |
| Project | `lingoleap-dev` |
| Region | `asia-east1` |
| Billing | `junyiacademy - cacafly - 1` (014FD4-0E02D2-824649) |

### 服務 URL

| 元件 | URL |
|------|-----|
| Frontend (Cloud Run, **prod**) | `https://lingoleap-frontend-958347263320.asia-east1.run.app` |
| Frontend (Firebase, **prod**) | `https://lingoleap-prod.web.app` |
| Frontend (Firebase, **dev/staging**) | `https://lingoleap-dev.web.app` |
| Backend API | `https://lingoleap-backend-958347263320.asia-east1.run.app` |
| Cloud SQL | `lingoleap-db` (PostgreSQL 15, asia-east1, db-f1-micro) |
| Artifact Registry | `asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/` |

### Git Branch Strategy

```
feature/*  ──PR──>  staging  ──PR──>  main
    │                  │                │
    ▼                  ▼                ▼
PR Preview          Staging         Production
(ephemeral)       (persistent)     (persistent)
```

| Branch | Environment | Auto-Deploy | Trigger |
|--------|-------------|-------------|---------|
| main | Production | Yes | push to main |
| staging | Staging | Yes | push to staging |
| feature/* | PR Preview | Yes | PR opened/updated |

#### Workflow

1. Create feature branch from `staging`
2. Develop and test locally
3. Open PR to `staging` (auto-deploys preview)
4. Test on preview URL (posted as PR comment)
5. Merge to `staging` for team testing
6. Create PR from `staging` to `main`
7. Merge to `main` for production release

#### Environment URLs

| Environment | Frontend | Backend |
|-------------|----------|---------|
| Production | `lingoleap-frontend-xxx.run.app` | `lingoleap-backend-xxx.run.app` |
| Staging | `lingoleap-frontend-staging-xxx.run.app` | `lingoleap-backend-staging-xxx.run.app` |
| PR Preview | `lingoleap-frontend-pr-{N}-xxx.run.app` | `lingoleap-backend-pr-{N}-xxx.run.app` |

### CI/CD

| Workflow | Trigger | Deploys |
|----------|---------|---------|
| `deploy.yml` | Push to `main` | Production (backend + frontend) |
| `staging-deploy.yml` | Push to `staging` | Staging (backend + frontend) |
| `preview-deploy.yml` | PR opened/updated/closed | PR Preview (ephemeral, auto-cleanup) |

- `backend/**` 變更 → rebuild + deploy backend
- `frontend/**` 變更 → rebuild + deploy frontend
- Secret: `GCP_SA_KEY` (service account for CI/CD)

### Artifact Registry Image Cleanup（4 層防護）

| 層級 | 機制 | 觸發時機 | 策略 |
|------|------|---------|------|
| Layer 1 | GCP cleanup-policy | 自動（背景） | untagged >7天刪除 + tagged 保留最新10個 |
| Layer 2 | `deploy.yml` | push main | `prod-*` images 保留最新 3 個 |
| Layer 3 | `staging-deploy.yml` | push staging | `staging-*` images 保留最新 3 個 |
| Layer 4 | `preview-deploy.yml` | PR closed | `issue-N-*` images 全部刪除 |

### 手動部署

```bash
# Backend
gcloud builds submit --tag asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/backend:vX.Y.Z --project lingoleap-dev ./backend
gcloud run deploy lingoleap-backend --image asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/backend:vX.Y.Z --platform managed --region asia-east1 --project lingoleap-dev

# Frontend
gcloud builds submit --tag asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/frontend:vX.Y.Z --project lingoleap-dev ./frontend
gcloud run deploy lingoleap-frontend --image asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/frontend:vX.Y.Z --platform managed --region asia-east1 --project lingoleap-dev --port 8080
```

### 環境變數

Cloud Run env vars 管理，**不要 commit secrets 到 git**。
- `DATABASE_URL` — Cloud SQL Unix socket 連線
- `ALLOWED_ORIGINS` — CORS 白名單
- AI 呼叫走 Vertex AI（service account 自動驗證）

## 開發指南

```bash
# 本地開發
cd frontend && npm install && npm run dev    # localhost:3000
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload  # localhost:8000
```

## QA / 測試登入（重要 — 不要再說「卡登入牆/要帳號」）

**`/login` 頁面直接有一鍵登入按鈕（懶人登入），QA 完全不需要真帳號或密碼。**
⚠️ 僅 **staging / preview** 有 demo 登入鈕（`VITE_SHOW_DEMO_LOGIN=true`）；**production 已停用**（`deploy.yml` 設 `VITE_SHOW_DEMO_LOGIN=false`，按鈕 tree-shake 掉，verified 2026-07-02）。所以 QA 用 **staging** 一鍵登入，別在 prod /login 找 demo 鈕：

| 按鈕 | 角色 | 用途 |
|------|------|------|
| 管理員 王管理員 | admin | 後台 / 稽核頁 QA |
| 教師 李老師 | teacher | 班級 / 派作業 / 老師端 QA |
| **學生 小明** | student | **學習流程（7 步驟）QA — 預設用這顆** |

**QA 學習步驟 SOP（headless browse）**：先 `goto {base}/login` → `snapshot -i` 拿最新 ref → click 對應角色鈕 → 等 redirect 完成（驗 `js "location.href"` 不再是 /login）→ 再 `goto {base}/learn/{id}/{step}`。
⚠️ browse 的 `@eN` ref 是當下 snapshot 的，導頁/重抓後會失效 → **click 前一定重新 snapshot**。
⚠️ `/learn/*` 未登入會 redirect `/login` — 看到 redirect = 還沒登入成功，不是「需要帳號」。

## 覆寫規則（防止反覆 bug）

14 天內同類 bug 反覆出現，以下規則強制執行：

| 情況 | 正確做法 | Skill |
|------|---------|-------|
| 新增或修改 `backend/app/models/*.py` | **先跑 `sqlalchemy-model-safety` checklist**（FK index / cascade / timestamps / alembic heads / idempotent DDL）；PostToolUse hook 會自動提醒 | `~/.claude/skills/sqlalchemy-model-safety/` |
| 新增或修改有 LLM import 的 `backend/app/routes/*.py` | **先跑 `llm-endpoint-hardening` checklist**（rate-limit-after-cache / auth / input cap / fail-closed / reasoning field）；PostToolUse hook 會自動提醒 | `~/.claude/skills/llm-endpoint-hardening/` |
| 新增 `backend/alembic/versions/*.py` migration | **先確認 `alembic heads` = 1**；PostToolUse hook 會自動執行 `alembic heads` 並在 multi-head 時 WARN | `~/.claude/skills/postgres-best-practices/` |
| 改 frontend render 檔（`*.tsx`）| **PR 前必跑 `/qa` 驗那頁**（console 乾淨 + 截圖），禁用 code-read 當 verified；`npm run lint + npm run test` render-smoke/eslint gate 自動擋 mount crash（#2279 TDZ postmortem）| `.claude/skills/ui-pr-verify/SKILL.md` |
| 改**聚光燈 / 重點表內容或抽取器**（`catalog/*` / `_online-schema/*` / `_parsed*/*` / `build_lesson_schema.py` / `keypoints_manifest.json` / spotlight / story_structure）| **PR 前必跑 content evidence gate + ship-gate（fail-closed）**：`python scripts/content_evidence_gate.py --run-id <id>` → `bash scripts/content_evidence_ship_gate.sh --run-id <id>`，必須印 `CONTENT_EVIDENCE_GATE=PASS`。⛔ 禁用「API 回 200 / render 看一下 / 我覺得對了」當完成依據——口頭宣稱過不了 gate，只認 evidence 檔（fail_cells=0 + unknown_cells=0）。真內容缺口登錄 `backend/data/curriculum_qa/content_known_gaps.yaml`（known_gap，誠實標、非造假），**禁把缺口 fake 成 pass**。| `.claude/skills/build-keypoints/` `.claude/skills/build-spotlight/` + `docs/qa/layer-verification-framework.md` |

> 相關 PostToolUse hooks 已在 `~/.claude/settings.json` 全域註冊（#1273）。

## Modular Spec System (`specs/`) — #2029

改 backend code / lesson 資料前，**先查該段是否被某個 spec module 擁有**：

1. 讀 `specs/registry.yaml`（小，所有 module 的 `owns_code` / `owns_data` 索引）
2. 要動的檔案落在某 module → 讀該 `specs/modules/<feature>/INTENT.md`（人讀 SOT）+ 需要時 `backend/specs/test_<feature>_spec.py`（機器契約）
3. **Content / learning module**（聚光燈、重點表、未來 DOCX 流程）→ 另讀 **`docs/qa/layer-verification-framework.md`** + INTENT 內 **L-layer 對照表**；merge 前跑 module ship gate（見框架 §5–§6）
4. 改完跑 **`bash specs/run-ci.sh`**（= local CI：registry 新鮮度 + 全部契約）。契約 fail = code/data 偏離意圖（修 code 或更新 spec，二擇一）。快檢只跑 registry：`bash specs/run-ci.sh --quick`
5. 沒對應 module 又是新 feature → 先建 `specs/modules/<feature>/INTENT.md` 再寫 code，並跑 `python specs/build_registry.py` 重建索引

目前 **27 個 module**（OMO / 朗讀理解 / 計分 / 教材 / auth / 學習功能 / AI infra…）。完整索引 `specs/registry.yaml`，說明 `specs/README.md`。
**Local CI**：GH Actions 自動跑卡在 workflow token（issue 2041），在那之前 push 前一律手動 `bash specs/run-ci.sh`（最近一次本機全綠：457 passed / 31 xfailed）。

## LLM Model 比較與更換流程

**換 model（新 Gemini 版本 / Claude / GPT 等）前，必跑系統性 A/B**。SOT: `docs/ai/llm-model-ab-2026-05.md`。

### 現用 model 配置（`backend/app/services/llm_models.py` TASK_MODELS）

| Task | Model | Region | 鎖定原因 |
|------|-------|--------|---------|
| 8 個 text/JSON tasks（socratic / comprehension / vocab / reading / story / exit_ticket / sentence_validate / teacher_comment）| `gemini-2.5-flash-lite` | global | 4-way A/B：quality tie, cost -78% (#1744) |
| `omo_identifier` | `gemini-flash-lite-latest` (=3.1 Lite) | global | Fair A/B conf 0.973 vs 0.934 (#1729) |
| **`omo_grader`** | **`gemini-2.5-flash`** | **us-central1** | **LOCKED — lettered circle 5/5 vs 1/5 spatial (#1730)** |

### 比較維度 checklist（換 model 前測這些）

**P0 必測**：
- Latency (p50 / p95 / TTFT)
- Cost per call（用 `usage_metadata` × PRICING 算）
- Schema validity（JSON parse + required fields）
- Output completeness（length + finish_reason — 抓 MAX_TOKENS 截斷）
- Domain accuracy（grader 對錯 / identifier hit / classifier label）
- Fabrication rate（OMO 特有）
- OCR accuracy（vision — 中文手寫字）
- Spatial reasoning（vision — lettered circle / boxed answer 位置定位）

**P1 該測**：
- 繁體中文 fluency
- 教學引導性（pedagogical — warm tone / scaffolded）
- Output length / verbosity
- Determinism / variance（同 prompt N 次差異）
- Cold start vs warm
- Region latency delta

### Config fairness（之前漏的，必設）

- ⚠️ **Thinking control API differs per model family** (per Codex fact-check 2026-05-20, [Gemini thinking docs](https://ai.google.dev/gemini-api/docs/thinking)):
  - Gemini **2.5 series** → `thinking_config=ThinkingConfig(thinking_budget=0)` 才能 disable thinking
  - Gemini **3.5+ series** → `thinking_config=ThinkingConfig(thinking_level="minimal")` (default `"medium"`); `thinking_budget=0` 對 3.5+ 系列**無效**，reasoning tokens 仍計費 + 仍 consume budget → A/B 不公平
  - 加新 3.5+ / 4.0 model 進 A/B 時必須切對 API，不然測完結論不可信
- ⚠️ Models 不同 region 時標 location bias
- Shuffle model 順序避免 cold start bias
- 同 `max_output_tokens` / `temperature` per task
- 多 sample（≥3，quality-critical 用 5+）

### 既有測試 scripts（可直接改參數重跑）

```
private/omo-real-samples/2026-05-20-systematic-ab/
├── run_ab_test.py             # 8-task text/JSON A/B 框架（call_text + call_json）
├── inventory.md               # 所有 LLM call sites 清單
└── (per-task JSON outputs)

private/omo-real-samples/2026-05-20-grader-ab/
├── run_grader_ab.py           # OMO grader vision A/B 框架
└── summary.md                 # spatial reasoning verdict

private/omo-real-samples/2026-05-18-batch-results/
├── eval_3_1_lite.py           # 快速 6-test A/B（小範圍）
├── run_omo_batch.py           # 16-page identifier batch
├── fair_identifier_rerun.py   # Identifier fair re-run（post #1738）
└── fair_socratic_rerun.py     # socratic fair re-run（post #1738）
```

### 換 model SOP

1. 開新 issue 列要測的 model + tasks
2. Copy 既有 `run_ab_test.py` → 新 model column 加進去（一律設 `thinking_budget=0`）
3. 跑 24-48 calls，budget ≤ $0.10
4. 更新 `docs/ai/llm-model-ab-2026-05.md` 加新 column / decision deltas
5. 如有 winner flip → 改 `llm_models.py` TASK_MODELS dict（不要 hardcode model string 在 service file）
6. PR + 6-point QA（health / revision / per-task model verify / OMO grader 不變 / pytest / staging API）

### 反模式（不要做）

- ❌ 比一兩個 sample 就下結論（quality 有 variance）
- ❌ 沒設 `thinking_budget=0` 就比 quality（2.5 系列會偷吃 token）
- ❌ Hardcode model string 在 service file（用 `get_model_for_task("xxx")`）
- ❌ 用「貴 = 好」邏輯（3.5 Flash $9 完敗 2.5-flash-lite $0.30）
- ❌ Skip 便宜的 model（之前漏測 2.5-flash-lite 差點省不到 78%）

## 學習流程（7 步驟，StepperNav 定義）

1. **簡介** — 課文背景介紹（Intro）
2. **逐段朗讀** — AI 即時朗讀指導（LiveTutor）
3. **課文理解** — 蘇格拉底式 AI 對話（ComprehensionChat）
4. **生字練習** — 筆順練習 + 注音（VocabPractice + WriteCharacter）
5. **聽寫練習** — AI 唸字學生打字（DictationPractice）
6. **全文朗讀** — 完整朗讀評估（FullReading）
7. **報告** — 朗朗上口六環節診斷報告（AssessmentReport）

### 其他練習元件（未在主流程 stepper 中）
- **SentencePractice** — AI 引導造句
- **ListeningPractice** — 聽力理解（TTS + AI 評估）
- **PronunciationPractice** — 發音練習
- **ExitTicket** — 學習出場券

## 關鍵檔案

| 檔案 | 說明 |
|------|------|
| `frontend/src/App.tsx` | 主路由 + 步驟導航 + LearningSession state |
| `frontend/src/components/reading-steps/` | 8 步驟元件 |
| `frontend/src/components/reading-steps/AssessmentReport.tsx` | 朗朗上口六環節診斷報告 |
| `frontend/src/components/ui/DiffDisplay.tsx` | LCS 文字差異比對顯示（#80） |
| `frontend/src/components/stroke-order/` | 筆順練習 |
| `frontend/src/components/zhuyin/` | 注音處理 |
| `frontend/src/services/api.ts` | API 呼叫層（含 SessionExpiredError 自動重建） |
| `backend/app/main.py` | FastAPI 入口 |
| `backend/app/services/ai_service.py` | Vertex AI Gemini 呼叫（gemini-2.5-flash, us-central1） |
| `backend/app/services/socratic_agent.py` | 蘇格拉底對話 agent（5 題 3 階段 + circuit breaker） |
| `backend/app/services/gamification_service.py` | 遊戲化系統（XP/成就/連續登入） |
| `backend/app/models/` | DB Schema（User, UserRole, Organization, School, Classroom, LearningSession, Assignment, Gamification, ParentLink, StudentTag, Feedback） |
| `backend/app/services/prediction_service.py` | 預測學習困難（規則引擎） |
| `backend/app/services/cross_text_analysis_service.py` | 跨課文學習模式分析 |
| `backend/app/services/listening_service.py` | 聽力理解評估 |
| `backend/app/services/learning_path_service.py` | AI 個別化學習路徑推薦 |
| `backend/app/services/dictionary_service.py` | 字典查詢服務 |
| `backend/app/services/input_sanitizer.py` | 輸入消毒 |
| `backend/app/routes/` | API 路由（140+ endpoints：auth, classrooms, assignments, learning, teacher, gamification, parents, dictionary, feedback, jobs, privacy） |
| `backend/data/curriculum/` | 現行課程 SOT（**158 課** + `manifest.yml` 158 entries，verified 2026-07-02） |
| `backend/data/lessons/` | legacy 課文 YAML 來源檔（57 篇，舊；現行看 `data/curriculum/`） |

## 簡報資料（公開，不需登入）

| 文件 | URL |
|------|-----|
| 教授簡介（3 分鐘版） | https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/presentation/short.html |
| 完整平台說明書 | https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/presentation/full.html |
| 閱讀理解技能樹研究 | https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/presentation/research.html |

## 參考專案

方大哥的原始實作：`github.com/Shinjou/lingoleap-ai-reading-tutor`（唯讀參考，不修改）

## 架構地圖（graphify）

`graphify-out/graph.json`（gitignored，本地）— 問「架構/誰呼叫誰/改這會動到誰/資料流」時**優先讀圖**（`/graphify query "..."` 或直接讀 JSON），不要冷 grep 全 repo
code 大改後重建：`graphify . --update`｜批次腳本：job repo `scripts/build-repo-graphs.sh`
