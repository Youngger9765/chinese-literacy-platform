# 技術架構交接文件

**國語文閱讀學習平台（LingoLeap）**
版本 1.0 | 2026 年 3 月

> 本文件供技術交接使用，說明平台架構、部署方式與關鍵技術決策。

---

## 目錄

1. [系統架構總覽](#1-系統架構總覽)
2. [前端架構](#2-前端架構)
3. [後端架構](#3-後端架構)
4. [AI 服務架構](#4-ai-服務架構)
5. [資料庫架構](#5-資料庫架構)
6. [GCP 基礎設施](#6-gcp-基礎設施)
7. [CI/CD 流程](#7-cicd-流程)
8. [關鍵技術決策記錄](#8-關鍵技術決策記錄)
9. [已知限制與技術債](#9-已知限制與技術債)

---

## 1. 系統架構總覽

```
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│  Frontend (SPA)                  │      │  Backend (API)                   │
│  React 19 + Vite 6 + Tailwind 3 │─────▶│  FastAPI + SQLAlchemy 2.0        │
│  Cloud Run: lingoleap-frontend   │ REST │  Cloud Run: lingoleap-backend    │
└──────────────────────────────────┘      └──────┬───────────┬───────────────┘
                                                 │           │
                                          ┌──────▼──┐  ┌─────▼──────────────┐
                                          │ Cloud   │  │ Vertex AI          │
                                          │ SQL     │  │ Gemini 2.5 Flash   │
                                          │ (PG 15) │  │ (us-central1)      │
                                          └─────────┘  └────────────────────┘
                                                 │
                                          ┌──────▼──────────────┐
                                          │ GCS                  │
                                          │ lingoleap-assets     │
                                          │ (thumbnails, media)  │
                                          └──────────────────────┘
```

**設計原則：**

1. **Stateless API**：後端不儲存 request 間的狀態（蘇格拉底對話 session 為例外，用 in-memory dict 暫存）
2. **YAML-first Content**：57 篇課文從 YAML 檔案載入，不依賴資料庫，方便版本控管
3. **AI Centralization**：所有 AI 呼叫集中在 `ai_service.py`，前端不直接呼叫 AI
4. **Browser-native Speech**：語音識別（STT）與語音合成（TTS）使用 Web Speech API，不經後端

---

## 2. 前端架構

### 技術棧

| 工具 | 版本 | 說明 |
|------|------|------|
| React | 19.x | UI 框架 |
| TypeScript | 5.8 | 型別安全 |
| Vite | 6.x | Build tool，支援 HMR |
| Tailwind CSS | 3.4 | Utility-first CSS |
| Recharts | 3.x | 圖表套件（熱度圖、進度圖） |

### 應用狀態管理

使用 React `useState` 管理 SPA 狀態，無外部 state library：

```typescript
// App.tsx 核心狀態
const [view, setView] = useState<AppView>(AppView.HOME);
const [selectedStory, setSelectedStory] = useState<Story | null>(null);
const [session, setSession] = useState<LearningSession | null>(null);
const [lastAttempt, setLastAttempt] = useState<ReadingAttempt | null>(null);
```

### 關鍵檔案

| 路徑 | 說明 |
|------|------|
| `frontend/src/App.tsx` | 主路由、步驟導航、LearningSession state |
| `frontend/src/services/api.ts` | 統一 API 呼叫層，含 SessionExpiredError 自動重建 |
| `frontend/src/components/reading-steps/` | 6 個學習步驟元件 |
| `frontend/src/components/reading-steps/AssessmentReport.tsx` | 六環節診斷報告 |
| `frontend/src/components/ui/DiffDisplay.tsx` | LCS 文字差異比對顯示 |
| `frontend/src/components/stroke-order/` | 筆順練習相關元件 |
| `frontend/src/components/zhuyin/` | 注音顯示處理 |

### 學習步驟元件對應

| 步驟 | 元件名稱 | 說明 |
|------|---------|------|
| 1. 簡介 | `Intro.tsx` | 課文背景介紹 |
| 2. 逐段朗讀 | `LiveTutor.tsx` | 段落朗讀 + AI 回饋 |
| 3. 生字練習 | `VocabPractice.tsx` | 生字認識 + 筆順練習 |
| 4. 課文理解 | `ComprehensionChat.tsx` | 蘇格拉底對話 |
| 5. 全文朗讀 | `FullReading.tsx` | 完整朗讀評估 |
| 6. 報告 | `AssessmentReport.tsx` | 六環節診斷報告 |

---

## 3. 後端架構

### 技術棧

| 工具 | 版本 | 說明 |
|------|------|------|
| FastAPI | 0.115+ | Web framework，自動 OpenAPI |
| SQLAlchemy | 2.0+ | ORM（Mapped columns，強型別） |
| Pydantic | 2.0+ | 資料驗證、schema |
| PostgreSQL | 15 | 主資料庫（Cloud SQL） |
| Alembic | 最新 | 資料庫 migration |

### 目錄結構

```
backend/
├── app/
│   ├── main.py              # FastAPI 入口，router 註冊
│   ├── database.py          # DB 連線設定
│   ├── auth/                # JWT、密碼、rate limiter
│   ├── models/              # SQLAlchemy ORM models
│   ├── routes/              # API 路由（按功能分檔）
│   ├── schemas/             # Pydantic schemas（request/response）
│   ├── services/            # 業務邏輯層
│   │   ├── ai_service.py    # 唯一 AI 呼叫入口
│   │   ├── socratic_agent.py # 蘇格拉底對話 agent
│   │   └── lesson_loader.py  # YAML 課文載入
│   └── utils/               # 工具函數
├── data/
│   └── stories/             # 課文 YAML 檔（57 篇）
├── tests/                   # 測試
│   └── agent-eval/          # Socratic agent 評估套件
└── requirements.txt
```

### 路由模組

| 模組 | 說明 |
|------|------|
| `auth.py` | 註冊、登入、密碼重設 |
| `users.py` | 用戶資料管理 |
| `schools.py` | 學校管理 |
| `classrooms.py` | 班級管理、學生加入 |
| `teacher.py` | 教師儀表板、卡點偵測 |
| `learning.py` | 學習 session、AI 互動 |
| `stories.py` | 課文列表與詳情（YAML） |
| `assignments.py` | 課文指派管理 |
| `parents.py` | 家長端 API |
| `roles.py` | 角色權限管理 |

---

## 4. AI 服務架構

### 模型設定

```python
# backend/app/services/ai_service.py
client = genai.Client(
    vertexai=True,
    project="lingoleap-dev",
    location="us-central1"  # 重要：asia-east1 沒有 Gemini 模型
)
model = "gemini-2.5-flash"  # 注意：不是 gemini-2.0，不是 preview 版
max_output_tokens = 1024    # 256 會導致 JSON 截斷
```

> **重要**：`us-central1` 不能改為 `asia-east1`，Vertex AI 的 Gemini 模型只在 `us-central1` 提供。

### Socratic Agent（蘇格拉底對話）

位置：`backend/app/services/socratic_agent.py`

特性：
- 5 題 3 階段設計（熱身 → 深化 → 總結）
- In-memory session dict（Cloud Run 重啟後清除）
- Circuit breaker：連續 3 次 AI 錯誤 → 拋出 RuntimeError → HTTP 503
- 錯誤時 `understood=False`（永遠不自動讓學生通過）

### AI 呼叫函數

| 函數 | 用途 |
|------|------|
| `generate_reading_analysis()` | 朗讀文字差異分析 |
| `generate_socratic_question()` | 蘇格拉底提問生成 |
| `evaluate_comprehension()` | 學生回答評估 |
| `generate_example_sentences()` | 生字造句範例 |
| `validate_student_sentence()` | 學生造句驗證 |

---

## 5. 資料庫架構

### 核心資料表

```
學校層級
├── schools              學校資料
└── school_admins        學校管理員關聯

班級層級
├── classrooms           班級（含 join_code）
├── classroom_teachers   班級-教師關聯（多對多）
└── classroom_students   班級-學生關聯（多對多）

用戶層級
├── users                所有用戶（教師/學生/家長）
├── user_roles           角色關聯
└── student_profiles     學生擴充資料

課文層級
├── classroom_texts      班級-課文關聯（指派記錄）
└── [course texts]       課文內容從 YAML 載入，不存 DB

學習記錄
├── learning_sessions    學習 session（主表）
├── character_errors     生字錯誤記錄
├── error_corrections    錯誤修正記錄
└── dialogue_turns       蘇格拉底對話記錄

擴充功能
├── student_tags         教師標籤
├── teacher_instructions 個別化指導記錄
└── notification_reads   通知已讀狀態
```

### Migration 管理

```bash
# 產生新的 migration（需要明確許可）
alembic revision --autogenerate -m "description"

# 執行 migration
alembic upgrade head

# 查看目前版本
alembic current
```

> **警告**：Migration 會影響 production 資料庫，必須先在 staging 環境測試。

---

## 6. GCP 基礎設施

### 帳號設定

```bash
gcloud config configurations activate lingoleap
```

| 設定 | 值 |
|------|-----|
| GCP Project | `lingoleap-dev` |
| Account | `youngtsai@junyiacademy.org` |
| Region | `asia-east1`（Cloud Run）|
| AI Region | `us-central1`（Vertex AI Gemini）|

### 服務清單

| 服務 | Cloud Run 名稱 | 說明 |
|------|--------------|------|
| Frontend | `lingoleap-frontend` | React SPA |
| Backend | `lingoleap-backend` | FastAPI |
| Database | Cloud SQL `lingoleap-db` | PostgreSQL 15, db-f1-micro |
| Artifact Registry | `lingoleap` | Docker images |

### 環境變數（Cloud Run）

| 變數 | 說明 |
|------|------|
| `DATABASE_URL` | Cloud SQL Unix socket 連線字串 |
| `ALLOWED_ORIGINS` | CORS 白名單 |
| `SECRET_KEY` | JWT 簽名密鑰 |

> 環境變數在 Cloud Run Console 中管理，**不 commit 到 git**。

### Artifact Registry 映像清理策略

| 層級 | 機制 | 觸發時機 |
|------|------|---------|
| 1 | GCP cleanup-policy（自動） | untagged >7天刪除，tagged 保留最新 10 個 |
| 2 | `deploy.yml` | push main 後，`prod-*` images 保留最新 3 個 |
| 3 | `staging-deploy.yml` | push staging 後，`staging-*` images 保留最新 3 個 |
| 4 | `preview-deploy.yml` | PR closed 後，`issue-N-*` images 全部刪除 |

---

## 7. CI/CD 流程

### 工作流程對應

| Workflow 檔案 | 觸發條件 | 部署目標 |
|-------------|---------|---------|
| `deploy.yml` | push to `main` | Production |
| `staging-deploy.yml` | push to `staging` | Staging |
| `preview-deploy.yml` | PR opened/updated/closed | PR Preview（臨時，PR 關閉後自動刪除） |

### 選擇性重建

- `backend/**` 有變更 → 重建並部署 backend
- `frontend/**` 有變更 → 重建並部署 frontend
- 兩者皆有 → 並行部署

### CI Secret

| Secret 名稱 | 說明 |
|------------|------|
| `GCP_SA_KEY` | GCP Service Account key（JSON），用於 CI 部署 |

---

## 8. 關鍵技術決策記錄

### 決策 1：Gemini 2.5 Flash（而非 2.0）

**理由**：2.5 Flash 在蘇格拉底對話品質上明顯優於 2.0，且 JSON 結構化輸出更穩定。

**注意事項**：
- Model ID 必須是 `gemini-2.5-flash`，`preview` 版本在 Vertex AI 上會返回 404
- `max_output_tokens` 設為 1024，256 會導致複雜 JSON 截斷

### 決策 2：YAML-first 課文儲存

**理由**：課文內容需要版本控管，YAML 比資料庫更易追蹤變更歷史。57 篇課文全部以 YAML 格式儲存在 `backend/data/stories/`。

**限制**：新增課文需要 PR + deploy，不能即時新增。

### 決策 3：Web Speech API（不使用 Azure/Google Cloud Speech SDK）

**理由**：Web Speech API 免費且已足夠，無需額外費用和複雜整合。

**限制**：瀏覽器間一致性不同，Safari 支援有限。

### 決策 4：In-memory Socratic Session

**理由**：蘇格拉底對話 session 為短暫狀態，Redis 過度設計。

**限制**：Cloud Run 重啟（redeploy）或 scale-to-zero 後 session 清除，學生需重新開始對話。已在前端加入 `SessionExpiredError` 自動重建機制。

### 決策 5：JWT 認證（無 OAuth/SSO）

**理由**：MVP 階段簡化認證流程。

**未來考量**：可接入 Google/Microsoft SSO 方便學校教師使用。

---

## 9. 已知限制與技術債

### 高優先技術債

| 問題 | 影響 | 建議方案 |
|------|------|---------|
| Socratic session in-memory | Cloud Run scale-to-zero 後 session 遺失 | 遷移至 Redis 或 DB |
| Web Speech API 瀏覽器限制 | Safari 支援不穩定 | 評估 Azure/Google Cloud Speech |
| 課文更新需 deploy | 無法即時新增課文 | 建立課文管理後台 |

### 中優先技術債

| 問題 | 影響 | 建議方案 |
|------|------|---------|
| 缺少 E2E 測試 | 部署後無自動驗證 | 加入 Playwright E2E 測試 |
| AI 呼叫無 retry | AI 暫時不可用時直接失敗 | 加入 exponential backoff retry |
| 缺少 APM 監控 | 無法追蹤 API 效能 | 整合 Cloud Monitoring |

### 已知 Bug

詳見 GitHub Issues 標籤 `bug`。

---

## 附錄：手動部署指令

```bash
# Backend 手動部署
gcloud builds submit \
  --tag asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/backend:vX.Y.Z \
  --project lingoleap-dev ./backend

gcloud run deploy lingoleap-backend \
  --image asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/backend:vX.Y.Z \
  --platform managed --region asia-east1 --project lingoleap-dev

# Frontend 手動部署
gcloud builds submit \
  --tag asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/frontend:vX.Y.Z \
  --project lingoleap-dev ./frontend

gcloud run deploy lingoleap-frontend \
  --image asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/frontend:vX.Y.Z \
  --platform managed --region asia-east1 --project lingoleap-dev --port 8080
```
