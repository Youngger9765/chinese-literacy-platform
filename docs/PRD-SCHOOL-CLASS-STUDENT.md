# PRD - 學校/班級/教師/學生管理系統

> Product Requirements Document — School/Class/Teacher/Student Management
> Version 1.0 | 2026-02-27

---

## 1. 執行摘要

### 產品概述

本文件定義 LingoLeap 國語文閱讀學習平台的**後台管理系統**（學校/班級/教師/學生管理）。目前平台已完成前台學生自學模式 MVP（六步驟學習流程），但所有教師端、帳號系統、學習歷程持久化功能完全缺失。本系統是將 LingoLeap 從「Demo 產品」推向「可用產品」的關鍵基礎設施。

### 範圍

- 帳號認證系統（教師登入 + 學生登入）
- 學校/班級/教師/學生 CRUD 管理
- CSV 批量匯入學生名單
- 課文指派系統
- 學習歷程持久化與查詢
- 教師儀表板與班級報表
- 班級表現矩陣（熱力圖）

### 不在範圍內

- 組織（Organization）層級管理（初期不需要）
- 訂閱/計費系統
- 家長端
- OAuth/SSO（Phase 2+）
- 通知中心（未來 Issue）

### 時程概覽

| 階段 | 時程 | 內容 | 依賴 |
|------|------|------|------|
| Phase 1 | Week 1-3 | 前端 Mock Data + Layout + 路由 | 無（可立即開始） |
| Phase 2 | Week 3-5 | Auth + DB Schema | Phase 1 layout 完成 |
| Phase 3 | Week 5-8 | Backend CRUD APIs + CSV 匯入 | Phase 2 auth 完成 |
| Phase 4 | Week 8-12 | 學習歷程持久化 + 報表 + 熱力圖 | Phase 3 CRUD 完成 |

### 相關 GitHub Issues

| Issue | 標題 | Phase |
|-------|------|-------|
| #82 | 教師/學生帳號系統 | Phase 2 |
| #18 | SQLAlchemy 多租戶權限 Middleware | Phase 2 |
| #19 | 學校+班級管理介面 | Phase 3 |
| #20 | 教師管理+課文指派 | Phase 3 |
| #21 | 學習資料聚合 API | Phase 4 |
| #22 | 教師儀表板+班級報表 | Phase 4 |
| #83 | CSV 學生名單批量匯入 | Phase 3 |
| #84 | 課文目標設定 | Phase 3 |
| #87 | 班級表現矩陣 | Phase 4 |
| #171 | 學習紀錄持久化 | Phase 4 |

---

## 2. 角色定義

### 2.1 系統管理員（System Admin）

| 屬性 | 說明 |
|------|------|
| 角色代碼 | `system_admin` |
| 描述 | LingoLeap 團隊內部管理人員 |
| 數量 | 1-3 人 |
| 權限 | 管理所有學校、教師、學生；查看全平台統計；系統設定 |
| 認證方式 | Email + Password（後端直接建立，不開放註冊） |

**可執行操作**：
- 建立/編輯/停用學校
- 指定學校管理員
- 查看全平台使用統計
- 管理系統課文庫（57 篇 YAML 課文）
- 匯出全平台報表

### 2.2 學校管理員（School Admin）

| 屬性 | 說明 |
|------|------|
| 角色代碼 | `school_admin` |
| 描述 | 學校教務主任或資訊組長 |
| 數量 | 每校 1-2 人 |
| 權限 | 管理本校所有班級、教師、學生 |
| 認證方式 | Email + Password |

**可執行操作**：
- 管理本校教師（邀請、停用）
- 管理本校所有班級
- 查看本校所有學生
- 查看本校使用統計
- CSV 批量匯入學生
- 設定學校基本資料

**限制**：
- 只能看到自己學校的資料
- 不能修改其他學校的資料

### 2.3 教師（Teacher）

| 屬性 | 說明 |
|------|------|
| 角色代碼 | `teacher` |
| 描述 | 國小/國中國語文教師 |
| 技術能力 | 基本電腦操作，Google Classroom 使用者水準 |
| 權限 | 管理自己的班級和學生、指派課文、查看學習報表 |
| 認證方式 | Email + Password |

**可執行操作**：
- 建立/編輯自己的班級
- 新增/編輯學生（手動 + CSV 匯入）
- 指派課文給班級或個別學生
- 設定課文目標（語速、正確率）
- 查看班級學習進度
- 查看學生個別報告
- 查看班級表現矩陣

**限制**：
- 只能看到自己班級的學生資料
- 不能修改其他教師的班級
- 學校管理員可授權教師查看全校數據

### 2.4 學生（Student）

| 屬性 | 說明 |
|------|------|
| 角色代碼 | `student` |
| 描述 | 國小三年級～國中生 |
| 技術能力 | 會使用平板/電腦，點擊、錄音 |
| 權限 | 完成學習任務、查看自己的學習紀錄 |
| 認證方式 | 學號（數字 ID）+ 密碼 |

**可執行操作**：
- 查看教師指派的課文
- 完成六步驟學習流程
- 查看自己的學習歷程與進步曲線
- 修改密碼

**設計考量**：
- 國小學生通常沒有 Email，因此使用**學號 + 密碼**登入
- 預設密碼 = 生日 YYYYMMDD（與 Duotopia 相同設計）
- 首次登入強制修改密碼（可選）
- 介面需要大字體、大按鈕、清楚提示

### 2.5 角色權限矩陣

| 操作 | system_admin | school_admin | teacher | student |
|------|:---:|:---:|:---:|:---:|
| 建立學校 | O | - | - | - |
| 編輯學校設定 | O | O（本校） | - | - |
| 管理教師 | O | O（本校） | - | - |
| 建立班級 | O | O（本校） | O（自己的） | - |
| 管理班級學生 | O | O（本校） | O（自己的） | - |
| CSV 匯入學生 | O | O（本校） | O（自己的） | - |
| 指派課文 | O | O（本校） | O（自己的） | - |
| 設定學習目標 | O | O（本校） | O（自己的） | - |
| 查看學習報表 | O（全平台） | O（本校） | O（自己的班級） | O（自己的） |
| 完成學習任務 | - | - | - | O |
| 修改自己密碼 | O | O | O | O |

---

## 3. 資料模型

### 3.1 ER 圖（文字格式）

```
┌─────────────┐       ┌─────────────────┐       ┌──────────────┐
│   schools    │──1:N──│    teachers      │──1:N──│  classrooms   │
│             │       │                 │       │              │
│ id (PK)     │       │ id (PK)         │       │ id (PK)      │
│ name        │       │ school_id (FK)  │       │ school_id(FK)│
│ address     │       │ email           │       │ teacher_id(FK│
│ join_code   │       │ password_hash   │       │ name         │
│ admin_id(FK)│       │ name            │       │ grade        │
│ is_active   │       │ phone           │       │ academic_year│
│ created_at  │       │ role            │       │ join_code    │
│ updated_at  │       │ is_active       │       │ is_active    │
└─────────────┘       │ created_at      │       │ created_at   │
                      └─────────────────┘       └──────┬───────┘
                                                       │
                                                       │ N:M
                                                       │
┌──────────────────────┐       ┌───────────────────────┤
│  classroom_students  │       │                       │
│                      │       │     ┌─────────────────┴──┐
│ id (PK)              │       │     │     students        │
│ classroom_id (FK) ───┘       │     │                     │
│ student_id (FK) ─────────────┘     │ id (PK)             │
│ enrolled_at                        │ name                │
│ is_active                          │ student_number      │
└──────────────────────┘             │ birthdate           │
                                     │ password_hash       │
                                     │ password_changed    │
                                     │ school_id (FK)      │
                                     │ is_active           │
                                     │ created_at          │
                                     └─────────┬───────────┘
                                               │
                                               │ 1:N
                                               │
                    ┌──────────────────────────┐│
                    │    learning_sessions     ││
                    │                          ││
                    │ id (PK)                  ││
                    │ student_id (FK) ─────────┘│
                    │ story_id (VARCHAR)         │
                    │ assignment_id (FK, null)   │
                    │ started_at                 │
                    │ completed_at               │
                    │ current_step               │
                    │ reading_attempt (JSONB)     │
                    │ comprehension_result(JSONB) │
                    │ vocab_result (JSONB)        │
                    │ full_reading_result (JSONB) │
                    │ created_at                  │
                    └──────────────────────────┘
                                │
                                │ 1:N
                                │
                    ┌───────────┴──────────────┐
                    │    character_errors       │
                    │                          │
                    │ id (PK)                  │
                    │ session_id (FK)          │
                    │ character                │
                    │ error_type               │
                    └──────────────────────────┘


┌──────────────────────┐       ┌──────────────────────────┐
│    assignments       │──1:N──│   student_assignments    │
│                      │       │                          │
│ id (PK)              │       │ id (PK)                  │
│ classroom_id (FK)    │       │ assignment_id (FK)       │
│ teacher_id (FK)      │       │ student_id (FK)          │
│ story_id (VARCHAR)   │       │ status                   │
│ title                │       │ best_accuracy            │
│ instructions         │       │ best_cpm                 │
│ due_date             │       │ attempts_count           │
│ target_accuracy      │       │ completed_at             │
│ target_cpm           │       │ created_at               │
│ settings (JSONB)     │       │ updated_at               │
│ is_active            │       └──────────────────────────┘
│ created_at           │
│ updated_at           │
└──────────────────────┘
```

### 3.2 資料表定義

#### schools（學校）

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | SERIAL | PK | 自增主鍵 |
| name | VARCHAR(200) | NOT NULL | 學校名稱（例：「台東縣桃源國小」） |
| address | VARCHAR(500) | NULL | 學校地址 |
| phone | VARCHAR(20) | NULL | 學校電話 |
| admin_teacher_id | INT | FK → teachers.id, NULL | 學校管理員教師 ID |
| join_code | VARCHAR(10) | UNIQUE, NULL | 學校加入代碼（例：SC-8294） |
| is_active | BOOLEAN | DEFAULT TRUE | 是否啟用 |
| created_at | TIMESTAMP | DEFAULT NOW() | 建立時間 |
| updated_at | TIMESTAMP | DEFAULT NOW() | 更新時間 |

#### teachers（教師）

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | SERIAL | PK | 自增主鍵 |
| school_id | INT | FK → schools.id, NOT NULL | 所屬學校 |
| email | VARCHAR(254) | UNIQUE, NOT NULL | 登入 Email |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt 雜湊密碼 |
| name | VARCHAR(100) | NOT NULL | 教師姓名 |
| phone | VARCHAR(20) | NULL | 手機號碼 |
| role | VARCHAR(20) | NOT NULL, DEFAULT 'teacher' | 角色：system_admin / school_admin / teacher |
| is_active | BOOLEAN | DEFAULT TRUE | 是否啟用 |
| email_verified | BOOLEAN | DEFAULT FALSE | Email 是否已驗證 |
| created_at | TIMESTAMP | DEFAULT NOW() | 建立時間 |
| updated_at | TIMESTAMP | DEFAULT NOW() | 更新時間 |

