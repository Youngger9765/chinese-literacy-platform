# TRD - 技術規格文檔
# 國語文閱讀學習平台（LingoLeap）

> Technical Requirements Document
> Version 1.0 | 2026-02-27

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

### 1.1 技術選型決策

| 層級 | 技術 | 版本 | 選擇理由 |
|------|------|------|----------|
| Frontend Framework | React | 19.x | 生態系成熟、社群支援、團隊熟悉度 |
| Build Tool | Vite | 6.x | 快速 HMR、ESM 原生支持 |
| CSS Framework | Tailwind CSS | 3.4 | Utility-first、快速原型開發 |
| Backend Framework | FastAPI | 0.115+ | 非同步、自動 OpenAPI、Pydantic 整合 |
| ORM | SQLAlchemy | 2.0+ | Mapped columns、強型別 |
| Database | PostgreSQL | 15 | JSON 欄位支持、全文搜尋、Cloud SQL |
| AI Model | Gemini 2.5 Flash | - | Vertex AI 原生、結構化 JSON 輸出 |
| Cloud Platform | GCP | - | Cloud Run serverless、自動擴展 |
| Container Registry | Artifact Registry | - | asia-east1、Docker 映像管理 |

### 1.2 設計原則

1. **Stateless API**: 後端不存儲 request 間的狀態（除 Socratic session 暫存）
2. **YAML-first Content**: 平台課文從 YAML 載入，不依賴 DB
3. **AI Centralization**: 所有 AI 呼叫集中在 `ai_service.py`，前端不直接呼叫 AI
4. **Browser-native Speech**: STT/TTS 使用 Web Speech API，不經後端

---

## 2. 前端架構

### 2.1 技術棧

```json
{
  "react": "^19.2.4",
  "react-dom": "^19.2.4",
  "recharts": "^3.7.0",
  "typescript": "~5.8.2",
  "vite": "^6.2.0",
  "tailwindcss": "^3.4.0"
}
```

### 2.2 應用狀態管理

使用 React `useState` 管理 SPA 內部狀態，無外部 state library：

```typescript
// App.tsx 核心狀態
const [view, setView] = useState<AppView>(AppView.HOME);       // 當前頁面
const [selectedStory, setSelectedStory] = useState<Story | null>(null);  // 選中課文
const [session, setSession] = useState<LearningSession | null>(null);    // 學習階段
const [lastAttempt, setLastAttempt] = useState<ReadingAttempt | null>(null); // 朗讀結果
```

### 2.3 學習步驟元件

| 步驟 | 元件 | AppView | 說明 |
|------|------|---------|------|
| 0 | `StoryLibrary` | HOME | 課文列表 + 篩選 |
| 1 | `Intro` | INTRO | 課文背景、作者介紹 |
| 2 | `LiveTutor` | TUTOR | 逐段朗讀 + AI 即時回饋 |
| 3 | `ComprehensionChat` | COMPREHENSION | 蘇格拉底式 AI 對話 |
| 4 | `VocabPractice` | VOCAB | 生字練習 + 筆順 |
| 5 | `FullReading` | FULL_READING | 全文流暢度朗讀 |
| 6 | `AssessmentReport` | REPORT | 六環節診斷報告 |

### 2.4 步驟流轉

```
HOME ──(選課文)──▶ INTRO ──(開始)──▶ TUTOR ──(完成朗讀)──▶ COMPREHENSION
                                                            │
    ◀──(回首頁)── REPORT ◀── FULL_READING ◀── VOCAB ◀──────┘
```

每個步驟完成後透過 callback 推進至下一步，並將結果存入 `session` 狀態。

### 2.5 API 呼叫層

所有後端呼叫集中在 `frontend/src/services/api.ts`：

```typescript
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
```

**SessionExpiredError 機制**：Cloud Run 重新部署會清除後端 in-memory session。前端遇到 422 "session not found" 時拋出 `SessionExpiredError`，由 `ComprehensionChat` 元件自動重建 session。

### 2.6 語音技術

