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
- CI/CD 用的 service account 憑證存在 GitHub secret，名稱 `GCP_SA_KEY`
  <!-- 不寫成 `Secret: <名稱>` —— 那個形狀會被 pre-commit 的 generic_secret 偵測器
       當成「secret 後面跟著一個值」而擋下 commit。這裡只有名稱，沒有值。 -->

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

## 會議議程 / 會議記錄 → 一律進 repo，不開 issue（Young 2026-08-21 明令）

要開會 → **議程必須在 GitHub 上有一個穩定的檔案 URL**，發給與會者的就是那個連結。

| 做 | 不做 |
|---|---|
| 寫進 `docs/meetings/YYYY-MM-DD-agenda.md`（會後紀錄用 `-record.md`） | ⛔ 開成 GitHub issue |
| commit + push，把 GitHub 上的檔案連結發給與會者 | ⛔ 只寫在對話裡、只留本機不推 |

**為什麼不用 issue**：議程開成票會混進待辦票流，跟真正的工作票搶注意力；
而開會當下需要一個穩定可讀的 URL，票裡的內容會被留言洗掉。

**物理擋**：`~/.claude/hooks/pre-bash-meeting-agenda-to-repo-guard.sh`
（PreToolUse/Bash；只認命令位置、會先剝掉 heredoc 內文，所以「寫文件說明這條規則」不會被誤擋）
golden set：`~/.claude/hooks/tests/meeting-agenda-to-repo-guard.eval.sh`（12 case，兩種 mutation 都驗過會紅）

> 起因：2026-08-21 我把當晚議程開成票 #2827 → 「誰叫你開 issue?????? meeting呢？？？」，
> 同日再一次「會議就要開 agenda to github 知道嗎？？？」。規則層講兩次還犯，所以上 hook。

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

## 學習流程

> ⛔ **這裡的步驟名稱只是導覽用。真相 SOT 是 `frontend/src/config/stepConfig.ts`**——
> 每個 step 上方都有決策註解寫明「為什麼、何時改的」，**那些註解才是答案，不是 label 字串**。
> 想知道某個 step 現在是什麼、還在不在用，讀那個檔並**讀完該段註解**。

### 朗讀相關的三個名稱（最容易搞混，2026-08-08 我就搞混過）

| step id | 現在的 label | 狀態 | 是什麼 |
|---|---|---|---|
| `lesson-intro` | 課程簡介 | ✅ 啟用 | AI 唸**全文**（#2607 從瀏覽器機器音改成 Gemini/Azure 人聲）|
| `key-passage-reading` | **重點朗讀** | ✅ 啟用 | 唸老師 ☞ 標的**重點段**（念順順），資料在 `key_reading.passage`；無資料時 fallback 唸全文 |
| `paragraph-reading` | 逐段朗讀 | ⛔ **`enabled: false`** | 2026-07-20 專家審查後從 StepperNav 隱藏（ToolPicker 仍可進）。**新功能不要連到它** |

⚠️ **這張表以前寫的是 `intro` / `full-reading` / `tutor`** —— 那三個是
`LEGACY_STEP_ID_ALIASES`（stepConfig.ts:462）裡的**舊別名**，`resolveStepId()` 仍然解得開，
所以照著寫「會動」，只是寫的人建在別名上而不是正式 id。新東西一律用左欄那三個。
完整別名對照在那個 map 裡（另有 `reading-annotation`→`full-text-annotate`、
`story-structure`→`keypoints-table`、`vocab`→`character-practice` 等）。

2026-07-20 專家審查定調：朗讀**只練老師指定的那一段**，**不練全文**，
範圍 = **☞ 落在的那一段 → 右緣最後一個累計數字落在的那一段，兩端之間全包**（常常剛好一段）。
⚠️ 這裡以前寫「約 300–400 字」——那個數字是**右緣累計字數欄**的量級，那一欄量的是「一分鐘能讀到哪」，不是範圍長度。「從 ☞ 累積到字數欄 max」這條規則已經被否決四次，每次都是有人拿那個數字當範圍。
主指標是流暢率（每分鐘字數）而非逐字正確率。做法是把既有 `full-reading` step **改造**成重點朗讀
並**保留 step id**（新增 step 會讓完成記錄寫錯 step → 作業無法提交）。