**索引**：
- `UNIQUE(email)`
- `INDEX(school_id)`
- `INDEX(role)`

#### classrooms（班級）

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | SERIAL | PK | 自增主鍵 |
| school_id | INT | FK → schools.id, NOT NULL | 所屬學校 |
| teacher_id | INT | FK → teachers.id, NULL | 導師/負責教師 |
| name | VARCHAR(100) | NOT NULL | 班級名稱（例：「五年甲班」） |
| grade | INT | NULL | 年級（3-9） |
| academic_year | VARCHAR(10) | NOT NULL | 學年度（例：「114-2」） |
| join_code | VARCHAR(10) | UNIQUE, NULL | 班級加入代碼（例：LC-4829） |
| is_active | BOOLEAN | DEFAULT TRUE | 是否啟用 |
| created_at | TIMESTAMP | DEFAULT NOW() | 建立時間 |
| updated_at | TIMESTAMP | DEFAULT NOW() | 更新時間 |

**索引**：
- `INDEX(school_id)`
- `INDEX(teacher_id)`
- `UNIQUE(join_code)`

**命名慣例**：使用 `classrooms` 而非 `classes`，避免與 Python/SQL 關鍵字衝突。

#### students（學生）

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | SERIAL | PK | 自增主鍵 |
| school_id | INT | FK → schools.id, NOT NULL | 所屬學校 |
| name | VARCHAR(100) | NOT NULL | 學生姓名 |
| student_number | VARCHAR(20) | NOT NULL | 學號（校內唯一） |
| birthdate | DATE | NOT NULL | 生日（作為預設密碼 YYYYMMDD） |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt 雜湊密碼 |
| password_changed | BOOLEAN | DEFAULT FALSE | 是否已修改預設密碼 |
| email | VARCHAR(254) | NULL | Email（選填，國小生通常沒有） |
| is_active | BOOLEAN | DEFAULT TRUE | 是否啟用 |
| created_at | TIMESTAMP | DEFAULT NOW() | 建立時間 |
| updated_at | TIMESTAMP | DEFAULT NOW() | 更新時間 |

**索引**：
- `UNIQUE(school_id, student_number)` — 學號在校內唯一
- `INDEX(school_id)`

**預設密碼規則**：
- 建立學生時，`password_hash = bcrypt(birthdate.strftime('%Y%m%d'))`
- 例如生日 2015-03-14 → 預設密碼 `20150314`
- `password_changed = False` 直到學生自行修改

#### classroom_students（班級學生關聯）

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | SERIAL | PK | 自增主鍵 |
| classroom_id | INT | FK → classrooms.id, NOT NULL | 班級 ID |
| student_id | INT | FK → students.id, NOT NULL | 學生 ID |
| enrolled_at | TIMESTAMP | DEFAULT NOW() | 加入時間 |
| is_active | BOOLEAN | DEFAULT TRUE | 是否在班 |

**索引**：
- `UNIQUE(classroom_id, student_id)` — 防止重複加入

#### learning_sessions（學習記錄）

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | SERIAL | PK | 自增主鍵 |
| student_id | INT | FK → students.id, NOT NULL | 學生 ID |
| story_id | VARCHAR(100) | NOT NULL | 課文 ID（對應 YAML filename） |
| assignment_id | INT | FK → assignments.id, NULL | 所屬指派（若有） |
| current_step | INT | NOT NULL, DEFAULT 1 | 目前步驟（1-6） |
| started_at | TIMESTAMP | NOT NULL | 開始時間 |
| completed_at | TIMESTAMP | NULL | 完成時間 |
| reading_attempt | JSONB | NULL | 逐段朗讀結果 |
| comprehension_result | JSONB | NULL | 課文理解結果 |
| vocab_result | JSONB | NULL | 生字練習結果 |
| full_reading_result | JSONB | NULL | 全文朗讀結果 |
| created_at | TIMESTAMP | DEFAULT NOW() | 建立時間 |

**JSONB 欄位結構**：

```jsonc
// reading_attempt
{
  "accuracy": 85.5,
  "cpm": 142,
  "fluency": 78.3,
  "mispronouncedWords": ["清", "晴"],
  "transcription": "大自然的線索...",
  "lineBreakdown": [
    {
      "lineIndex": 0,
      "matchRate": 92.0,
      "cpm": 150,
      "transcript": "...",
      "diffTokens": [...]
    }
  ]
}

// comprehension_result
{
  "understoodCount": 4,
  "requiredCount": 5,
  "isComplete": true,
  "conversationLength": 12
}

// vocab_result
{
  "practicedChars": ["清", "晴"],
  "totalChars": 5
}

// full_reading_result
{
  "matchRate": 88.5,
  "cpm": 155,
  "durationMs": 45000,
  "feedback": "做得很好！",
  "errorBreakdown": { "correct": 85, "wrong": 8, "missing": 3, "extra": 2 },
  "diffTokens": [...],
  "transcript": "..."
}
```

**索引**：
- `INDEX(student_id)`
- `INDEX(story_id)`
- `INDEX(assignment_id)`
- `INDEX(started_at DESC)`

#### character_errors（錯字記錄）

保留現有 schema，新增索引。

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | SERIAL | PK | 自增主鍵 |
| session_id | INT | FK → learning_sessions.id, NOT NULL | 學習記錄 ID |
| character | VARCHAR(4) | NOT NULL | 錯誤的字 |
| error_type | VARCHAR(50) | NOT NULL | 錯誤類型：wrong / missing / extra |

**索引**：
- `INDEX(session_id)`
- `INDEX(character)` — 用於統計錯字頻率

#### assignments（課文指派）

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | SERIAL | PK | 自增主鍵 |
| classroom_id | INT | FK → classrooms.id, NOT NULL | 指派的班級 |
| teacher_id | INT | FK → teachers.id, NOT NULL | 指派的教師 |
| story_id | VARCHAR(100) | NOT NULL | 課文 ID |
| title | VARCHAR(200) | NOT NULL | 指派標題（預設填入課文標題） |
| instructions | TEXT | NULL | 教師備註/特殊指示 |
| due_date | DATE | NULL | 截止日期 |
| target_accuracy | FLOAT | NULL | 目標正確率（例：85.0） |
| target_cpm | FLOAT | NULL | 目標語速（例：150.0） |
| settings | JSONB | DEFAULT '{}' | 額外設定 |
| is_active | BOOLEAN | DEFAULT TRUE | 是否啟用 |
| created_at | TIMESTAMP | DEFAULT NOW() | 建立時間 |
| updated_at | TIMESTAMP | DEFAULT NOW() | 更新時間 |

**settings JSONB 結構**：
```jsonc
{
  "allowRetry": true,          // 允許重試
  "maxAttempts": null,         // 最大嘗試次數（null = 無限）
  "showAnswerAfter": 3,        // N 次嘗試後顯示提示
  "requireAllSteps": true      // 是否要求完成全部六步驟
}
```

**索引**：
- `INDEX(classroom_id)`
- `INDEX(teacher_id)`
- `INDEX(due_date)`

#### student_assignments（學生指派進度）

| 欄位 | 型別 | 約束 | 說明 |
|------|------|------|------|
| id | SERIAL | PK | 自增主鍵 |
| assignment_id | INT | FK → assignments.id, NOT NULL | 指派 ID |
| student_id | INT | FK → students.id, NOT NULL | 學生 ID |
| status | VARCHAR(20) | NOT NULL, DEFAULT 'pending' | 狀態：pending / in_progress / completed |
| best_accuracy | FLOAT | NULL | 最佳正確率 |
| best_cpm | FLOAT | NULL | 最佳語速 |
| attempts_count | INT | DEFAULT 0 | 嘗試次數 |
| completed_at | TIMESTAMP | NULL | 完成時間 |
| created_at | TIMESTAMP | DEFAULT NOW() | 建立時間 |
| updated_at | TIMESTAMP | DEFAULT NOW() | 更新時間 |

**索引**：
- `UNIQUE(assignment_id, student_id)`
- `INDEX(student_id)`
- `INDEX(status)`

### 3.3 與現有 Schema 的遷移計畫

目前 `backend/app/models/` 已有基本 schema（School, Teacher, Class, Student, LearningSession, CharacterError），但欄位不完整。遷移策略：

| 現有 Model | 變更 |
|------------|------|
| `School` | 新增 address, phone, admin_teacher_id, join_code, is_active, timestamps |
| `Teacher` | 新增 password_hash, phone, role, is_active, email_verified, timestamps |
| `Class` → `Classroom` | 重命名為 Classroom；新增 school_id, grade, academic_year, join_code, is_active, timestamps |
| `ClassStudent` → `ClassroomStudent` | 重命名；新增 enrolled_at, is_active |
| `Student` | 新增 school_id, student_number, birthdate, password_hash, password_changed, email, is_active, timestamps |
| `LearningSession` | 新增 assignment_id, started_at, reading_attempt(JSONB), comprehension_result(JSONB), vocab_result(JSONB), full_reading_result(JSONB) |
| `CharacterError` | 保持不變，新增索引 |
| 新增 `Assignment` | 全新 |
| 新增 `StudentAssignment` | 全新 |

---

## 4. API 設計

### 4.1 認證（Auth）

所有 API（除登入/註冊外）需在 Header 帶 `Authorization: Bearer <JWT>`。

**JWT 規格**：
- 演算法：HS256
- 過期時間：24 小時
- Payload：`{ sub: <user_id>, role: <role>, school_id: <school_id>, type: "teacher"|"student" }`
- 密碼雜湊：bcrypt（cost factor 12）

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/teacher/register` | - | 教師註冊 |
| POST | `/api/auth/teacher/login` | - | 教師登入 |
| POST | `/api/auth/student/login` | - | 學生登入（學號+密碼） |
| POST | `/api/auth/refresh` | Bearer | 刷新 JWT |
| POST | `/api/auth/password/reset-request` | - | 申請密碼重設（教師） |
| POST | `/api/auth/password/reset` | - | 執行密碼重設（帶 token） |
| PUT | `/api/auth/password/change` | Bearer | 修改密碼（教師/學生） |

#### POST `/api/auth/teacher/register`

```json
// Request
{
  "email": "wang@school.edu.tw",
  "password": "SecurePass123",
  "name": "王老師",
  "phone": "0912345678",         // optional
  "school_name": "桃源國小",      // 新建學校
  "school_id": null               // 或加入已有學校
}