| 功能 | 技術 | 說明 |
|------|------|------|
| 語音辨識 (STT) | Web Speech API (`SpeechRecognition`) | 瀏覽器原生、免費、中文支援 |
| 語音合成 (TTS) | Web Speech API (`SpeechSynthesis`) | 瀏覽器原生範讀 |
| 流暢度分析 | `fluencyAnalyzer.ts` | 前端計算 CPM / 準確率 |
| 文字差異比對 | `DiffDisplay.tsx` (LCS) | 原文 vs 辨識結果比對 |

### 2.7 特殊元件

| 元件 | 路徑 | 說明 |
|------|------|------|
| `WriteCharacter` | `components/stroke-order/` | 筆順練習（canvas 繪製） |
| `DiffDisplay` | `components/ui/DiffDisplay.tsx` | LCS 差異比對顯示 |
| `StepperNav` | `components/StepperNav.tsx` | 步驟導航列 |

---

## 3. 後端架構

### 3.1 技術棧

```
fastapi>=0.115
uvicorn[standard]>=0.30
pydantic>=2.0
sqlalchemy>=2.0
psycopg2-binary>=2.9
google-genai>=1.0
alembic>=1.13
pyyaml>=6.0
```

### 3.2 API 端點

#### 3.2.1 Stories API（課文服務）

| Method | Path | 說明 | 資料來源 |
|--------|------|------|----------|
| GET | `/api/stories` | 課文列表（分頁 + 篩選） | YAML in-memory |
| GET | `/api/stories/{story_id}` | 課文詳情 | YAML in-memory |

**查詢參數** (`/api/stories`):
- `grade`: int (1-12) — 年級篩選
- `genre`: str — 文體篩選（記敘文/說明文/議論文/文言文/應用文）
- `category`: str — 分類篩選
- `search`: str (max 100) — 關鍵字搜尋
- `page`: int (default 1) — 頁碼
- `page_size`: int (default 60, max 100) — 每頁數量

**回應結構**:
```json
{
  "stories": [{ "id", "lesson_number", "title", "grade", "grade_code", "genre", "category", "char_count", "thumbnail_url", "reading_strategy", "intro" }],
  "total": 57,
  "grades": [4, 5, 6, 7, 8, 9]
}
```

#### 3.2.2 Learning API（學習服務）

| Method | Path | 說明 | 狀態 |
|--------|------|------|------|
| POST | `/api/learning-sessions` | 建立學習階段 | Stub（待 DB 整合） |
| POST | `/api/comprehension/question` | 生成理解提問 | Deprecated（已被 chat 取代） |
| POST | `/api/comprehension/chat` | 蘇格拉底式對話 | 完整實作 |

**`/api/comprehension/chat` 請求**:
```json
{
  "session_id": "uuid",
  "story_title": "課文標題",
  "story_text": "全文內容",
  "student_answer": "學生回答（null = 開始新對話）",
  "mispronounced_words": ["字1", "字2"],
  "accuracy": 85.5,
  "cpm": 120
}
```

**`/api/comprehension/chat` 回應**:
```json
{
  "question": "AI 提問",
  "feedback": "回饋（可能為 null）",
  "understood": true,
  "understood_count": 3,
  "required_count": 5,
  "phase": "factual",
  "is_complete": false,
  "referenced_paragraph": 2
}
```

#### 3.2.3 Users API

| Method | Path | 說明 | 狀態 |
|--------|------|------|------|
| GET | `/api/users/me` | 當前用戶資訊 | Stub（待 Auth 實作） |

### 3.3 AI 服務架構

#### 3.3.1 集中式 AI 呼叫 (`ai_service.py`)

```python
# 唯一 AI 入口
client = genai.Client(vertexai=True, project="lingoleap-dev", location="us-central1")
model = "gemini-2.5-flash"
max_output_tokens = 1024
temperature = 0.7
response_mime_type = "application/json"
```

**重試策略**: 指數退避（1s → 2s → 4s），最多 3 次
**超時**: 30 秒（asyncio.wait_for）

