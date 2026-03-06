# Issue #223 TODO: 統一用戶模型 + 機構層級架構

> PR #225 | Branch: `feature/issue-223-unified-user-model`
> Last updated: 2026-03-07

---

## Done

### 基礎架構
- [x] User model (email, password_hash, name, phone, avatar_url, is_active)
- [x] Role model (8 預設角色: system_admin, org_owner, org_admin, principal, director, teacher, student, staff)
- [x] UserRole model (scoped: scope_type + scope_id)
- [x] StudentProfile model (school_id, student_number, birthdate, grade, password_changed)
- [x] Organization model (UUID PK)
- [x] School model (organization_id FK, join_code, admin_user_id)
- [x] Classroom model (school_id, teacher_id, join_code)
- [x] ClassroomStudent model (enrollment join table)
- [x] Alembic migration (hand-written, reversible)
- [x] Seed data (1 org, 2 schools, 3 classrooms, 6 users, 8 roles)

### Auth
- [x] JWT auth (HS256, 24h expiry)
- [x] POST /api/auth/register
- [x] POST /api/auth/login
- [x] POST /api/auth/change-password
- [x] bcrypt password hashing (cost 12)
- [x] get_current_user dependency
- [x] require_role factory
- [x] Frontend AuthContext + LoginPage + RegisterPage

### Admin 後台 API
- [x] Organization CRUD (POST/GET/PATCH, no DELETE)
- [x] School CRUD (POST/GET/PATCH, join code regenerate, list members)
- [x] Classroom CRUD (POST/GET/PATCH, join code, add/remove student, batch create, search)
- [x] Users admin (GET list with search/pagination, GET detail)
- [x] Roles (GET list, POST assign, DELETE revoke, GET user roles)

### Admin 後台 UI
- [x] AdminTreeSidebar (3-level collapsible tree: Org > School > Classroom)
- [x] CreateOrgPanel (form with name + display_name)
- [x] OrgDetailPanel (edit, toggle active, school list, inline create school)
- [x] SchoolDetailPanel (edit, toggle active, classroom table, teacher section, join code)
- [x] ClassroomDetailPanel (edit, toggle active, student list, batch create, add student, join code)
- [x] UsersPanel (search, paginated list, expand role management, assign/revoke roles)
- [x] RolesPanel (8 role cards with scope badges)

### 測試
- [x] 441 backend pytest (auth, admin, classrooms, join/batch, orgs, schools, roles, teacher, classroom_texts)
- [x] 42 E2E Playwright tests (full admin flow)
- [x] 21 E2E Playwright tests (teacher dashboard flow)
- [x] 14 E2E Playwright tests (student login + join flow)
- [x] 21 backend tests for teacher API endpoints
- [x] 25 backend tests for classroom text assignment API

### Code Review 修復
- [x] C1: JWT secret production guard
- [x] C4: join_classroom_by_code checks is_active
- [x] C5: Batch create uses DB savepoints
- [x] I5: GET /users/{id}/roles restricted to admin or self
- [x] I7: Remove hardcoded DB URL credentials
- [x] I8: Seed errors logged at WARNING
- [x] I10: Wrong password returns 401
- [x] M3: secrets.choice for join codes
- [x] M7: pool_pre_ping for non-SQLite
- [x] F1: Remove waterfall API in ClassroomDetailPanel
- [x] F2: Fix stale closure in UsersPanel
- [x] F3: Remove deprecated execCommand('copy')
- [x] F4: Fix memory leak (timeout cleanup on unmount)
- [x] Frontend: Merge duplicate listSchoolMembers calls
- [x] Frontend: Merge duplicate createClassroom functions

---

## P1 — 教師能用產品的前提

### 1.1 教師 Dashboard — 班級學習進度
- [x] 後端: GET /api/teacher/classrooms — 教師班級列表 (含 student_count, text_count)
- [x] 後端: GET /api/teacher/classrooms/{id}/progress — 學生學習進度
- [x] 前端: TeacherDashboard 頁面 — 班級卡片總覽
- [x] 前端: StudentProgressTab — 學生進度表 (按最近活動排序)
- [x] 前端: ClassroomDetail 三分頁 (進度/課文/學生)
- [x] 路由: /teacher + /teacher/classroom/:id (教師角色限定)
- [ ] 前端: 個別學生學習歷史 (點擊學生 → 看歷次 session 記錄) — 後續
- [ ] 後端: 班級整體統計 (完成率、平均分、未練習人數) — 後續