// Response 201
{
  "id": 1,
  "email": "wang@school.edu.tw",
  "name": "王老師",
  "role": "school_admin",
  "school": { "id": 1, "name": "桃源國小" },
  "token": "eyJhbG..."
}
```

**註冊邏輯**：
- 若提供 `school_name`（新建學校），該教師自動成為 `school_admin`
- 若提供 `school_id`（加入已有學校），角色為 `teacher`，需學校管理員審核
- 密碼規則：>= 8 字元，至少包含英文+數字

#### POST `/api/auth/student/login`

```json
// Request
{
  "school_id": 1,
  "student_number": "110001",
  "password": "20150314"
}

// Response 200
{
  "id": 42,
  "name": "小明",
  "school": { "id": 1, "name": "桃源國小" },
  "classrooms": [
    { "id": 5, "name": "五年甲班", "teacher_name": "王老師" }
  ],
  "password_changed": false,
  "token": "eyJhbG..."
}
```

### 4.2 學校管理（Schools）

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/schools` | system_admin | 列出所有學校 |
| POST | `/api/schools` | system_admin | 建立學校 |
| GET | `/api/schools/{id}` | school_admin+ | 取得學校詳情 |
| PUT | `/api/schools/{id}` | school_admin+ | 更新學校資訊 |
| DELETE | `/api/schools/{id}` | system_admin | 停用學校 |
| GET | `/api/schools/{id}/stats` | school_admin+ | 學校使用統計 |

#### GET `/api/schools/{id}/stats`

```json
// Response 200
{
  "school_id": 1,
  "school_name": "桃源國小",
  "teacher_count": 8,
  "classroom_count": 12,
  "student_count": 324,
  "active_students_7d": 186,
  "total_sessions": 4521,
  "avg_accuracy": 82.3,
  "avg_cpm": 138.5
}
```

### 4.3 班級管理（Classrooms）

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/classrooms` | teacher+ | 列出教師的班級（teacher 只看自己的，admin 看全校） |
| POST | `/api/classrooms` | teacher+ | 建立班級 |
| GET | `/api/classrooms/{id}` | teacher+ | 取得班級詳情（含學生名單） |
| PUT | `/api/classrooms/{id}` | teacher+ | 更新班級資訊 |
| DELETE | `/api/classrooms/{id}` | teacher+ | 停用班級 |
| GET | `/api/classrooms/{id}/students` | teacher+ | 取得班級學生名單 |
| POST | `/api/classrooms/{id}/students` | teacher+ | 新增學生到班級 |
| DELETE | `/api/classrooms/{id}/students/{student_id}` | teacher+ | 移除學生出班級 |
| GET | `/api/classrooms/{id}/stats` | teacher+ | 班級統計摘要 |
| GET | `/api/classrooms/{id}/matrix` | teacher+ | 班級表現矩陣（#87） |

#### POST `/api/classrooms`

```json
// Request
{
  "name": "五年甲班",
  "grade": 5,
  "academic_year": "114-2"
}

// Response 201
{
  "id": 5,
  "name": "五年甲班",
  "grade": 5,
  "academic_year": "114-2",
  "join_code": "LC-4829",
  "teacher": { "id": 1, "name": "王老師" },
  "student_count": 0,
  "created_at": "2026-02-27T10:00:00Z"
}
```

#### GET `/api/classrooms/{id}/matrix`

班級表現矩陣（學生 x 課文熱力圖，#87）。

```json
// Response 200
{
  "classroom_id": 5,
  "students": [
    { "id": 42, "name": "小明", "student_number": "110001" },
    { "id": 43, "name": "小華", "student_number": "110002" }
  ],
  "stories": [
    { "id": "nature-clues", "title": "大自然的線索" },
    { "id": "jade-mountain", "title": "玉山之美" }
  ],
  "matrix": {
    "42": {
      "nature-clues": { "best_accuracy": 88.5, "best_cpm": 155, "attempts": 3, "status": "completed" },
      "jade-mountain": { "best_accuracy": null, "best_cpm": null, "attempts": 0, "status": "pending" }
    },
    "43": {
      "nature-clues": { "best_accuracy": 72.0, "best_cpm": 120, "attempts": 5, "status": "needs_attention" },
      "jade-mountain": { "best_accuracy": 91.0, "best_cpm": 162, "attempts": 2, "status": "completed" }
    }
  }
}
```

**status 判定邏輯**：
- `completed`：最佳成績達標（accuracy >= target 且 cpm >= target）
- `in_progress`：有嘗試但未達標
- `needs_attention`：嘗試 >= 3 次仍未達標，或連續 7 天未練習
- `pending`：尚未嘗試

### 4.4 教師管理（Teachers）

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/teachers/me` | teacher+ | 取得自己的資料 |
| PUT | `/api/teachers/me` | teacher+ | 更新自己的資料 |
| GET | `/api/teachers` | school_admin+ | 列出本校教師 |
| POST | `/api/teachers/invite` | school_admin+ | 邀請教師 |
| PUT | `/api/teachers/{id}/role` | school_admin+ | 修改教師角色 |
| DELETE | `/api/teachers/{id}` | school_admin+ | 停用教師 |

### 4.5 學生管理（Students）

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/students` | teacher+ | 列出教師可見的學生 |
| POST | `/api/students` | teacher+ | 建立單一學生 |
| POST | `/api/students/batch` | teacher+ | CSV 批量匯入（#83） |
| GET | `/api/students/{id}` | teacher+ | 取得學生詳情 |
| PUT | `/api/students/{id}` | teacher+ | 更新學生資料 |
| DELETE | `/api/students/{id}` | school_admin+ | 停用學生 |
| GET | `/api/students/{id}/progress` | teacher+ | 學生學習歷程 |
| GET | `/api/students/{id}/error-frequency` | teacher+ | 學生錯字頻率統計 |

#### POST `/api/students`

```json
// Request
{
  "name": "小明",
  "student_number": "110001",
  "birthdate": "2015-03-14",
  "classroom_id": 5,
  "email": null
}

// Response 201
{
  "id": 42,
  "name": "小明",
  "student_number": "110001",
  "birthdate": "2015-03-14",
  "school_id": 1,
  "classrooms": [{ "id": 5, "name": "五年甲班" }],
  "default_password_hint": "生日八碼（YYYYMMDD）",
  "created_at": "2026-02-27T10:00:00Z"
}
```

#### POST `/api/students/batch`

CSV 批量匯入（#83）。

```
// Request (multipart/form-data)
file: students.csv
classroom_id: 5
duplicate_action: "skip"  // skip | update | error
```

**CSV 格式**：
```csv
姓名,學號,生日,Email
小明,110001,2015-03-14,
小華,110002,2015-06-22,xiaohua@mail.com
小美,110003,2015-01-08,
```

```json
// Response 200
{
  "total": 30,
  "created": 28,
  "skipped": 1,
  "updated": 0,
  "errors": [
    { "row": 15, "field": "birthdate", "value": "2015/13/01", "message": "日期格式錯誤，請使用 YYYY-MM-DD" }
  ]
}
```

#### GET `/api/students/{id}/progress`

```json
// Response 200
{
  "student_id": 42,
  "student_name": "小明",
  "total_sessions": 15,
  "total_stories_attempted": 8,
  "avg_accuracy": 82.3,
  "avg_cpm": 142.0,
  "accuracy_trend": [75.0, 78.5, 80.0, 82.0, 85.5, 88.0],
  "cpm_trend": [110, 118, 125, 135, 142, 155],
  "recent_sessions": [
    {
      "id": 101,
      "story_id": "nature-clues",
      "story_title": "大自然的線索",
      "started_at": "2026-02-27T14:00:00Z",
      "completed_at": "2026-02-27T14:25:00Z",
      "accuracy": 88.5,
      "cpm": 155,
      "comprehension_understood": 4,
      "comprehension_required": 5
    }
  ],
  "error_frequency": [
    { "character": "清", "count": 5, "error_type": "wrong" },
    { "character": "晴", "count": 3, "error_type": "wrong" },
    { "character": "的", "count": 2, "error_type": "missing" }
  ]
}
```

### 4.6 課文指派（Assignments）

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/assignments` | teacher+ | 列出教師的指派 |
| POST | `/api/assignments` | teacher+ | 建立指派（#20） |
| GET | `/api/assignments/{id}` | teacher+ | 取得指派詳情（含學生進度） |
| PUT | `/api/assignments/{id}` | teacher+ | 更新指派 |
| DELETE | `/api/assignments/{id}` | teacher+ | 取消指派 |
| GET | `/api/assignments/{id}/progress` | teacher+ | 指派完成進度 |

#### POST `/api/assignments`

```json
// Request
{
  "classroom_id": 5,
  "story_id": "nature-clues",
  "title": "第三課：大自然的線索",
  "instructions": "請注意『清』和『晴』的差別",
  "due_date": "2026-03-15",
  "target_accuracy": 85.0,
  "target_cpm": 140.0,
  "settings": {
    "allowRetry": true,
    "requireAllSteps": true
  }
}

// Response 201
{
  "id": 10,
  "classroom_id": 5,
  "story_id": "nature-clues",
  "title": "第三課：大自然的線索",
  "due_date": "2026-03-15",
  "target_accuracy": 85.0,
  "target_cpm": 140.0,
  "student_count": 28,
  "created_at": "2026-02-27T10:00:00Z"
}
```

**指派建立時自動**：
- 為班級中每位 `is_active` 學生建立 `student_assignments` 記錄（status='pending'）
- 若後續有新學生加入班級，也自動建立該指派的 `student_assignment`

### 4.7 學習記錄（Learning Sessions）

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/learning-sessions` | student | 建立學習記錄（開始學習） |
| PUT | `/api/learning-sessions/{id}` | student | 更新學習記錄（每步驟完成時） |
| GET | `/api/learning-sessions/{id}` | student/teacher | 取得學習記錄詳情 |
| GET | `/api/learning-sessions` | student | 列出自己的學習記錄 |

#### POST `/api/learning-sessions`

```json
// Request
{
  "story_id": "nature-clues",
  "assignment_id": 10        // optional
}

// Response 201
{
  "id": 101,
  "student_id": 42,
  "story_id": "nature-clues",
  "assignment_id": 10,
  "current_step": 1,
  "started_at": "2026-02-27T14:00:00Z"
}
```

#### PUT `/api/learning-sessions/{id}`

逐步更新。前端在每個步驟完成時呼叫此 API。

```json
// Request (step 2 完成時)
{
  "current_step": 3,
  "reading_attempt": {
    "accuracy": 88.5,
    "cpm": 155,
    "mispronouncedWords": ["清", "晴"],
    "transcription": "...",
    "lineBreakdown": [...]
  }
}