#### 3.3.2 蘇格拉底對話 Agent (`socratic_agent.py`)

**Session 管理**: In-memory `SessionStore`（30 分鐘 TTL、自動清理）

**對話階段**:
1. `factual` — 事實理解（課文中明確寫到的）
2. `inferential` — 推論理解（需要推理的）
3. `evaluative` — 評價理解（個人觀點、價值判斷）

**通過機制**: 5 題 3 階段，每題評估 `understood: true/false`

**安全機制**:
- Rate limiting: 每 session 每分鐘最多 30 次請求
- Circuit breaker: 連續 3 次 AI 錯誤 → RuntimeError → HTTP 503
- Error fallback: `understood=False`（永不自動通過）

#### 3.3.3 人格設定 (`persona.py`)

統一「溫暖但堅定」語氣（`TUTOR_PERSONA`），用於所有 AI 互動。

### 3.4 課文資料管線

```
backend/data/stories/*.yaml  →  lesson_loader.py (startup 載入)  →  In-memory dict
                                                                       │
                                                              Stories API 查詢/回傳
```

57 篇課文從 YAML 載入，不需要 DB。每篇包含：
- 基本資訊（title, grade, genre, category）
- 課文段落（paragraphs[]）
- 生字表（vocabulary[]）
- 填空題（fill_in_blank[]）
- 選擇題（multiple_choice[]）
- 朗讀基準（reading_benchmark{}）

---

## 4. 資料庫設計

### 4.1 ER 圖

```
┌──────────┐     ┌──────────┐     ┌──────────────┐
│  School   │────▶│  Teacher  │────▶│    Class      │
│           │ 1:N │           │ 1:N │              │
└──────────┘     └──────────┘     └──────┬───────┘
                       │ 1:N              │
                       ▼                  │ N:M (ClassStudent)
                 ┌──────────┐             │
                 │   Text    │        ┌───▼──────┐
                 │ (課文)    │        │  Student   │
                 └─────┬────┘        └────┬──────┘
                       │                  │
                       │ 1:N         1:N  │
                       ▼                  ▼
                 ┌─────────────────────────┐
                 │    LearningSession       │
                 │ (student_id, text_id)    │
                 └──────────┬──────────────┘
                            │ 1:N
                            ▼
                 ┌──────────────────┐
                 │  CharacterError   │
                 │ (character, type) │
                 └──────────────────┘
```

### 4.2 資料表定義

#### schools
| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 學校 ID |
| name | VARCHAR(200) | NOT NULL | 學校名稱 |

#### teachers
| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 教師 ID |
| school_id | INTEGER | FK → schools.id, NOT NULL | 所屬學校 |
| email | VARCHAR(254) | UNIQUE, NOT NULL | 電子信箱 |
| name | VARCHAR(100) | NOT NULL | 姓名 |

#### classes
| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 班級 ID |
| teacher_id | INTEGER | FK → teachers.id, NOT NULL | 導師 |
| name | VARCHAR(100) | NOT NULL | 班級名稱 |

#### class_students（多對多關聯表）
| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | ID |
| class_id | INTEGER | FK → classes.id, NOT NULL | 班級 |
| student_id | INTEGER | FK → students.id, NOT NULL | 學生 |
| | | UNIQUE(class_id, student_id) | 唯一約束 |

#### students
| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 學生 ID |
| name | VARCHAR(100) | NOT NULL | 姓名 |

