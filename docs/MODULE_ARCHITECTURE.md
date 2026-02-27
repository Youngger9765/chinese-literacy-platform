# 機構校班師生課 — 模組架構

> Module Architecture: Institution → School → Class → Teacher → Student → Course
> Version 1.0 | 2026-02-27

---

## 架構總覽

```
Organization (機構)           ← Phase 5 (future)
  └── School (校)             ← Phase 1 ✅
        └── Teacher (師)      ← Phase 1 ✅ (#82)
              └── Class (班)  ← Phase 2 (#83)
                    ├── ClassStudent (班生) ← Phase 2
                    │     └── Student (生)  ← Phase 1 ✅ (#82)
                    └── ClassAssignment (班課) ← Phase 3 (#143)
                          └── Text (課)
```

---

## 實體關係 (Entity Relationships)

### 現有模型 (Phase 1 實作)

| 實體 | 表名 | 主要欄位 | 說明 |
|------|------|----------|------|
| **School** | `schools` | id, name | 學校，Teacher 的歸屬 |
| **Teacher** | `teachers` | id, school_id, email, name, password_hash, is_active, created_at | 教師帳號，1:N 屬於 School |
| **Class** | `classes` | id, teacher_id, name, class_code | 班級，由 Teacher 建立，class_code 供學生登入 |
| **Student** | `students` | id, name, password_hash, is_active, created_at | 學生帳號，由 Teacher 建立 |
| **ClassStudent** | `class_students` | id, class_id, student_id, seat_number | 班級-學生關聯，座號是班級關係屬性 |
| **Text** | `texts` | id, title, paragraphs, grade, ... | 課文內容 |
| **LearningSession** | `learning_sessions` | id, student_id, text_id | 學習紀錄 |

### 關係圖

```
School ─1:N─ Teacher ─1:N─ Class ─M:N─ Student
                                  │         │
                                  │    (ClassStudent: seat_number)
                                  │
                             ClassAssignment (future)
                                  │
                                Text ─1:N─ LearningSession ─N:1─ Student
```

### 設計決策

| 決策 | 選擇 | 原因 |
|------|------|------|
| 座號位置 | 只放 ClassStudent，不放 Student | 座號是班級關係屬性，同一學生不同班可有不同座號 |
| 學生登入 | class_code + seat_number + password | 國小生沒有 email，用班級代碼+座號最直覺 |
| 班級代碼 | 6 碼大寫英數，系統產生 | 唯一識別班級，老師分享給學生 |
| Teacher-School | 1:N (NOT NULL) | MVP 簡單。未來可改 M:N 支援代課老師 |
| Organization | Phase 5 才加 | MVP 不需要，避免過度工程 |
| 學年/學期 | Phase 2 才加 | 用班級名稱區分即可（如「113 五年一班」） |

---

## 分階段規格 (Phased Specification)

### Phase 1: 帳號系統 — #82 ✅

**範圍**: Teacher 註冊/登入 + Student 登入

| 功能 | 端點 | 說明 |
|------|------|------|
| 教師註冊 | POST `/api/auth/register` | name + email + password + school_name |
| 登入 | POST `/api/auth/login` | 教師: email+pw / 學生: class_code+seat+pw |
| 取得用戶 | GET `/api/users/me` | JWT Bearer Token 驗證 |

**認證方式**: JWT (HS256), 7 天過期, bcrypt 密碼雜湊

**前端**: LoginPage（教師/學生切換）、RegisterPage（教師專用）、AuthContext

**限制**: 目前無 UI 建班/加學生，只能透過 API 或 DB 直接操作

---

### Phase 2: 班級管理 — #83 (planned)

**範圍**: Teacher 建班 → 加學生 → 分享帳密

| 功能 | 端點 | 說明 |
|------|------|------|
| 建立班級 | POST `/api/classes` | name → 產生 class_code |
| 班級列表 | GET `/api/classes` | 教師的所有班級 |
| 加入學生 | POST `/api/classes/{id}/students` | name + seat_number → 產生初始密碼 |
| 批次匯入 | POST `/api/classes/{id}/students/batch` | CSV/JSON 批次建立學生 |
| 學生列表 | GET `/api/classes/{id}/students` | 含座號、帳號狀態 |