// Request (step 6 完成時)
{
  "current_step": 6,
  "completed_at": "2026-02-27T14:25:00Z",
  "full_reading_result": {
    "matchRate": 92.0,
    "cpm": 162,
    "durationMs": 42000,
    "feedback": "...",
    "errorBreakdown": { ... }
  }
}
```

### 4.8 報表與統計（Reports）

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/reports/classroom/{id}/summary` | teacher+ | 班級統計摘要（#22） |
| GET | `/api/reports/classroom/{id}/stories` | teacher+ | 班級各課文統計 |
| GET | `/api/reports/student/{id}/summary` | teacher+ | 學生統計摘要 |
| GET | `/api/reports/classroom/{id}/alerts` | teacher+ | 需關注學生清單 |
| GET | `/api/reports/export/classroom/{id}` | teacher+ | 匯出班級報表（CSV） |

#### GET `/api/reports/classroom/{id}/summary`

```json
// Response 200
{
  "classroom_id": 5,
  "classroom_name": "五年甲班",
  "period": { "from": "2026-02-01", "to": "2026-02-27" },
  "student_count": 28,
  "active_count_7d": 22,
  "total_sessions": 186,
  "avg_accuracy": 82.3,
  "avg_cpm": 138.5,
  "accuracy_distribution": {
    "excellent": 8,    // >= 90%
    "good": 12,        // >= 75%
    "needs_work": 6,   // >= 60%
    "struggling": 2    // < 60%
  },
  "top_errors": [
    { "character": "清", "total_count": 23, "student_count": 12 },
    { "character": "晴", "total_count": 18, "student_count": 9 },
    { "character": "的", "total_count": 15, "student_count": 14 }
  ],
  "weekly_activity": [
    { "week": "W09", "sessions": 42, "avg_accuracy": 80.1 },
    { "week": "W10", "sessions": 51, "avg_accuracy": 83.2 }
  ]
}
```

#### GET `/api/reports/classroom/{id}/alerts`

```json
// Response 200
{
  "classroom_id": 5,
  "alerts": [
    {
      "student_id": 45,
      "student_name": "小偉",
      "type": "inactive",
      "message": "已超過 7 天未練習",
      "last_activity": "2026-02-18T10:00:00Z",
      "severity": "warning"
    },
    {
      "student_id": 48,
      "student_name": "小芳",
      "type": "struggling",
      "message": "連續 3 次正確率低於 60%",
      "recent_accuracy": [55.0, 52.3, 58.1],
      "severity": "danger"
    },
    {
      "student_id": 50,
      "student_name": "小傑",
      "type": "stuck_character",
      "message": "「清」字連續 4 次讀錯",
      "character": "清",
      "error_count": 4,
      "severity": "warning"
    }
  ]
}
```

### 4.9 學生端 API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/student/me` | student | 取得自己的資料 |
| GET | `/api/student/assignments` | student | 取得待完成的指派 |
| GET | `/api/student/history` | student | 取得學習歷史 |
| GET | `/api/student/progress` | student | 取得自己的進步數據 |

---

## 5. 前端架構

### 5.1 路由結構

```
/                           → 首頁（角色選擇/重導向）
/login                      → 統一登入頁（教師/學生切換）

/teacher/                   → 教師端根路由（TeacherLayout）
/teacher/dashboard          → 教師儀表板
/teacher/classrooms         → 班級列表
/teacher/classrooms/:id     → 班級詳情（學生名單 + 統計）
/teacher/classrooms/:id/matrix → 班級表現矩陣
/teacher/students/:id       → 學生詳情（學習歷程）
/teacher/assignments        → 課文指派管理
/teacher/assignments/new    → 新增指派
/teacher/settings           → 學校/個人設定
/teacher/import             → CSV 匯入 wizard

/student/                   → 學生端根路由（StudentLayout）
/student/assignments        → 我的任務（教師指派的課文）
/student/library            → 課文圖書館（自由練習）
/student/learn/:storyId     → 六步驟學習流程（現有 App.tsx 邏輯）
/student/history            → 我的學習紀錄
/student/progress           → 我的進步報告

/admin/                     → 系統管理（AdminLayout）
/admin/schools              → 學校管理
/admin/schools/:id          → 學校詳情
/admin/users                → 使用者管理
```

### 5.2 Layout 結構

```
┌────────────────────────────────────────────────────────┐
│  Top Bar (h-12)                                        │
│  [Logo] LingoLeap   [搜尋...]   [通知] [王老師 ▾]     │
├──────────┬─────────────────────────────────────────────┤
│          │                                             │
│ Sidebar  │  Main Content Area                          │
│ (w-60)   │                                             │
│          │  ┌─────────────────────────────────────┐    │
│ Dashboard│  │  Page Header                         │    │
│ 班級管理 │  │  [Breadcrumb] / [Actions]            │    │
│ 課文指派 │  ├─────────────────────────────────────┤    │
│ 學校設定 │  │                                     │    │
│          │  │  Page Content                        │    │
│          │  │                                     │    │
│          │  │                                     │    │
│          │  │                                     │    │
│          │  └─────────────────────────────────────┘    │
│          │                                             │
└──────────┴─────────────────────────────────────────────┘
```

**響應式行為**：
- Desktop (>= 1024px)：Sidebar 固定展開（w-60）
- Tablet (768-1023px)：Sidebar 收合為 icon-only（w-16），hover 展開
- Mobile (< 768px)：Sidebar 隱藏，漢堡選單觸發 overlay

### 5.3 State Management

```
前端狀態分層：

1. Auth State (Zustand store)
   - currentUser: Teacher | Student | null
   - token: string | null
   - role: 'system_admin' | 'school_admin' | 'teacher' | 'student'
   - login() / logout() / refreshToken()

2. Teacher State (React Context: TeacherProvider)
   - classrooms: Classroom[]
   - selectedClassroom: Classroom | null
   - students: Map<classroomId, Student[]>

3. Server State (TanStack Query / SWR)
   - 所有 API 呼叫走 query cache
   - 自動 revalidation
   - Optimistic updates

4. UI State (component-local useState)
   - Modal open/close
   - Form data
   - Tab selection
```

### 5.4 Mock Data 策略（Phase 1）

Phase 1 不依賴後端，使用 Mock 資料開發前端。

```typescript
// frontend/src/mocks/mockData.ts

export const mockSchool: School = {
  id: 1,
  name: '台東縣桃源國小',
  address: '台東縣延平鄉桃源村...',
  teacherCount: 8,
  studentCount: 324,
};

export const mockClassrooms: Classroom[] = [
  { id: 1, name: '五年甲班', grade: 5, studentCount: 28, academicYear: '114-2' },
  { id: 2, name: '五年乙班', grade: 5, studentCount: 26, academicYear: '114-2' },
  { id: 3, name: '六年甲班', grade: 6, studentCount: 30, academicYear: '114-2' },
];

export const mockStudents: Student[] = [
  // 28 students with realistic names, varying performance levels
  { id: 1, name: '陳小明', studentNumber: '110001', accuracy: 88.5, cpm: 155, status: 'normal' },
  { id: 2, name: '林小華', studentNumber: '110002', accuracy: 52.3, cpm: 98, status: 'needs_attention' },
  // ...
];
```

```typescript
// frontend/src/services/mockApi.ts
// Mock API service — same interface as real API, returns mock data with simulated delay

export const mockApi = {
  getClassrooms: async (): Promise<Classroom[]> => {
    await delay(300);
    return mockClassrooms;
  },
  getStudents: async (classroomId: number): Promise<Student[]> => {
    await delay(300);
    return mockStudents.filter(s => s.classroomId === classroomId);
  },
  // ... all API methods
};
```

切換 Mock/Real API 的方式：
```typescript
// frontend/src/services/api.ts
const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

export const api = USE_MOCK ? mockApi : realApi;
```

### 5.5 前端目錄結構

```
frontend/src/
├── App.tsx                          # 現有學習流程（保持不變）
├── main.tsx                         # 新增 Router
├── router.tsx                       # React Router 設定
├── types.ts                         # 現有 types（保持不變）
├── types/
│   ├── auth.ts                      # 認證相關 types
│   ├── school.ts                    # 學校/班級/教師/學生 types
│   └── assignment.ts                # 指派相關 types
├── stores/
│   └── authStore.ts                 # Zustand auth store
├── contexts/
│   └── TeacherContext.tsx            # 教師端 context
├── layouts/
│   ├── TeacherLayout.tsx            # 教師端 layout（sidebar + content）
│   ├── StudentLayout.tsx            # 學生端 layout
│   └── AdminLayout.tsx              # 管理員 layout
├── components/
│   ├── ui/                          # 共用 UI（現有 + 新增）
│   │   ├── Sidebar.tsx
│   │   ├── DataTable.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── StatCard.tsx
│   │   ├── SearchInput.tsx
│   │   └── CSVImportWizard.tsx
│   ├── charts/                      # 圖表元件
│   │   ├── AccuracyTrendChart.tsx
│   │   ├── ActivityHeatmap.tsx
│   │   └── PerformanceMatrix.tsx
│   └── reading-steps/               # 現有六步驟（保持不變）
├── pages/
│   ├── LoginPage.tsx
│   ├── teacher/
│   │   ├── Dashboard.tsx
│   │   ├── ClassroomList.tsx
│   │   ├── ClassroomDetail.tsx
│   │   ├── StudentDetail.tsx
│   │   ├── AssignmentList.tsx
│   │   ├── AssignmentCreate.tsx
│   │   ├── ClassroomMatrix.tsx
│   │   ├── CSVImportPage.tsx
│   │   └── Settings.tsx
│   ├── student/
│   │   ├── MyAssignments.tsx
│   │   ├── LearningHistory.tsx
│   │   ├── MyProgress.tsx
│   │   └── StoryLibrary.tsx         # 移動自現有 pages/student/
│   └── admin/
│       ├── SchoolList.tsx
│       └── UserManagement.tsx
├── services/
│   ├── api.ts                       # 現有 API service（擴展）
│   ├── mockApi.ts                   # Mock data service
│   └── authApi.ts                   # Auth API
└── mocks/
    └── mockData.ts                  # Mock 資料
```

---

## 6. 前端頁面規格

### 6.1 教師登入頁

**URL**: `/login`

**Wireframe**:
```
┌──────────────────────────────────────────┐
│                                          │
│           ┌──────────────┐               │
│           │  [L] Logo    │               │
│           │  LingoLeap   │               │
│           │  國語文AI閱讀│               │
│           └──────────────┘               │
│                                          │
│     ┌────────────────────────────┐       │
│     │ [教師登入]  [學生登入]  tab │       │
│     ├────────────────────────────┤       │
│     │                            │       │
│     │  Email                     │       │
│     │  ┌────────────────────┐    │       │
│     │  │ teacher@school.tw  │    │       │
│     │  └────────────────────┘    │       │
│     │                            │       │
│     │  密碼                      │       │
│     │  ┌────────────────────┐    │       │
│     │  │ ••••••••           │    │       │
│     │  └────────────────────┘    │       │
│     │                            │       │
│     │  [    登入    ]            │       │
│     │                            │       │
│     │  忘記密碼？  |  註冊帳號   │       │
│     └────────────────────────────┘       │
│                                          │
└──────────────────────────────────────────┘
```

