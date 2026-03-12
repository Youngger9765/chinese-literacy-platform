# TRD - 技術規格文檔
# 國語文閱讀學習平台（LingoLeap）

> Technical Requirements Document
> Version 2.0 | 2026-03-12

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

### 1.1 技術選型

| 層級 | 技術 | 版本 | 選擇理由 |
|------|------|------|----------|
| Frontend Framework | React | 19.x | 生態系成熟、社群支援 |
| Build Tool | Vite | 6.x | 快速 HMR、ESM 原生支持 |
| CSS Framework | Tailwind CSS | 3.4 | Utility-first、快速原型開發 |
| Charts | Recharts | 3.7 | React 原生、教師儀表板圖表 |
| Backend Framework | FastAPI | 0.115+ | 非同步、自動 OpenAPI、Pydantic 整合 |
| ORM | SQLAlchemy | 2.0+ | Mapped columns、強型別 |
| Migration | Alembic | 1.13+ | 版本化 DB migration |
| Database | PostgreSQL | 15 | JSON 欄位支持、全文搜尋、Cloud SQL |
| AI Model | Gemini 2.5 Flash | - | Vertex AI 原生、結構化 JSON 輸出 |
| Cloud Platform | GCP | - | Cloud Run serverless、自動擴展 |
| E2E Testing | Playwright | - | 多瀏覽器、87 個測試案例 |
| Load Testing | Locust | - | 30 concurrent users 壓測 |

### 1.2 設計原則

1. **JWT Auth + RBAC**: 統一用戶模型、8 種角色、scope-based 權限
2. **DB-first Content**: 教師上傳課文存 DB，平台課文從 YAML 載入
3. **AI Centralization**: 所有 AI 呼叫集中在 `ai_service.py`
4. **Browser-native Speech**: STT/TTS 使用 Web Speech API
5. **Route-level Code Splitting**: React.lazy() 動態載入頁面

---

## 2. 前端架構

### 2.1 技術棧

```json
{
  "react": "^19.2.4",
  "react-dom": "^19.2.4",
  "react-router-dom": "^7.x",
  "recharts": "^3.7.0",
  "typescript": "~5.8.2",
  "vite": "^6.2.0",
  "tailwindcss": "^3.4.0"
}
```

### 2.2 應用狀態管理

- **AuthContext**: JWT token、用戶資訊、角色判斷
- **React Router**: 路由級 code splitting（React.lazy）
- **Local state**: 各頁面 useState + useCallback

### 2.3 頁面結構

| 頁面 | 路徑 | 角色 | 說明 |
|------|------|------|------|
| LoginPage | `/login` | 公開 | Email + Google OAuth |
| RegisterPage | `/register` | 公開 | 註冊 + 密碼強度驗證 |
| StoryLibrary | `/library` | 學生 | 課文列表 + 篩選 |
| LearningFlow | `/learn/:slug` | 學生 | 8 步驟學習流程 |
| MyAssignments | `/assignments` | 學生 | 作業列表 + 狀態 |
| LearningHistory | `/history` | 學生 | 學習紀錄 + 對話回顧 |
| MyVocabulary | `/vocabulary` | 學生 | 個人生字本 |
| AchievementsPage | `/achievements` | 學生 | XP + 成就 + 排行榜 |
| StudentProgress | `/progress/:slug` | 學生 | 單篇課文學習進度 |
| TeacherDashboard | `/teacher` | 教師 | 班級管理入口 |
| ClassroomDetail | `/teacher/:id` | 教師 | 8 tab 班級詳情 |
| AdminDashboard | `/admin` | 管理員 | 組織/學校/角色管理 |
| ParentDashboard | `/parent` | 家長 | 孩子學習進度 |
| HelpPage | `/help` | 公開 | 使用手冊 |

### 2.4 學習步驟元件

| 步驟 | 元件 | 說明 |
|------|------|------|
| 1 | `Intro` | 課文背景、作者介紹 |
| 2 | `LiveTutor` | 逐段朗讀 + AI 即時回饋 |
| 3 | `ComprehensionChat` | 蘇格拉底式 AI 對話 |
| 4 | `VocabPractice` | 筆順 + 部件拆解 + 發音練習 |
| 5 | `DictationPractice` | 聽寫練習 |
| 6 | `SentencePractice` | 造句練習 |
| 7 | `FullReading` | 全文流暢度朗讀 |
| 8 | `AssessmentReport` | 六環節 AI 診斷報告 |

### 2.5 教師班級詳情 Tabs

