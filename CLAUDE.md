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
| Frontend (Cloud Run) | `https://lingoleap-frontend-958347263320.asia-east1.run.app` |
| Frontend (Firebase) | `https://lingoleap-dev.web.app` |
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
| `backend/data/lessons/` | 課文 YAML 來源檔（57 篇） |

## 參考專案

方大哥的原始實作：`github.com/Shinjou/lingoleap-ai-reading-tutor`（唯讀參考，不修改）