**學生登入 Tab**:
```
│     │  選擇學校                  │       │
│     │  ┌────────────────────┐    │       │
│     │  │ 桃源國小        ▾  │    │       │
│     │  └────────────────────┘    │       │
│     │                            │       │
│     │  學號                      │       │
│     │  ┌────────────────────┐    │       │
│     │  │ 110001              │    │       │
│     │  └────────────────────┘    │       │
│     │                            │       │
│     │  密碼                      │       │
│     │  ┌────────────────────┐    │       │
│     │  │ ••••••••           │    │       │
│     │  └────────────────────┘    │       │
│     │                            │       │
│     │  [    登入    ]            │       │
│     │  密碼提示：預設為生日八碼   │       │
```

**Key Components**: LoginForm, TabSwitcher
**Data Requirements**: 學校列表（學生登入用）
**User Interactions**:
- Tab 切換教師/學生登入
- 表單驗證（Email 格式、密碼長度）
- 登入失敗錯誤訊息
- 「忘記密碼」連結
- 「註冊帳號」連結（教師）
**Mobile**: 全屏 card，不需 sidebar

---

### 6.2 教師儀表板

**URL**: `/teacher/dashboard`

**Wireframe**:
```
┌──────────┬─────────────────────────────────────────────┐
│          │  儀表板                          王老師 ▾   │
│ Sidebar  │                                             │
│          │  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│ 儀表板 * │  │  班級數   │ │  學生數   │ │ 本週活躍  │    │
│ 班級管理 │  │    3     │ │   84    │ │   62    │    │
│ 課文指派 │  │ +1 新增   │ │ 占全校26%│ │ 73.8%   │    │
│ 學校設定 │  └──────────┘ └──────────┘ └──────────┘    │
│          │                                             │
│          │  ┌──────────┐ ┌──────────┐                  │
│          │  │ 平均正確率│ │ 平均語速  │                  │
│          │  │  82.3%   │ │ 138 CPM │                  │
│          │  │ ↑ 3.2%   │ │ ↑ 8 CPM │                  │
│          │  └──────────┘ └──────────┘                  │
│          │                                             │
│          │  需關注學生                    [查看全部 →]  │
│          │  ┌──────────────────────────────────────┐   │
│          │  │ ⚠ 林小華 五甲  連續3次正確率<60%     │   │
│          │  │ ⚠ 張小偉 五甲  已7天未練習           │   │
│          │  │ ⚠ 陳小芳 六甲  「清」字錯4次         │   │
│          │  └──────────────────────────────────────┘   │
│          │                                             │
│          │  我的班級                                    │
│          │  ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│          │  │  五年甲班  │ │  五年乙班  │ │ 六年甲班 │ │
│          │  │  28人      │ │  26人      │ │ 30人     │ │
│          │  │  Acc 84%   │ │  Acc 79%   │ │ Acc 86%  │ │
│          │  │  活躍 22人 │ │  活躍 20人 │ │ 活躍 24人│ │
│          │  └────────────┘ └────────────┘ └──────────┘ │
│          │                                             │
│          │  近期活動                                    │
│          │  ┌──────────────────────────────────────┐   │
│          │  │ 陳小明 完成「大自然的線索」 Acc 88%   │   │
│          │  │ 林小華 嘗試「玉山之美」 Acc 52%       │   │
│          │  │ 王小美 完成「海洋生態」 Acc 91%       │   │
│          │  └──────────────────────────────────────┘   │
│          │                                             │
└──────────┴─────────────────────────────────────────────┘
```

**Key Components**: StatCard (x5), AlertList, ClassroomCardGrid, ActivityFeed
**Data Requirements**: `/api/reports/classroom/{id}/summary` x N, `/api/reports/classroom/{id}/alerts`
**User Interactions**:
- 點擊班級卡片 → 進入 `/teacher/classrooms/:id`
- 點擊需關注學生 → 進入 `/teacher/students/:id`
- 點擊「查看全部」→ 展開完整警示清單
**Mobile**: StatCard 2-col grid，班級卡片 1-col stack

---

### 6.3 班級列表頁

**URL**: `/teacher/classrooms`

**Wireframe**:
```
┌──────────┬─────────────────────────────────────────────┐
│          │  班級管理                    [+ 新增班級]    │
│ Sidebar  │                                             │
│          │  學年度：[114-2 ▾]    搜尋：[         🔍]   │
│          │                                             │
│          │  ┌────────────┐ ┌────────────┐ ┌──────────┐ │
│          │  │  五年甲班  │ │  五年乙班  │ │ 六年甲班 │ │
│          │  │ ─────────  │ │ ─────────  │ │ ────────-│ │
│          │  │  28 人     │ │  26 人     │ │  30 人   │ │
│          │  │  活躍 22人 │ │  活躍 20人 │ │  活躍 24人│ │
│          │  │            │ │            │ │          │ │
│          │  │  Acc 84.2% │ │  Acc 79.1% │ │ Acc 86.5%│ │
│          │  │  CPM 142   │ │  CPM 131   │ │ CPM 155  │ │
│          │  │            │ │            │ │          │ │
│          │  │  ████████░ │ │  █████░░░░ │ │ █████████│ │
│          │  │  進度 78%  │ │  進度 56%  │ │ 進度 89% │ │
│          │  │            │ │            │ │          │ │
│          │  │ [管理] [報表]│ │ [管理] [報表]│ │[管理][報表]│
│          │  └────────────┘ └────────────┘ └──────────┘ │
│          │                                             │
└──────────┴─────────────────────────────────────────────┘
```

**Key Components**: ClassroomCard, AcademicYearFilter, SearchInput
**Data Requirements**: `GET /api/classrooms`
**User Interactions**:
- 點擊卡片 → `/teacher/classrooms/:id`
- 「+ 新增班級」→ Modal 表單（名稱、年級、學年度）
- 學年度篩選
- 搜尋班級名稱
**Mobile**: Card 1-col stack，新增按鈕 FAB

---

### 6.4 班級詳情頁

**URL**: `/teacher/classrooms/:id`

**Wireframe**:
```
┌──────────┬─────────────────────────────────────────────┐
│          │  ← 班級管理 / 五年甲班                      │
│ Sidebar  │                                             │
│          │  [學生名單]  [統計報表]  [表現矩陣]  tabs    │
│          │                                             │
│          │  ─── 學生名單 tab ───                        │
│          │                                             │
│          │  搜尋：[        🔍]     [+ 新增] [CSV 匯入]  │
│          │  篩選：[全部 ▾]  [狀態 ▾]                    │
│          │                                             │
│          │  ┌──┬──────┬──────┬────┬─────┬─────┬────┐   │
│          │  │  │ 姓名 │ 學號  │狀態│正確率│語速 │操作│   │
│          │  ├──┼──────┼──────┼────┼─────┼─────┼────┤   │
│          │  │☑ │陳小明│110001│ 🟢 │88.5%│155  │ ⋯ │   │
│          │  │☑ │林小華│110002│ 🔴 │52.3%│ 98  │ ⋯ │   │
│          │  │☑ │王小美│110003│ 🟢 │91.0%│162  │ ⋯ │   │
│          │  │☑ │張小偉│110004│ 🟡 │68.2%│115  │ ⋯ │   │
│          │  │☑ │李小芳│110005│ ⚪ │ --  │ --  │ ⋯ │   │
│          │  └──┴──────┴──────┴────┴─────┴─────┴────┘   │
│          │                                             │
│          │  狀態說明：                                  │
│          │  🟢 優秀 (>=85%)  🟡 正常 (60-85%)          │
│          │  🔴 需關注 (<60%) ⚪ 尚未練習                │
│          │                                             │
│          │  共 28 人 | 已選 28 人    [批量操作 ▾]       │
│          │                                             │
└──────────┴─────────────────────────────────────────────┘
```

**Key Components**: DataTable (sortable, searchable), StatusBadge, StudentActions dropdown
**Data Requirements**: `GET /api/classrooms/:id/students`, `GET /api/classrooms/:id/stats`
**User Interactions**:
- 點擊學生姓名 → `/teacher/students/:id`
- 排序（點擊表頭）：姓名、學號、狀態、正確率、語速
- 搜尋學生姓名/學號
- 篩選狀態（全部/優秀/正常/需關注/尚未練習）
- 「+ 新增」→ 新增單一學生 Modal
- 「CSV 匯入」→ `/teacher/import`
- 批量操作：指派課文、匯出名單
- 「⋯」操作選單：查看詳情、編輯、重設密碼、移除
**Mobile**: 表格改為卡片清單，每張卡片顯示學生資訊

**統計報表 Tab**:
```
│          │  ─── 統計報表 tab ───                        │
│          │                                             │
│          │  時間範圍：[本週 ▾]  [2/21 - 2/27]          │
│          │                                             │
│          │  ┌──────────────────────────────────────┐   │
│          │  │  正確率趨勢折線圖                     │   │
│          │  │  (X: 週, Y: 平均正確率%)             │   │
│          │  │  --- 班級平均  --- 目標線(85%)        │   │
│          │  └──────────────────────────────────────┘   │
│          │                                             │
│          │  ┌──────────────────────────────────────┐   │
│          │  │  正確率分布圓餅圖                     │   │
│          │  │  優秀8人 / 正常12人 / 需努力6人 / 掙扎2人│   │
│          │  └──────────────────────────────────────┘   │
│          │                                             │
│          │  常見錯字 Top 10                             │
│          │  ┌──────────────────────────────────────┐   │
│          │  │  1. 清 (23次/12人)  ████████████     │   │
│          │  │  2. 晴 (18次/9人)   █████████        │   │
│          │  │  3. 的 (15次/14人)  ███████          │   │
│          │  └──────────────────────────────────────┘   │
```

---

### 6.5 學生詳情頁

**URL**: `/teacher/students/:id`