### 其他練習元件（未在主流程 stepper 中）
- **SentencePractice** — AI 引導造句
- **ListeningPractice** — 聽力理解（TTS + AI 評估）
- **PronunciationPractice** — 發音練習
- **ExitTicket** — 學習出場券

## TTS（2026-08-08 全面切到 Azure）

| 項目 | 現值 | 備註 |
|---|---|---|
| provider | **`azure`** | prod / staging / preview 三個環境一致 |
| voice | `zh-TW-HsiaoChenNeural` | 192kbps 48kHz |
| fallback | Google `cmn-CN-Chirp3-HD-Sulafat` | ⚠️ **中國腔**，2026-04 盲聽已否決 |
| GCS bucket | `lingoleap-tts-cache` | prefix：`azure/sentences/` 6356 · `gemini31-prompt-only-v2/sentences/` 1418 · `tts-cache/` 10 |
| 快取 key | `sha256(raw_text.strip())` | **不含 provider 或 voice**，prefix 是唯一區隔 |

⚠️ **判斷現在跑哪個 provider 一律查 serving revision 的 env**，不要讀文件——
2026-08-08 之前所有文件都寫「Gemini 是 primary」，切換後那些全錯。

```bash
gcloud run services describe lingoleap-backend --region asia-east1 --project lingoleap-dev \
  --format='value(status.traffic)'          # 找 percent 100 那筆的 revisionName
gcloud run revisions describe <該 revision> --region asia-east1 --project lingoleap-dev \
  --format='json(spec.containers[0].env)'   # 看它的 TTS_PROVIDER
```

### 三個 TTS 地雷

1. **有聲音 ≠ AI 朗讀成功**。`frontend/src/hooks/useTtsPlayback.ts` 約 201 行在後端失敗時
   **靜默降級成瀏覽器機器音**，聽起來「有聲音」但不是 AI。驗證要看 network 回應大小
   （Azure 約 177–197KB，瀏覽器語音沒有網路請求）。
2. **Azure 拒收 `<phoneme>`**。四種 alphabet（zhuyin/sapi/ipa/ups）全部 HTTP 400。
   多音字校正要用 `<sub alias="X">Y</sub>`。
3. **fallback 會把中國腔永久寫進快取**。azure prefix miss 時讀取路徑會回讀 `tts-cache/`
   （`tts/__init__.py` 約 281–285 行），所以一次短暫失敗就把該句永久釘在中國腔，
   Azure 恢復也救不回。詳見 `specs/modules/tts/INTENT.md`。

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
| `backend/data/curriculum/` | 課程來源檔（`manifest.yml` 158 entries）⚠️ **不是服務端真相**，見下方 |
| `backend/data/lessons/` | legacy 課文 YAML 來源檔（57 篇，舊） |
| `backend/data/key_reading_passages.yml` | 重點朗讀（念順順）段落 SOT，by lesson code（`G4-L01`）；134 條有 passage，其中 32 條對不到 DB 任一課（孤兒，待清） |

### ⚠️ 課程清單的真相是 uid tree 檔案，不是 DB、也不是 manifest（2026-08-18 verified）

⚠️ **這一段 2026-08-08 寫的是「真相在 DB」，二修 re-ink（#2683/#2736）之後已不成立。**
`/api/stories` 的 handler（`backend/app/routes/stories.py:382 list_stories`）**沒有 DB
session**，它呼叫 `search_lessons()`，而那支的註解就寫著 `All in-memory, no DB` ——
資料來自 `build_all_lessons()` → `backend/data/lessons/<lesson_uid>/<version_id>/`。

```
backend/data/lessons/L*/v3/                  175 課     ← 服務端真相
backend/data/curriculum/manifest.yml         158 筆     ← 一修遺留，已不是服務來源
```

要「所有課程」仍然一律走 API（別 grep `manifest.yml`，它少 17 課）：

```bash
curl -s "$BACKEND/api/stories?page_size=300" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['stories']), d['total'])"
```

⚠️ 分頁參數是 **`page_size`**（預設 60，上限 300），**不是 `limit`**。傳 `limit=500` 會被
**靜默忽略**只回 60 筆，看起來像全部。**斷言拿到的筆數等於回應的 `total`**，否則就是沒拿全。

（2026-08-08 我因此把「60 課 / 47 有重點段」當成全體回報，實際是全體 175 課。）