#### texts（課文內容）
| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | 課文 ID |
| title | VARCHAR(200) | NOT NULL | 標題 |
| paragraphs | JSON | NOT NULL | 段落陣列 `string[]` |
| full_text | TEXT | NULLABLE | 全文（搜尋用） |
| char_count | INTEGER | NOT NULL, default 0 | 字數 |
| grade | INTEGER | NOT NULL, INDEX | 年級 (4-9) |
| grade_code | VARCHAR(10) | NOT NULL | 代碼 ("G4-1") |
| genre | VARCHAR(20) | NOT NULL | 文體 |
| text_type | VARCHAR(10) | NOT NULL, default "單" | 文本類型 |
| category | VARCHAR(20) | NOT NULL | 分類 |
| reading_strategy | VARCHAR(200) | NULLABLE | 閱讀策略 |
| thumbnail_path | VARCHAR(500) | NULLABLE | 縮圖 GCS 路徑 |
| vocabulary | JSON | NULLABLE | 生字表 `[{word, definition}]` |
| fill_in_blank | JSON | NULLABLE | 填空題 `[{sentence, answer}]` |
| multiple_choice | JSON | NULLABLE | 選擇題 `[{question, options[], answer, explanation}]` |
| reading_benchmark | JSON | NULLABLE | 朗讀基準 `{levels[]}` |
| visibility | ENUM | NOT NULL, default "platform" | 可見層級 |
| school_id | INTEGER | FK → schools.id, NULLABLE | 學校擁有 |
| class_id | INTEGER | FK → classes.id, NULLABLE | 班級擁有 |
| teacher_id | INTEGER | FK → teachers.id, NULLABLE | 教師擁有 |
| created_by_id | INTEGER | FK → teachers.id, NULLABLE | 建立者 |
| forked_from_id | INTEGER | FK → texts.id, NULLABLE | Fork 來源 |
| status | ENUM | NOT NULL, default "published" | 狀態 |
| lesson_number | INTEGER | UNIQUE, INDEX, NULLABLE | 平台課文編號 |
| source_file | VARCHAR(200) | NULLABLE | 來源 YAML |
| created_at | DATETIME | NOT NULL | 建立時間 |
| updated_at | DATETIME | NOT NULL | 更新時間 |

**Visibility 層級**: `platform` → `organization` → `school` → `class` → `private`

**Text Status**: `draft` → `published` → `archived`

#### learning_sessions
| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | Session ID |
| student_id | INTEGER | FK → students.id, NOT NULL | 學生 |
| text_id | INTEGER | FK → texts.id, NULLABLE | 課文 |
| current_step | INTEGER | NOT NULL, default 1 | 當前步驟 (1-6) |
| accuracy | FLOAT | NULLABLE | 準確率 |
| completed_at | DATETIME | NULLABLE | 完成時間 |

#### character_errors
| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | INTEGER | PK, AUTO | ID |
| session_id | INTEGER | FK → learning_sessions.id, NOT NULL | Session |
| character | VARCHAR(4) | NOT NULL | 錯字 |
| error_type | VARCHAR(50) | NOT NULL | 錯誤類型 |

---

## 5. 部署架構

### 5.1 GCP 資源

| 服務 | 資源 | Region | 規格 |
|------|------|--------|------|
| Cloud Run | lingoleap-frontend | asia-east1 | 自動擴展 |
| Cloud Run | lingoleap-backend | asia-east1 | 自動擴展 |
| Cloud SQL | lingoleap-db | asia-east1 | PostgreSQL 15, db-f1-micro |
| Artifact Registry | lingoleap/ | asia-east1 | Docker images |
| GCS | lingoleap-assets | - | 課文縮圖、媒體 |
| Vertex AI | Gemini 2.5 Flash | us-central1 | AI 模型（asia-east1 無 Gemini） |

### 5.2 環境配置

| 環境變數 | 說明 | 預設值 |
|----------|------|--------|
| `DATABASE_URL` | PostgreSQL 連線 | `postgresql://user:pass@localhost:5432/lingoleap` |
| `ALLOWED_ORIGINS` | CORS 白名單（逗號分隔） | `http://localhost:3000` |
| `GCS_BUCKET` | GCS bucket 名稱 | `lingoleap-assets` |
| `GCS_PUBLIC_URL` | GCS 公開 URL | `https://storage.googleapis.com/lingoleap-assets` |
| `VITE_API_URL` | 前端 API base URL | `http://localhost:8000` |

**注意**: AI 呼叫走 Vertex AI service account 驗證，不需要 API key。