**Wireframe**:
```
┌──────────┬─────────────────────────────────────────────┐
│          │  ← 五年甲班 / 陳小明                        │
│ Sidebar  │                                             │
│          │  ┌──────────────────────────────────────┐   │
│          │  │  陳小明  110001  五年甲班              │   │
│          │  │  總練習 15 次 | 平均正確率 82.3%       │   │
│          │  │  平均語速 142 CPM | 最後活動 2小時前    │   │
│          │  └──────────────────────────────────────┘   │
│          │                                             │
│          │  ┌──────────────────────────────────────┐   │
│          │  │  學習進步曲線                         │   │
│          │  │  (X: 練習次數, Y: 正確率 + CPM)      │   │
│          │  │                                     │   │
│          │  │   100%─┐                  ・---・    │   │
│          │  │        │              ・--        │   │
│          │  │   85%──┤─ ─ ─目標 ─ ─ ─ ─ ─ ─ ─ ─  │   │
│          │  │        │         ・--              │   │
│          │  │   70%──┤     ・--                  │   │
│          │  │        │ ・--                      │   │
│          │  │   55%──┤・                         │   │
│          │  │        └──┬──┬──┬──┬──┬──┬──┬──→   │   │
│          │  │           1  2  3  4  5  6  7      │   │
│          │  └──────────────────────────────────────┘   │
│          │                                             │
│          │  學習歷程                                    │
│          │  ┌──────────────────────────────────────┐   │
│          │  │ 2/27 大自然的線索  Acc 88.5% CPM 155 │   │
│          │  │      ✅已完成  課文理解 4/5           │   │
│          │  │ 2/25 玉山之美    Acc 82.0% CPM 142  │   │
│          │  │      ✅已完成  課文理解 5/5           │   │
│          │  │ 2/23 海洋生態    Acc 75.0% CPM 128  │   │
│          │  │      ✅已完成  課文理解 3/5           │   │
│          │  └──────────────────────────────────────┘   │
│          │                                             │
│          │  常見錯字                                    │
│          │  ┌──────────────────────────────────────┐   │
│          │  │ 清(5次) 晴(3次) 的(2次) 了(2次)      │   │
│          │  └──────────────────────────────────────┘   │
│          │                                             │
└──────────┴─────────────────────────────────────────────┘
```

**Key Components**: StudentHeader, AccuracyTrendChart, SessionHistoryList, ErrorFrequencyBadges
**Data Requirements**: `GET /api/students/:id/progress`
**User Interactions**:
- 點擊學習歷程項目 → 展開該次詳細報告
- 圖表可切換「正確率」/「語速」/「兩者」
- 點擊錯字 → 顯示錯誤脈絡（哪些課文讀錯）
**Mobile**: 圖表全寬，歷程清單卡片化

---

### 6.6 課文指派頁

**URL**: `/teacher/assignments/new`

**Wireframe**:
```
┌──────────┬─────────────────────────────────────────────┐
│          │  新增課文指派                                │
│ Sidebar  │                                             │
│          │  Step 1: 選擇班級                            │
│          │  ┌────────────────────────────────────────┐  │
│          │  │ ☑ 五年甲班 (28人)                      │  │
│          │  │ ☐ 五年乙班 (26人)                      │  │
���          │  │ ☐ 六年甲班 (30人)                      │  │
│          │  └────────────────────────────────────────┘  │
│          │                                             │
│          │  Step 2: 選擇課文                            │
│          │  搜尋：[        🔍]  年級：[五年級 ▾]       │
│          │  ┌────────────────────────────────────────┐  │
│          │  │ ☑ 大自然的線索    五年級 記敘文        │  │
│          │  │ ☐ 玉山之美        五年級 說明文        │  │
│          │  │ ☐ 海洋生態        五年級 說明文        │  │
│          │  └────────────────────────────────────────┘  │
│          │                                             │
│          │  Step 3: 設定目標                            │
│          │  目標正確率：[85]%   目標語速：[140] CPM     │
│          │  截止日期：  [2026-03-15]                    │
│          │  教師備註：  [請注意「清」和「晴」的差別]     │
│          │                                             │
│          │  [取消]                          [確認指派]  │
│          │                                             │
└──────────┴─────────────────────────────────────────────┘
```

**Key Components**: ClassroomPicker, StoryPicker (with search/filter), TargetForm
**Data Requirements**: `GET /api/classrooms`, `GET /api/stories`, 課文 metadata
**User Interactions**:
- 可多選班級（同時指派給多個班）
- 課文搜尋、年級篩選
- 目標值有建議預設值（根據年級）
- 截止日期 date picker
- 確認前預覽（將指派給 N 人）
**Mobile**: Step wizard 垂直排列

---

### 6.7 CSV 學生匯入 Wizard

**URL**: `/teacher/import`

4 步驟 Wizard（參考業界最佳實踐）。

**Step 1: 下載範本**
```
┌──────────────────────────────────────────────────┐
│  CSV 學生匯入                                     │
│                                                  │
│  (1)下載範本  (2)上傳  (3)預覽  (4)確認          │
│  ━━━━━━━━━   ──────   ──────   ──────            │
│                                                  │
│  請先下載 CSV 範本，填寫後上傳：                   │
│                                                  │
│  ┌────────────────────────────────────────┐      │
│  │  📥 下載 CSV 範本                       │      │
│  │                                        │      │
│  │  範本包含以下欄位：                     │      │
│  │  - 姓名（必填）                         │      │
│  │  - 學號（必填，校內唯一）               │      │
│  │  - 生日（必填，格式 YYYY-MM-DD）        │      │
│  │  - Email（選填）                        │      │
│  │                                        │      │
│  │  預設密碼 = 生日八碼（例：20150314）    │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  指派到班級：[五年甲班 ▾]                         │
│                                                  │
│                                     [下一步 →]   │
└──────────────────────────────────────────────────┘
```

**Step 2: 上傳檔案**
```
│  (1)下載範本  (2)上傳  (3)預覽  (4)確認          │
│  ━━━━━━━━━   ━━━━━━   ──────   ──────            │
│                                                  │
│  ┌─────────────────────────────────────────┐     │
│  │                                         │     │
│  │    📎 拖曳 CSV 檔案到此處               │     │
│  │       或 [選擇檔案]                     │     │
│  │                                         │     │
│  │    支援格式：.csv, .xlsx                │     │
│  │    最大：500 筆學生                     │     │
│  │                                         │     │
│  └─────────────────────────────────────────┘     │
│                                                  │
│  重複學號處理：                                   │
│  ◉ 跳過（保留現有資料）                          │
│  ○ 更新（用新資料覆蓋）                          │
│  ○ 報錯（停止匯入）                              │
│                                                  │
│  [← 上一步]                        [下一步 →]    │
```

**Step 3: 預覽與錯誤**
```
│  (1)下載範本  (2)上傳  (3)預覽  (4)確認          │
│  ━━━━━━━━━   ━━━━━━   ━━━━━━   ──────            │
│                                                  │
│  解析結果：30 筆資料                              │
│  ✅ 28 筆正確  ⚠️ 1 筆跳過  ❌ 1 筆錯誤          │
│                                                  │
│  ┌──┬──────┬──────┬───────────┬────────┬──────┐  │
│  │  │ 姓名 │ 學號 │ 生日      │ 狀態   │ 訊息 │  │
│  ├──┼──────┼──────┼───────────┼────────┼──────┤  │
│  │ 1│陳小明│110001│2015-03-14 │ ✅     │      │  │
│  │ 2│林小華│110002│2015-06-22 │ ✅     │      │  │
│  │..│ ...  │ ...  │ ...       │ ...    │      │  │
│  │15│周小誠│110015│2015/13/01 │ ❌ 錯誤│日期格│  │
│  │  │      │      │           │        │式錯誤│  │
│  │16│趙小妹│110002│2015-09-05 │ ⚠️跳過 │學號重│  │
│  │  │      │      │           │        │複    │  │
│  └──┴──────┴──────┴───────────┴────────┴──────┘  │
│                                                  │
│  [← 上一步]                  [確認匯入 28 人 →]   │
```

**Step 4: 匯入結果**
```
│  (1)下載範本  (2)上傳  (3)預覽  (4)確認          │
│  ━━━━━━━━━   ━━━━━━   ━━━━━━   ━━━━━━            │
│                                                  │
│  ┌────────────────────────────────────────┐      │
│  │                                        │      │
│  │    ✅ 匯入完成                         │      │
│  │                                        │      │
│  │    成功新增 28 位學生                   │      │
│  │    跳過 1 位（學號重複）               │      │
│  │    失敗 1 位（日期格式錯誤）           │      │
│  │                                        │      │
│  │    預設密碼：生日八碼（YYYYMMDD）      │      │
│  │    請提醒學生首次登入後修改密碼         │      │
│  │                                        │      │
│  │    [📥 下載匯入報告]                   │      │
│  │                                        │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  [回到班級管理]              [繼續匯入其他班級]   │
```

**Key Components**: CSVImportWizard (4-step), FileUploader, DataPreviewTable, ImportResultSummary
**Data Requirements**: `POST /api/students/batch`
**User Interactions**:
- 拖曳上傳 CSV
- 預覽表格可捲動
- 錯誤行紅色高亮
- 可下載匯入報告
- 重複處理策略選擇
**Mobile**: Wizard 步驟垂直排列，表格橫向捲動

---

### 6.8 學校設定頁

**URL**: `/teacher/settings`

**Wireframe**:
```
┌──────────┬─────────────────────────────────────────────┐
│          │  學校設定                                    │
│ Sidebar  │                                             │
│          │  [基本資料]  [教師管理]  tabs                │
│          │                                             │
│          │  ─── 基本資料 ───                            │
│          │                                             │
│          │  學校名稱                                    │
│          │  ┌──────────────────────────┐               │
│          │  │ 台東縣桃源國小           │               │
│          │  └──────────────────────────┘               │
│          │                                             │
│          │  學校地址                                    │
│          │  ┌──────────────────────────┐               │
│          │  │ 台東縣延平鄉桃源村...    │               │
│          │  └──────────────────────────┘               │
│          │                                             │
│          │  學校電話                                    │
│          │  ┌──────────────────────────┐               │
│          │  │ 089-561234               │               │
│          │  └──────────────────────────┘               │
│          │                                             │
│          │  學校加入代碼                                │
│          │  ┌──────────────────────────┐               │
│          │  │ SC-8294     [🔄 重新產生]│               │
│          │  └──────────────────────────┘               │
│          │                                             │
│          │  [儲存變更]                                  │
│          │                                             │
└──────────┴─────────────────────────────────────────────┘
```

**教師管理 Tab**（school_admin 可見）:
```
│          │  ─── 教師管理 ───                            │
│          │                                             │
│          │  [+ 邀請教師]                               │
│          │                                             │
│          │  ┌──────┬──────────────────┬──────┬────┐    │
│          │  │ 姓名 │ Email            │ 角色  │操作│    │
│          │  ├──────┼──────────────────┼──────┼────┤    │
│          │  │王老師│wang@school.edu.tw│管理員 │ ⋯ │    │
│          │  │李老師│li@school.edu.tw  │教師   │ ⋯ │    │
│          │  │張老師│zhang@school.edu.tw│教師  │ ⋯ │    │
│          │  └──────┴──────────────────┴──────┴────┘    │
```