| Tab | 元件 | 說明 |
|-----|------|------|
| 學生進度 | `StudentProgressTab` | 學習曲線 + session 歷史 |
| 學習分析 | `AnalyticsTab` | Recharts 統計圖表 |
| 跨課文分析 | `CrossTextTab` | 學習模式分析 |
| 預警學生 | `AtRiskTab` | 學習困難偵測 |
| 教材管理 | `TextManagementTab` | 指派/取消平台課文 |
| 我的課文 | `MyTextsTab` | 自建課文 CRUD |
| 作業 | `AssignmentTab` | 作業管理 + 批改 |
| 學生名單 | `StudentListTab` | 學生管理 + CSV 匯入 |

### 2.6 API 呼叫層

所有後端呼叫集中在 `frontend/src/services/api.ts`：

```typescript
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
```

**SessionExpiredError 機制**：Cloud Run 重新部署會清除後端 in-memory session。前端遇到 422 "session not found" 時拋出 `SessionExpiredError`，由 `ComprehensionChat` 元件自動重建 session。

### 2.7 語音技術

| 功能 | 技術 | 說明 |
|------|------|------|
| 語音辨識 (STT) | Web Speech API | 瀏覽器原生、中文支援 |
| 語音合成 (TTS) | Web Speech API | 瀏覽器原生範讀 + 聽寫 |
| 流暢度分析 | `fluencyAnalyzer.ts` | 前端計算 CPM / 準確率 |
| 文字差異比對 | `DiffDisplay.tsx` (LCS) | 原文 vs 辨識結果比對 |
| 語音輸入 | `useSpeechRecognition` | ComprehensionChat 語音回答 |
| 錄音 | `useAudioRecorder` | 學生朗讀錄音 + 回放 |

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
bcrypt>=4.0
pyjwt>=2.0
```

### 3.2 API 端點概覽（140+ endpoints）

#### Auth（9 endpoints）
| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/auth/register` | 註冊（Email + Password） |
| POST | `/api/auth/login` | 登入（JWT） |
| POST | `/api/auth/google` | Google OAuth 登入 |
| POST | `/api/auth/change-password` | 修改密碼 |
| POST | `/api/auth/forgot-password` | 忘記密碼 |
| POST | `/api/auth/reset-password` | 重設密碼 |
| POST | `/api/auth/verify-email` | Email 驗證 |
| POST | `/api/auth/complete-onboarding` | 完成新手引導 |
| POST | `/api/auth/accept-terms` | 接受使用條款 |

#### Classrooms（12 endpoints）
| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/classrooms` | 建立班級 |
| GET | `/api/classrooms` | 我的班級列表 |
| GET | `/api/classrooms/{id}` | 班級詳情 |
| PATCH | `/api/classrooms/{id}` | 更新班級 |
| POST | `/api/classrooms/{id}/students` | 加入學生 |
| DELETE | `/api/classrooms/{id}/students/{sid}` | 移除學生 |
| GET | `/api/classrooms/{id}/students` | 學生列表 |
| POST | `/api/classrooms/join` | 學生加入班級（邀請碼） |
| POST | `/api/classrooms/{id}/csv-import` | CSV 匯入學生 |
| GET | `/api/classrooms/csv-template` | CSV 模板下載 |
| POST | `/api/classrooms/{id}/invite-code` | 產生邀請碼 |
| POST | `/api/classrooms/{id}/parent-invite` | 產生家長邀請碼 |

#### Assignments（10 endpoints）
| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/assignments` | 建立作業 |
| GET | `/api/assignments` | 作業列表 |
| GET | `/api/assignments/{id}` | 作業詳情 |
| GET | `/api/assignments/{id}/submissions` | 提交列表 |
| PATCH | `/api/assignments/{id}` | 更新作業（啟用/停用） |
| DELETE | `/api/assignments/{id}` | 刪除作業 |
| POST | `/api/assignments/{id}/start` | 學生開始作業 |
| PATCH | `/api/assignments/submissions/{id}` | 批改（打分） |
| POST | `/api/assignments/{id}/bulk-grade` | 批量批改 |
| GET | `/api/assignments/my` | 學生的作業列表 |