## 簡報資料（公開，不需登入）

| 文件 | URL |
|------|-----|
| 教授簡介（3 分鐘版） | https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/presentation/short.html |
| 完整平台說明書 | https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/presentation/full.html |
| 閱讀理解技能樹研究 | https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/presentation/research.html |

### ⚠️ GitHub Pages 只發佈 Brand Book，不發佈 docs/（2026-08-04 收斂）

**這個 repo 是 PUBLIC，而 GitHub Pages 曾設成 `main` branch 的 `/docs`** → 整個 `docs/` 目錄（含內部會議記錄、合作方顧問姓名、實習生就讀學校、product owner 個人背景）都被一個對外網站服務中，任何人與 Google 爬蟲可直接讀 `.md`（實測 `https://youngger9765.github.io/chinese-literacy-platform/meetings/*.md` 回 200 `text/markdown`）。

**現行設定**：Pages source = **`gh-pages` branch / root**，該 branch 是 orphan、只有兩個檔（`index.html` = Brand Book、`.nojekyll`）。`docs/` 已不再對外發佈（實測敏感路徑回 404、Brand Book 仍 200、negative control 404）。

| 情況 | 做法 |
|------|------|
| 改了 `docs/index.html`（Brand Book） | **線上不會自動更新** → 要手動把它推成 `gh-pages` 的 root（見下方指令），否則 github.io 上還是舊版 |
| 想把 Pages source 改回 `main:/docs` | ⛔ **禁止** — 那會立刻重新對外發佈整個 `docs/`，包含內部會議記錄與個資 |
| 新增任何含顧問姓名／客戶內容／實習生個資的文件 | 進 **L2 PRIVATE** `kist-curriculum`，不進這個 PUBLIC repo 的 `docs/`（完整原始版備份在 `kist-curriculum/l3-docs-originals/`） |

同步 Brand Book 到線上（不動工作樹的 plumbing 做法）：

```bash
BLOB=$(git hash-object -w docs/index.html)
NOJ=$(printf '' | git hash-object -w --stdin)
TREE=$(printf '100644 blob %s\t.nojekyll\n100644 blob %s\tindex.html\n' "$NOJ" "$BLOB" | git mktree)
PARENT=$(git ls-remote origin refs/heads/gh-pages | cut -f1)

# fail-closed：branch 被誤刪時 PARENT 會是空字串，git commit-tree -p "" 會直接失敗
if [ -n "$PARENT" ]; then
  COMMIT=$(git commit-tree "$TREE" -p "$PARENT" -m "chore: sync Brand Book")
else
  echo "⚠️ gh-pages 不存在，改建 root commit（等於重建該 branch）"
  COMMIT=$(git commit-tree "$TREE" -m "chore: republish Brand Book (gh-pages was missing)")
fi

git push origin "${COMMIT}:refs/heads/gh-pages"   # ⚠️ 大括號必要，zsh 會把 $COMMIT:r 當 modifier 吃掉
```

**build 觸發**：改「Pages source 設定」**不會**自動 rebuild —— 2026-08-04 實測改完 120 秒後舊 build 仍在服務敏感路徑，要 `gh api -X POST repos/Youngger9765/chinese-literacy-platform/pages/builds` 手動觸發。
至於「push 到 `gh-pages` 會不會自動觸發 build」**尚未實測**（一般 Pages 對 source branch push 會觸發）→ 保險起見同步完就跑一次上面那個 POST，並用下面的方法驗證線上真的變了。

> 驗證一定要帶 **positive + negative control**：Brand Book 回 200 **且內容含 "Brand Book"**、敏感路徑回 404、不存在的路徑也回 404。少了 positive control，整站掛掉也會看起來像「敏感檔下架成功」。

## 參考專案

方大哥的原始實作：`github.com/Shinjou/lingoleap-ai-reading-tutor`（唯讀參考，不修改）

## 架構地圖（graphify）

`graphify-out/graph.json`（gitignored，本地）— 問「架構/誰呼叫誰/改這會動到誰/資料流」時**優先讀圖**（`/graphify query "..."` 或直接讀 JSON），不要冷 grep 全 repo
code 大改後重建：`graphify . --update`｜批次腳本：job repo `scripts/build-repo-graphs.sh`