**Key Components**: SchoolForm, TeacherTable, InviteTeacherModal
**Data Requirements**: `GET /api/schools/:id`, `GET /api/teachers`
**User Interactions**:
- 編輯學校基本資料
- 重新產生加入代碼
- 邀請教師（輸入 email 發送邀請）
- 修改教師角色（school_admin 專屬）
- 停用教師帳號
**Mobile**: 表單全寬

---

### 6.9 班級表現矩陣

**URL**: `/teacher/classrooms/:id/matrix`

**Wireframe**:
```
┌──────────┬─────────────────────────────────────────────┐
│          │  ← 五年甲班 / 表現矩陣                      │
│ Sidebar  │                                             │
│          │  篩選：[全部課文 ▾]  [全部學生 ▾]            │
│          │                                             │
│          │  圖例：🟩達標  🟨進行中  🟥需關注  ⬜未開始   │
│          │                                             │
│          │         大自然  玉山  海洋  森林  動物        │
│          │  ┌──────┬─────┬─────┬─────┬─────┬─────┐     │
│          │  │      │課文1│課文2│課文3│課文4│課文5│     │
│          │  ├──────┼─────┼─────┼─────┼─────┼─────┤     │
│          │  │陳小明│ 🟩  │ 🟩  │ 🟨  │ ⬜  │ ⬜  │     │
│          │  │      │88.5%│82.0%│75.0%│ --  │ --  │     │
│          │  ├──────┼─────┼─────┼─────┼─────┼─────┤     │
│          │  │林小華│ 🟥  │ 🟥  │ ⬜  │ ⬜  │ ⬜  │     │
│          │  │      │52.3%│48.1%│ --  │ --  │ --  │     │
│          │  ├──────┼─────┼─────┼─────┼─────┼─────┤     │
│          │  │王小美│ 🟩  │ 🟩  │ 🟩  │ 🟩  │ 🟨  │     │
│          │  │      │91.0%│89.2%│87.5%│90.1%│78.3%│     │
│          │  ├──────┼─────┼─────┼─────┼─────┼─────┤     │
│          │  │張小偉│ 🟨  │ 🟥  │ ⬜  │ ⬜  │ ⬜  │     │
│          │  │      │68.2%│55.0%│ --  │ --  │ --  │     │
│          │  └──────┴─────┴─────┴─────┴─────┴─────┘     │
│          │                                             │
│          │  點擊格子可查看該學生在該課文的詳細紀錄       │
│          │                                             │
└──────────┴─────────────────────────────────────────────┘
```

**Key Components**: PerformanceMatrix (heatmap grid), MatrixCell, MatrixLegend
**Data Requirements**: `GET /api/classrooms/:id/matrix`
**User Interactions**:
- 點擊格子 → 展開該學生在該課文的詳細學習記錄（Modal）
- 滑鼠懸停 → 顯示 tooltip（正確率、語速、嘗試次數）
- 篩選特定課文或學生
- 橫向捲動（課文多時）
- 排序：依學生姓名、平均正確率
**Mobile**: 固定學生姓名欄，矩陣橫向捲動
**色彩規則**:
- 🟩 綠色 `#22c55e`：正確率 >= 85%（達標）
- 🟨 黃色 `#eab308`：正確率 60-84%（進行中）
- 🟥 紅色 `#ef4444`：正確率 < 60%（需關注）
- ⬜ 灰色 `#e5e7eb`：尚未嘗試

---

### 6.10 學生端：我的學習紀錄

**URL**: `/student/history`

**Wireframe**:
```
┌──────────────────────────────────────────────────┐
│  LingoLeap                          小明 五甲 ▾  │
├──────────────────────────────────────────────────┤
│                                                  │
│  我的學習紀錄                                     │
│                                                  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐      │
│  │ 練習次數   │ │ 平均正確率│ │ 平均語速   │      │
│  │   15 次   │ │  82.3%   │ │  142 CPM  │      │
│  │           │ │ ↑ 上週+3% │ │ ↑ 上週+8  │      │
│  └───────────┘ └───────────┘ └───────────┘      │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  我的進步 📈                              │    │
│  │                                          │    │
│  │  100%─┐                    ・---・        │    │
│  │       │                ・--              │    │
│  │   85%─┤─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │    │
│  │       │           ・--                   │    │
│  │   70%─┤       ・--                       │    │
│  │       │   ・--                           │    │
│  │   55%─┤・                                │    │
│  │       └──┬──┬──┬──┬──┬──┬──┬──→          │    │
│  │          1  2  3  4  5  6  7             │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  最近的練習                                       │
│  ┌──────────────────────────────────────────┐    │
│  │ 📖 大自然的線索          2/27  ✅ 完成   │    │
│  │    正確率 88.5%  語速 155 CPM            │    │
│  │    [再練一次]                             │    │
│  ├──────────────────────────────────────────┤    │
│  │ 📖 玉山之美              2/25  ✅ 完成   │    │
│  │    正確率 82.0%  語速 142 CPM            │    │
│  │    [再練一次]                             │    │
│  ├──────────────────────────────────────────┤    │
│  │ 📖 海洋生態              2/23  ✅ 完成   │    │
│  │    正確率 75.0%  語速 128 CPM            │    │
│  │    [再練一次]                             │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ────────────────────────────────────────────    │
│  [📚 我的任務]  [📖 圖書館]  [📊 學習紀錄*]     │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Key Components**: StatCard (x3), AccuracyTrendChart, SessionHistoryList, BottomNav
**Data Requirements**: `GET /api/student/history`, `GET /api/student/progress`
**User Interactions**:
- 點擊歷史項目 → 展開詳細報告
- 「再練一次」→ 進入六步驟學習流程
- 底部導航切換頁面
- 圖表顯示進步趨勢（正面鼓勵用語）
**Mobile**: 全屏設計，底部固定 Tab 導覽
**設計考量**:
- 使用大字體（學生友善）
- 正面鼓勵用語（「你進步了！」而非「你退步了」）
- 進步箭頭用綠色，退步用中性灰色（不用紅色，避免挫折感）

---

## 7. 實作計畫

### Phase 1：前端 Mock Data（Week 1-3）

**目標**：不依賴後端，用 Mock 資料完成前端 UI 框架。

**可立即開始，無後端依賴。**

| 工作項目 | 預估天數 | 產出 |
|---------|---------|------|
| React Router + TeacherLayout（Sidebar） | 2 | 路由框架 + 導航 |
| Mock Data Service + 型別定義 | 1 | mockData.ts + types/*.ts |
| 教師登入頁（純 UI，無 auth） | 1 | LoginPage.tsx |
| 教師儀表板 | 2 | Dashboard.tsx + StatCard + AlertList |
| 班級列表 + 班級詳情（學生名單） | 3 | ClassroomList/Detail.tsx + DataTable |
| 學生詳情頁 | 2 | StudentDetail.tsx + charts |
| CSV 匯入 Wizard（純前端解析） | 2 | CSVImportWizard.tsx |
| 學生端 Layout + 學習紀錄頁 | 2 | StudentLayout + History/Progress |

**對應 Issues**: #19（部分）, #22（部分）, #83（部分）, #87（部分）

**交付物**：
- 可導航的前端 UI，所有頁面可瀏覽
- Mock 資料可切換為 Real API（env 變數切換）
- 設計系統元件庫（StatCard, DataTable, StatusBadge, Sidebar）

### Phase 2：Auth + DB（Week 3-5）

**目標**：建立帳號系統和資料庫 schema。

| 工作項目 | 預估天數 | 產出 |
|---------|---------|------|
| DB Schema migration（擴展現有 models） | 2 | Alembic migration files |
| JWT auth service（bcrypt + HS256） | 2 | auth_service.py + auth routes |
| 教師註冊/登入 API | 1 | POST /api/auth/teacher/* |
| 學生登入 API | 1 | POST /api/auth/student/login |
| Auth middleware + role-based guards | 2 | dependencies.py + guards |
| 前端 auth store + login flow | 2 | authStore.ts + LoginPage 接真 API |
| Protected routes + redirect | 1 | PrivateRoute component |

**對應 Issues**: #82, #18

**交付物**：
- 教師可註冊、登入
- 學生可用學號+密碼登入
- JWT token 認證
- Role-based access control（不使用 Casbin，用簡單 decorator）

### Phase 3：Backend CRUD + CSV 匯入（Week 5-8）

**目標**：所有管理 API 完成，前端接真 API。

| 工作項目 | 預估天數 | 產出 |
|---------|---------|------|
| Schools CRUD API | 1 | routes/schools.py |
| Classrooms CRUD API | 2 | routes/classrooms.py |
| Teachers CRUD API | 1 | routes/teachers.py |
| Students CRUD + batch import API | 3 | routes/students.py |
| Assignments CRUD API | 2 | routes/assignments.py |
| 前端接真 API（替換 mock） | 3 | 更新所有 pages |
| CSV 匯入後端（解析 + 驗證 + 寫入） | 2 | services/csv_import.py |
| Join code 系統（班級代碼加入） | 1 | 加入邏輯 |

**對應 Issues**: #19, #20, #83, #84

**交付物**：
- 完整的學校/班級/教師/學生 CRUD
- CSV 批量匯入（含錯誤預覽）
- 課文指派系統
- 前端全部接真 API

### Phase 4：學習歷程 + 報表（Week 8-12）

**目標**：學習數據持久化，教師報表完成。

| 工作項目 | 預估天數 | 產出 |
|---------|---------|------|
| Learning session 持久化 API | 3 | routes/learning_sessions.py |
| 前端 session 上傳邏輯 | 2 | AssessmentReport → POST API |
| Reports aggregation API | 3 | routes/reports.py |
| 班級統計摘要 API + 前端 | 2 | Dashboard 接真實數據 |
| 學生進度 API + 前端 | 2 | StudentDetail 接真實數據 |
| 班級表現矩陣 API + 前端 | 3 | ClassroomMatrix.tsx |
| 需關注學生 alerts API | 2 | AlertList 接真實數據 |
| 報表匯出（CSV） | 1 | Export endpoint |
| 學生端：我的學習紀錄 | 2 | Student history + progress |

**對應 Issues**: #21, #22, #87, #171

**交付物**：
- 學習數據自動儲存到 DB
- 教師儀表板顯示真實數據
- 班級表現矩陣（熱力圖）
- 需關注學生警示
- 學生端學習歷程

---

## 8. 設計規範

### 8.1 色彩系統

擴展現有 LingoLeap 的 indigo accent 色系。

| 用途 | 色碼 | Tailwind Class | 說明 |
|------|------|----------------|------|
| Primary（品牌色） | `#4f46e5` | `indigo-600` | 現有 accent 色 |
| Primary Hover | `#4338ca` | `indigo-700` | 互動回饋 |
| Sidebar Background | `#1e1b4b` | `indigo-950` | 深色側邊欄 |
| Sidebar Text | `#c7d2fe` | `indigo-200` | 側邊欄文字 |
| Sidebar Active | `#6366f1` | `indigo-500` | 選中項目背景 |
| Success | `#22c55e` | `green-500` | 達標、優秀 |
| Warning | `#eab308` | `yellow-500` | 進行中、注意 |
| Danger | `#ef4444` | `red-500` | 需關注 |
| Neutral | `#6b7280` | `gray-500` | 未開始、停用 |
| Background | `#fef3c7` | `amber-50` | 現有頁面背景（保持溫暖色調） |
| Card Background | `#ffffff` | `white` | 卡片背景 |

