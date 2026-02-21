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
| Frontend | `https://lingoleap-frontend-958347263320.asia-east1.run.app` |
| Backend API | `https://lingoleap-backend-958347263320.asia-east1.run.app` |
| Cloud SQL | `lingoleap-db` (PostgreSQL 15, asia-east1, db-f1-micro) |
| Artifact Registry | `asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/` |

### CI/CD

Push to `main` → GitHub Actions 自動部署（`deploy.yml`）。
- `backend/**` 變更 → rebuild + deploy backend
- `frontend/**` 變更 → rebuild + deploy frontend
- Secret: `GCP_SA_KEY` (service account for CI/CD)

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

## 學習流程（6 步驟）

1. **簡介** — 課文背景介紹
2. **逐段朗讀** — AI 即時朗讀指導（LiveTutor）
3. **生字練習** — 筆順練習 + 注音（VocabPractice + WriteCharacter）
4. **課文理解** — 蘇格拉底式 AI 對話（ComprehensionChat）
5. **全文朗讀** — 完整朗讀評估（FullReading）
6. **報告** — 學習成果報告（AssessmentReport）

## 關鍵檔案

| 檔案 | 說明 |
|------|------|
| `frontend/src/App.tsx` | 主路由 + 步驟導航 |
| `frontend/src/components/reading-steps/` | 6 步驟元件 |
| `frontend/src/components/stroke-order/` | 筆順練習 |
| `frontend/src/components/zhuyin/` | 注音處理 |
| `frontend/src/services/api.ts` | API 呼叫層 |
| `backend/app/main.py` | FastAPI 入口 |
| `backend/app/services/ai_service.py` | Vertex AI Gemini 呼叫（蘇格拉底對話） |
| `backend/app/models/` | DB Schema（School, Student, Text, LearningSession） |
| `backend/app/routes/` | API 路由 |

## 參考專案

方大哥的原始實作：`github.com/Shinjou/lingoleap-ai-reading-tutor`（唯讀參考，不修改）