### 1.2 課文指派 — 把故事分配給班級
- [x] 後端: 新增 classroom_texts 關聯表 (classroom_id + text_id) + migration
- [x] 後端: POST /api/classrooms/{id}/texts — 指派課文
- [x] 後端: GET /api/classrooms/{id}/texts — 列出已指派課文
- [x] 後端: DELETE /api/classrooms/{id}/texts/{text_id} — 取消指派
- [x] 前端: TextManagementTab — 課文指派/移除 UI (在教師 ClassroomDetail)
- [x] 前端: 學生端只顯示已指派課文 (修改 stories 列表過濾)
- [x] 後端: LearningSession 建立時自動填入 classroom_id

---

## P2 — 學生能登入

### 2.1 學生 username 登入
- [x] 後端: POST /api/auth/login 支援 username OR email 欄位
- [x] 後端: 批量建立學生時自動生成 username (join_code + seat_number)
- [x] 後端: User model 加 username 欄位 (unique, nullable, indexed)
- [x] 前端: LoginPage 支援「帳號」欄位 (同時接受 email 和 username)
- [x] Alembic migration: ALTER TABLE users ADD COLUMN username
- [x] 批量建立時同時建立 StudentProfile (school_id, password_changed=False)

### 2.2 首次登入改密碼
- [x] 後端: 登入時檢查 StudentProfile.password_changed
- [x] 後端: 若 password_changed=False，回傳 token + `must_change_password: true`
- [x] 前端: 攔截 must_change_password，強制跳轉 /change-password
- [x] 前端: ChangePasswordPage (new_password + confirm, 8字元以上)
- [x] 後端: change-password 成功後設 password_changed=True

---

## P3 — 多機構安全隔離

### 3.1 權限範圍過濾
- [x] 後端: get_user_org_ids() helper 抽出
- [x] 後端: GET /api/organizations — org_admin 只看到自己的機構
- [x] 後端: GET /api/schools — org_admin 只看到所屬機構的學校
- [x] 後端: get/update org/school — 403 if 無權限

### 3.2 學生加入代碼 UI
- [x] 前端: /join 頁面 — 輸入加入代碼加入班級
- [x] 前端: 加入成功後顯示班級名稱 + 自動跳轉
- [x] 路由: /join (登入後可存取)
- [x] Nav: "加入班級" 按鈕 (學生角色可見)

---

## P4 — 品質 & 維護

### 4.1 教師自建班級
- [ ] 後端: POST /api/classrooms — teacher 角色可以建立 (目前已支援，但前端沒入口)
- [ ] 前端: 教師介面的「建立班級」入口 (在 TeacherDashboard 或 /teacher/classrooms)

### 4.2 清理死碼
- [x] 刪除 frontend/src/pages/admin/SchoolDetail.tsx (被 SchoolDetailPanel.tsx 取代)

### 4.3 其他 Code Review 待辦
- [x] 後端: N+1 query in list_organizations (I1)
- [x] 後端: _student_count 用 len() 載入全集合 (I2)
- [x] 後端: joinedload + LIMIT pagination bug in list_users (I3)
- [x] 後端: Organization name 加 unique constraint (I6)
- [ ] 後端: No rate limiting on login/register (I9)
- [x] 後端: SchoolClassroomResponse 移到 schemas/ (M2)
- [x] 後端: on_event("startup") deprecated → lifespan (M6)
- [x] 後端: StudentProfile.birthdate NOT NULL 但無 API 建立 (M8)
- [x] 後端: DELETE 回 204 instead of 200 + body (M9)
- [x] 前端: OrgDetailPanel 學校列表不可點擊 (不一致)
- [ ] 前端: Sidebar 雙重 render path (collapsed vs expanded)
- [ ] 前端: Inline SVG icons 重複 → 抽出共用
- [x] 前端: Toggle active 無確認對話框

---

## 驗收標準

- [x] 教師登入後可看到自己的班級和學生學習進度
- [x] 教師可指派課文給班級
- [x] 學生可用短帳號登入 (不需要完整 email)
- [x] 學生首次登入被要求改密碼
- [x] org_admin 只看到自己機構的資料
- [x] 所有 backend tests pass (441 tests)
- [x] E2E tests 覆蓋新功能 (77 tests)