**前端**: ClassManagement 頁面（建班、學生名單、分享 class_code）

**DB 變更**:
- Class 加 `academic_year`, `semester`, `grade_level` (optional)
- 可能加 `class_teachers` M:N 表（共同授課）

---

### Phase 3: 課文指派 — #143

**範圍**: Teacher 指派 Text 給 Class

| 功能 | 端點 | 說明 |
|------|------|------|
| 指派課文 | POST `/api/classes/{id}/assignments` | text_id + due_date |
| 班級作業列表 | GET `/api/classes/{id}/assignments` | 含完成統計 |
| 學生作業列表 | GET `/api/students/me/assignments` | 學生看到的作業 |

**新表**: `class_assignments` (class_id, text_id, assigned_at, due_date, status)

**前提**: Phase 2 完成（有班級才能指派）

---

### Phase 4: 教師報表 — #84-#87

**範圍**: Teacher 查看學生學習進度

| 功能 | 端點 | 說明 |
|------|------|------|
| 班級概覽 | GET `/api/classes/{id}/report` | 平均分、完成率 |
| 學生詳情 | GET `/api/students/{id}/report` | 個人學習歷程 |
| 課文統計 | GET `/api/texts/{id}/stats` | 班級該課文的表現 |

**前端**: TeacherDashboard（班級列表→學生列表→學習報表）

**前提**: Phase 2 + Phase 3 完成

---

### Phase 5: 機構管理 — #27 (Demo 5)

**範圍**: Organization 層 + OAuth

| 功能 | 說明 |
|------|------|
| Organization 模型 | `organizations` 表，1:N School |
| 機構管理員 | 管理多間學校的統一帳號 |
| Google OAuth | 教師可用 Google 登入 |
| SSO | 學校統一帳號整合 |

**新表**: `organizations` (id, name, type, ...), `organization_admins`

---

## 權限模型 (Permission Model)

### Phase 1 (MVP)

| 角色 | 權限 |
|------|------|
| **未登入** | 瀏覽課文、使用學習功能（不記錄） |
| **Teacher** | 同上 + 未來建班/指派/查報表 |
| **Student** | 同上 + 學習紀錄會綁定帳號 |

**MVP 原則**: Auth is additive, not a gate. 現有功能不登入也能用。

### Phase 4+ (成熟期)

| 角色 | 權限 |
|------|------|
| **Student** | 只能看自己的作業和報表 |
| **Teacher** | 管理自己的班級和學生 |
| **School Admin** | 管理學校所有班級和教師 |
| **Org Admin** | 管理多間學校 |
| **Platform Admin** | 管理所有內容和用戶 |

---

## 技術架構

### 認證流程

```
[教師註冊] → POST /api/auth/register → bcrypt(password) → DB → JWT
[教師登入] → POST /api/auth/login {email, password} → verify → JWT
[學生登入] → POST /api/auth/login {class_code, seat, password} → verify → JWT
[驗證]     → Authorization: Bearer <JWT> → decode → get_current_user
```

### JWT Payload

```json
// Teacher
{"sub": "1", "role": "teacher", "exp": 1772775219}

// Student
{"sub": "5", "role": "student", "class_id": 3, "exp": 1772775219}
```

### 密碼安全

- **儲存**: bcrypt hash (passlib)
- **強度**: 最少 8 字元
- **學生初始密碼**: 系統隨機 8 碼英數，教師可查看/分享
- **首次登入改密**: Phase 2 實作

---

## 相關文件

| 文件 | 說明 |
|------|------|
| `docs/DATABASE_SCHEMA.md` | 完整資料庫 schema（Duotopia 參考版） |
| `docs/PRD.md` | 產品需求文檔 |
| `backend/app/models/` | SQLAlchemy 模型實作 |
| `backend/app/routes/auth.py` | 認證 API 實作 |
| `backend/tests/test_auth.py` | 認證測試（19 cases） |

---

## Changelog

| 日期 | 版本 | 變更 |
|------|------|------|
| 2026-02-27 | 1.0 | 初版：Phase 1 (#82) 帳號系統架構 |