### 5.3 CI/CD Pipeline

```
feature/*  ──PR──▶  staging  ──PR──▶  main
    │                  │                │
    ▼                  ▼                ▼
preview-deploy.yml  staging-deploy.yml  deploy.yml
(ephemeral)         (persistent)        (persistent)
```

| Workflow | 觸發 | 部署目標 |
|----------|------|----------|
| `deploy.yml` | push to `main` | Production |
| `staging-deploy.yml` | push to `staging` | Staging |
| `preview-deploy.yml` | PR opened/updated | PR Preview (ephemeral) |
| `preview-cleanup.yml` | PR closed | 清理 Preview 資源 |

**變更偵測**: `backend/**` 變更 → rebuild backend; `frontend/**` 變更 → rebuild frontend

---

## 6. 安全性

### 6.1 驗證與授權

| 項目 | 現況 | 規劃 |
|------|------|------|
| 使用者驗證 | 未實作（`/api/users/me` 為 stub） | JWT + 角色系統 |
| API 授權 | 無（所有端點公開） | RBAC（教師/學生/管理員） |
| AI API 驗證 | Vertex AI service account（自動） | 維持 |

### 6.2 CORS 設定

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,  # 從環境變數
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 6.3 輸入驗證

- Pydantic V2 model 驗證所有 API 輸入
- `student_answer`: max_length=500
- `search`: max_length=100
- `page_size`: max 100
- `accuracy`: ge=0, le=100

### 6.4 Rate Limiting

- Socratic session: 30 requests/minute/session
- 全局 rate limiting: 待實作

---

## 7. 效能與可擴展性

### 7.1 現有優化

| 項目 | 策略 |
|------|------|
| 課文載入 | Startup 一次載入 YAML → in-memory（O(1) 查詢） |
| AI 呼叫 | async + thread pool（不阻塞 event loop） |
| Session 清理 | TTL 30 分鐘自動過期 |
| 前端打包 | Vite 6 tree-shaking + code splitting |

### 7.2 已知限制

| 限制 | 影響 | 改善方案 |
|------|------|----------|
| In-memory sessions | Cloud Run 重部署清除所有 session | 遷移至 Redis 或 DB |
| 無 CDN | 前端靜態資源直接從 Cloud Run 提供 | Firebase Hosting / Cloud CDN |
| 單一 AI region | Gemini 只在 us-central1 可用 | 等待 asia-east1 支援 |
| 無快取 | 每次 API 呼叫都重新查詢 | 加入 Redis cache |

### 7.3 擴展路線

1. **Phase 1**（現在）: Cloud Run 自動擴展、in-memory 狀態
2. **Phase 2**: Redis session store、CDN 靜態資源
3. **Phase 3**: Read replica、connection pooling、API caching

---

## 8. 監控與可觀測性

### 8.1 現有

- Cloud Run 內建 metrics（request count, latency, error rate）
- Python `logging` module（stdout → Cloud Logging）
- AI 呼叫 retry/timeout logging

### 8.2 規劃

| 項目 | 工具 | 優先級 |
|------|------|--------|
| Error tracking | Cloud Error Reporting | P1 |
| APM | Cloud Trace | P2 |
| Custom dashboards | Cloud Monitoring | P2 |
| Uptime checks | Cloud Monitoring | P1 |

---

## 9. 文件交叉引用

| 文件 | 關聯 |
|------|------|
| [BRD.md](BRD.md) | 商業目標 → 本文技術方案如何實現 |
| [MRD.md](MRD.md) | 市場需求 → 本文技術選型考量 |
| [PRD.md](PRD.md) | 產品功能 → 本文 API 端點 + DB schema |
| [TECHNICAL_DECISION.md](TECHNICAL_DECISION.md) | 技術決策紀錄（本文的詳細補充） |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) | 資料庫設計決策（本文 §4 的延伸） |

---

*TRD v1.0 | 2026-02-27 | 基於 codebase 實際狀態撰寫*