#### Learning（20+ endpoints）
| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/learning/sessions` | 建立學習 session |
| GET | `/api/learning/sessions` | Session 列表 |
| GET | `/api/learning/sessions/{id}` | Session 詳情 |
| GET | `/api/learning/sessions/{id}/report` | Session 報告 |
| GET | `/api/learning/sessions/{id}/status` | Session 狀態 |
| PATCH | `/api/learning/sessions/{id}` | 更新 session |
| POST | `/api/comprehension/chat` | 蘇格拉底式對話 |
| POST | `/api/learning/sessions/{id}/listening-eval` | 聽力理解評估 |
| GET | `/api/learning/students/{sid}/error-patterns` | 錯字模式 |
| GET | `/api/learning/students/{sid}/recommended-vocab` | 推薦生字 |
| GET | `/api/learning/students/{sid}/dashboard` | 學生儀表板 |

#### Teacher（15+ endpoints）
教師端分析、學生進度、學習曲線、教學指示、標籤管理、通知中心等。

#### Gamification（6 endpoints）
XP 總覽、點數紀錄、成就列表、連續登入、排行榜、完成回報。

#### 其他模組
- **Classroom Texts**: 教材指派（3 endpoints）
- **Admin Stories**: 課文管理 CRUD（5 endpoints）
- **Dictionary**: 教育部字典查詢 + 快取（2 endpoints）
- **Feedback**: 使用者回饋（3 endpoints）
- **Parents**: 家長儀表板（1 endpoint）
- **Organizations / Schools / Roles**: 組織管理
- **Health**: 健康檢查（含 AI/DB 狀態）
- **Jobs / Cleanup**: 背景任務 + 課文清理

### 3.3 AI 服務架構

#### 集中式 AI 呼叫 (`ai_service.py`)

```python
client = genai.Client(vertexai=True, project="lingoleap-dev", location="us-central1")
model = "gemini-2.5-flash"
max_output_tokens = 1024
temperature = 0.7
response_mime_type = "application/json"
```

**重試策略**: 指數退避（1s → 2s → 4s），最多 3 次
**超時**: 30 秒（asyncio.wait_for）
**Prompt injection 防護**: `input_sanitizer.py` 過濾惡意輸入

#### 蘇格拉底對話 Agent (`socratic_agent.py`)

**Session 管理**: In-memory `SessionStore`（30 分鐘 TTL、自動清理）

**對話階段**:
1. `factual` — 事實理解
2. `inferential` — 推論理解
3. `evaluative` — 評價理解

**通過機制**: 5 題 3 階段，3 級評分（understood/partial/not_understood）

**安全機制**:
- Rate limiting: 每 session 每分鐘最多 30 次請求
- Circuit breaker: 連續 3 次 AI 錯誤 → RuntimeError → HTTP 503
- Error fallback: `understood=False`（永不自動通過）

### 3.4 服務層

| 服務 | 檔案 | 說明 |
|------|------|------|
| AI Service | `ai_service.py` | 所有 Gemini 呼叫 |
| Socratic Agent | `socratic_agent.py` | 蘇格拉底對話 |
| Gamification | `gamification_service.py` | XP/成就/連續登入 |
| Prediction | `prediction_service.py` | 學習困難預測 |
| Cross-text | `cross_text_analysis_service.py` | 跨課文分析 |
| Listening | `listening_service.py` | 聽力理解評估 |
| Learning Path | `learning_path_service.py` | 學習路徑推薦 |
| Stuck Detection | `stuck_detection_service.py` | 卡點偵測 |
| Dictionary | `dictionary_service.py` | 教育部字典 API + DB 快取 |
| Notification | `notification_service.py` | 教師通知服務 |
| Points | `points_service.py` | XP 計算 + 記錄 |
| Text Cleanup | `text_cleanup_service.py` | 學期結束課文清理 |
| Assignment Copy | `assignment_copy_strategy.py` | 作業副本策略 |
| Input Sanitizer | `input_sanitizer.py` | Prompt injection 防護 |
| User Service | `user_service.py` | 用戶 CRUD |
| Lesson Loader | `lesson_loader.py` | YAML 課文載入 |
| Persona | `persona.py` | AI 人格設定 |

---

## 4. 資料庫設計

### 4.1 ER 圖（簡化版）

```
Organization ──1:N──▶ School ──1:N──▶ Classroom ──N:M──▶ Student (User)
                                          │                    │
                                     classroom_texts      learning_sessions
                                          │                    │
                                         Text          character_errors
                                          │            dialogue_turns
                                     assignments
                                          │
                                     submissions