### 8.2 字型

| 用途 | 字型 | 大小 | 說明 |
|------|------|------|------|
| 標題（教師端） | 系統字型 | 24-32px (text-2xl ~ text-3xl) | 頁面標題 |
| 正文（教師端） | 系統字型 | 14-16px (text-sm ~ text-base) | 表格、表單 |
| 標題（學生端） | 系統字型 | 28-36px (text-2xl ~ text-4xl) | 更大，學生友善 |
| 正文（學生端） | 系統字型 | 16-18px (text-base ~ text-lg) | 更大，好閱讀 |
| 數字/統計 | 系統字型 | 36-48px (text-4xl ~ text-5xl) | 統計卡片大數字 |
| 注音 | BpmfIansui | 依上下文 | 現有注音字型 |

**考量**：未來可評估 Lexend 字型（專為閱讀障礙設計），但初期使用系統字型以減少載入時間。

### 8.3 元件規範

#### StatCard（統計卡片）

```
┌──────────────┐
│  班級數       │  ← 標籤（text-sm, gray-500）
│    3         │  ← 數字（text-4xl, font-bold）
│  +1 本月新增  │  ← 趨勢（text-xs, green-500 或 gray-400）
└──────────────┘

寬度：w-full（grid 自適應）
高度：auto (py-6 px-4)
圓角：rounded-xl
陰影：shadow-sm
背景：white
```

#### StatusBadge（狀態標記）

```
優秀     → bg-green-100  text-green-700  border-green-200
正常     → bg-blue-100   text-blue-700   border-blue-200
需關注   → bg-red-100    text-red-700    border-red-200
尚未練習 → bg-gray-100   text-gray-500   border-gray-200

尺寸：px-2.5 py-0.5 text-xs rounded-full
```

**重要**：使用文字標籤（「需關注」）而非僅數字。教師需要快速理解，不需要心算。

#### DataTable（資料表格）

```
特性：
- 可排序表頭（點擊切換升降序，顯示箭頭指示）
- 搜尋列（即時篩選）
- 狀態篩選 dropdown
- 選取列（checkbox）
- 操作欄（⋯ dropdown menu）
- 分頁或虛擬捲動（>50 筆）
- 空狀態友善提示

響應式：
- Desktop：完整表格
- Mobile：改為卡片清單（每張卡片顯示一筆資料）
```

#### Sidebar（側邊欄）

```
背景：indigo-950
寬度：Desktop w-60, Tablet w-16, Mobile hidden
項目：
  - Icon + Label（Desktop）
  - Icon only（Tablet）
  - 選中項目：bg-indigo-500/20 + left border indigo-400
  - Hover：bg-indigo-500/10
底部：
  - 使用者名稱 + 角色
  - 登出按鈕
```

### 8.4 響應式斷點

| 斷點 | 寬度 | 佈局 |
|------|------|------|
| Mobile | < 768px | 無 sidebar，漢堡選單，卡片佈局 |
| Tablet | 768-1023px | Sidebar icon-only (w-16)，2-col grid |
| Desktop | >= 1024px | Sidebar 展開 (w-60)，3-col grid |
| Large Desktop | >= 1280px | 最大寬度 max-w-7xl 居中 |

### 8.5 互動模式

| 模式 | 說明 | 用於 |
|------|------|------|
| Undo > Confirm | 執行操作後顯示 Undo toast，而非事前 confirm dialog | 刪除學生、取消指派 |
| Progressive Disclosure | 先顯示摘要，點擊展開詳情 | 學生詳情、學習歷程 |
| Optimistic Update | 立即更新 UI，失敗時 revert + toast | 新增/編輯操作 |
| Skeleton Loading | 載入中顯示骨架動畫 | 所有頁面 |
| Empty State | 空資料時顯示友善插圖 + 引導文字 + CTA 按鈕 | 無班級、無學生 |

### 8.6 觸控目標

最小觸控目標 44x44px（WCAG AA），適合國小生操作。

---

## 9. 與 Duotopia 差異說明

### 9.1 簡化項目

| Duotopia 功能 | LingoLeap 處理 | 簡化原因 |
|--------------|---------------|---------|
| **Organization 層級** | 不實作 | 初期只有少數學校（2-3 所），Organization 層增加不必要的複雜度。若未來需要（例如教育局管理多校），再加即可 |
| **Casbin RBAC** | 簡單 role-based decorator | 4 種角色 + 簡單權限矩陣，不需要 Casbin 的策略引擎。用 Python decorator + DB query 即可 |
| **6+ 種角色** | 4 種角色 | system_admin / school_admin / teacher / student。Duotopia 的 org_owner / org_admin 合併為 system_admin |
| **JSONB 角色陣列** | 單一 role 欄位 | 教師只屬於一所學校，不需要跨組織角色 |
| **訂閱/計費系統** | 不實作 | 初期免費提供，不需計費。未來再加 |
| **教師跨校** | 教師只屬於一校 | 簡化資料模型。若未來需要，加 teacher_schools 關聯表 |
| **多語系** | 僅繁體中文 | 目標用戶為台灣教師和學生 |

### 9.2 保留的設計模式

| 設計模式 | 說明 | 來源 |
|---------|------|------|
| **學生預設密碼 = 生日 YYYYMMDD** | 國小生記不住複雜密碼，生日是家長/教師都知道的資訊 | Duotopia 驗證可行 |
| **學號 + 密碼登入（非 Email）** | 國小生通常沒有 Email | Duotopia 驗證可行 |
| **JWT 認證 (HS256, 24h)** | 標準做法，簡單有效 | Duotopia 相同 |
| **CSV 批量匯入 + duplicate_action** | 教師有現成的 Excel 學生名單，批量匯入最方便 | Duotopia 相同 |
| **Join code 系統** | 班級代碼（LC-4829）比 Email 邀請更適合國小場景 | Duotopia 相同 |
| **is_active soft delete** | 不真正刪除資料，用 is_active=False 標記停用 | 業界最佳實踐 |
| **Zustand for auth state** | 輕量 state management，適合 auth 這類全域狀態 | Duotopia 相同 |

### 9.3 未來可能從 Duotopia 移植的功能

| 功能 | 條件 | 預估時程 |
|------|------|---------|
| Organization 層級 | 當教育局/基金會需要管理多校時 | Phase 5+ |
| 教師跨校授權 | 當教師需要在多校教課時 | Phase 5+ |
| OAuth/SSO | 學校要求使用 Google/Microsoft 登入時 | Phase 2+ |
| 進階 RBAC（Casbin） | 當權限需求變複雜時 | Phase 5+ |

---

## 附錄

### A. 業界 UX 參考

| 平台 | 借鏡項目 |
|------|---------|
| **Google Classroom** | 班級卡片 grid（3-col 響應式）、Join code 機制、簡潔的指派流程 |
| **Seesaw** | 深色左側邊欄（indigo-950）、skill matrix 視覺化、大觸控目標 |
| **均一教育平台** | 專注圖（activity calendar heatmap）、台灣教育場景用語 |
| **ClassDojo** | 學生個人頁面、需關注 badge 設計、正面鼓勵語氣 |
| **Kahoot** | CSV 匯入 wizard 4 步驟、錯誤預覽高亮 |

### B. CSV 匯入範本

```csv
姓名,學號,生日,Email
陳小明,110001,2015-03-14,
林小華,110002,2015-06-22,xiaohua@mail.com
王小美,110003,2015-01-08,
張小偉,110004,2014-11-20,
```

**欄位說明**：
- 姓名：必填，最長 100 字元
- 學號：必填，校內唯一
- 生日：必填，格式 YYYY-MM-DD（作為預設密碼）
- Email：選填（國小生通常沒有）

**支援格式**：UTF-8 CSV、Excel (.xlsx)
**最大筆數**：500 筆/次
**編碼**：自動偵測 UTF-8 / BIG5（台灣常見）

### C. 錯誤代碼參考

| Code | HTTP Status | Message | 說明 |
|------|------------|---------|------|
| AUTH_001 | 401 | Invalid credentials | 帳號或密碼錯誤 |
| AUTH_002 | 401 | Token expired | JWT 過期 |
| AUTH_003 | 403 | Insufficient permissions | 權限不足 |
| AUTH_004 | 409 | Email already registered | Email 已註冊 |
| SCHOOL_001 | 404 | School not found | 學校不存在 |
| CLASS_001 | 404 | Classroom not found | 班級不存在 |
| CLASS_002 | 403 | Not your classroom | 非您的班級 |
| STUDENT_001 | 409 | Duplicate student number | 學號重複 |
| STUDENT_002 | 400 | Invalid birthdate format | 生日格式錯誤 |
| IMPORT_001 | 400 | CSV parse error | CSV 解析失敗 |
| IMPORT_002 | 400 | Missing required field | 缺少必填欄位 |
| ASSIGN_001 | 404 | Story not found | 課文不存在 |
| ASSIGN_002 | 400 | Due date in past | 截止日期已過 |

### D. 安全性考量

| 項目 | 實作方式 |
|------|---------|
| 密碼儲存 | bcrypt (cost factor 12) |
| JWT 簽名 | HS256，SECRET_KEY 存環境變數 |
| SQL Injection | SQLAlchemy ORM（參數化查詢） |
| XSS | React 預設 escape + CSP header |
| CORS | ALLOWED_ORIGINS 白名單 |
| Rate Limiting | FastAPI + slowapi（登入 5次/分鐘） |
| 學生隱私 | 教師只能查看自己班級的學生（row-level filtering） |
| 資料備份 | Cloud SQL 每日自動備份 |
| 個資法合規 | 最小化收集（學生只收姓名、學號、生日）；未來需加資料使用同意書 |

---

**文件版本**：1.0
**建立日期**：2026-02-27
**維護者**：Young Tsai
**最後更新**：2026-02-27

**核心原則**：簡化但不簡陋。從 Duotopia 借鏡成功模式，去掉初期不需要的複雜度，讓教師 3 分鐘建好班級、學生一鍵登入開始學習。