```

### 4.2 資料表

| 表名 | 說明 | 主要欄位 |
|------|------|----------|
| `users` | 統一用戶（教師/學生/家長/管理員） | email, hashed_password, display_name, google_id |
| `user_roles` | RBAC 角色 | user_id, role_name, scope_type, scope_id |
| `organizations` | 組織 | name, code |
| `schools` | 學校 | name, organization_id |
| `classrooms` | 班級 | name, school_id, grade, invite_code |
| `classroom_students` | 班級-學生關聯 | classroom_id, student_id |
| `classroom_teachers` | 班級-教師關聯 | classroom_id, teacher_id |
| `texts` | 課文（平台 + 教師自建） | title, paragraphs(JSON), vocabulary(JSON), visibility, grade |
| `classroom_texts` | 班級-課文指派 | classroom_id, text_id, copyright_confirmed |
| `learning_sessions` | 學習記錄 | student_id, text_id, status, current_step, reading_result(JSONB) |
| `character_errors` | 錯字記錄 | session_id, character, error_type |
| `dialogue_turns` | 對話紀錄 | session_id, role, content, understood |
| `assignments` | 作業 | classroom_id, text_id, title, due_date, is_active |
| `assignment_submissions` | 作業提交 | assignment_id, student_id, status, score |
| `gamification_profiles` | 遊戲化 | user_id, total_xp, level, current_streak |
| `achievements` | 成就解鎖 | user_id, achievement_type, unlocked_at |
| `points_log` | XP 紀錄 | user_id, points, reason, session_id |
| `student_tags` | 學生標籤 | student_id, classroom_id, tag_name, color |
| `teacher_instructions` | 教學指示 | teacher_id, student_id, text_id, instruction |
| `parent_links` | 家長-學生關聯 | parent_id, student_id, invite_code |
| `notification_reads` | 通知已讀 | user_id, notification_type, notification_id |
| `feedback` | 使用者回饋 | user_id, category, content, status |
| `dictionary_cache` | 字典快取 | word, definition_json |

### 4.3 Migration

使用 Alembic 管理 DB schema 變更。CI/CD 通過 `RUN_MIGRATIONS=true` 環境變數控制是否在部署時執行 migration。

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
| Vertex AI | Gemini 2.5 Flash | us-central1 | AI 模型 |

### 5.2 CI/CD Pipeline

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
| `preview-deploy.yml` | PR opened/updated/closed | PR Preview (ephemeral) |

**變更偵測**: `backend/**` 變更 → rebuild backend; `frontend/**` 變更 → rebuild frontend

**Image cleanup**: 4 層防護（GCP policy + deploy/staging/preview 各自清理）

---

## 6. 安全性

### 6.1 驗證與授權

| 項目 | 實作 |
|------|------|
| 使用者驗證 | JWT (HS256) + bcrypt 密碼雜湊 |
| Google OAuth | Google Sign-In → 後端驗證 → JWT |
| API 授權 | RBAC — 8 角色（super_admin, org_admin, school_admin, teacher, student, parent, observer, support） |
| Scope-based | 每個角色有 scope_type（global/org/school/classroom）+ scope_id |
| AI API | Vertex AI service account（自動驗證） |
| Prompt injection | `input_sanitizer.py` 過濾惡意 prompt |
| 安全掃描 | CI 整合 npm audit + pip-audit (#273) |

### 6.2 輸入驗證

- Pydantic V2 model 驗證所有 API 輸入
- `student_answer`: max_length=500
- `search`: max_length=100
- AI 輸入經過 sanitizer 過濾

### 6.3 Rate Limiting

- Socratic session: 30 requests/minute/session
- 全局 rate limiting: 待實作

---

## 7. 測試

| 類型 | 工具 | 數量 | 說明 |
|------|------|------|------|
| Unit/Integration | pytest | 257+ | 後端 API + 服務測試 |
| E2E | Playwright | 87 | 全流程瀏覽器測試 |
| Load | Locust | - | 30 concurrent users 壓測 |
| Security | npm audit + pip-audit | CI | 每次 PR 自動掃描 |

---

## 8. 監控

- Cloud Run 內建 metrics
- `/api/health` — 基本健康檢查
- `/api/health/detailed` — DB + AI 連線狀態
- GA4 Analytics 追蹤學習事件 (#246)
- Production 部署腳本含自動健康檢查 (#29)

---

## 9. 文件交叉引用

| 文件 | 關聯 |
|------|------|
| [BRD.md](BRD.md) | 商業目標 → 本文技術方案如何實現 |
| [MRD.md](MRD.md) | 市場需求 → 本文技術選型考量 |
| [PRD.md](PRD.md) | 產品功能 → 本文 API 端點 + DB schema |
| [TECHNICAL_DECISION.md](TECHNICAL_DECISION.md) | 技術決策紀錄（本文的詳細補充） |
| [PRD-SCHOOL-CLASS-STUDENT.md](PRD-SCHOOL-CLASS-STUDENT.md) | 學校班級學生資料模型（原 DATABASE_SCHEMA.md 已整併至 TRD §4） |

---

*TRD v2.0 | 2026-03-12 | 基於 codebase 實際狀態更新*
