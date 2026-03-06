# Issue #223 — 統一用戶模型 TODO

> PR #225 | Branch: `feature/issue-223-unified-user-model`
> 最後更新：2026-03-06

## 已完成

- [x] User model（統一身份表，取代 Teacher/Student）
- [x] Role model（8 個預設角色 + seed data）
- [x] UserRole model（scoped 角色指派）
- [x] StudentProfile model（學生專屬延伸）
- [x] Organization model + CRUD API
- [x] School model 重構（加 organization_id, display_name, address, phone 等）
- [x] Classroom / ClassroomStudent model（取代 Class/ClassStudent）
- [x] Auth 基礎設施（bcrypt + JWT HS256）
- [x] POST /api/auth/register, /api/auth/login, /api/auth/change-password
- [x] GET /api/users/me（含角色資訊）
- [x] Organization CRUD API（list, get, create, update）
- [x] School CRUD API（list, get, create, update）
- [x] Role API（list）
- [x] Classroom management API（7 endpoints）
- [x] Alembic 手寫 migration（可逆）
- [x] Preview DB 建置
- [x] 前端登入/註冊 UI
- [x] Auth gating（未登入→登入頁）
- [x] Role-based nav（admin/teacher/student 看不同內容）
- [x] Quick login buttons（開發用）
- [x] Admin Dashboard + TreeSidebar
- [x] OrgDetailPanel / SchoolDetailPanel
- [x] RolesPanel
- [x] 257 pytest + 7 Playwright E2E
- [x] 學習紀錄持久化（#171 合併）

---

## 待完成

### P0 — Merge 前必須做

- [ ] **RBAC middleware 執行**：`require_role` 已寫但沒有掛在任何 route 上。至少 admin routes 要加 `require_role("system_admin")`
- [ ] **移除重複元件**：`OrganizationDetail.tsx` vs `OrgDetailPanel.tsx` 重複，刪掉沒用的那個
- [ ] **移除 hardcoded school_id**：TeacherDashboard 裡 `school_id: 1` 要改成從 user_roles 取
- [ ] **註冊自動給 teacher role**：目前 register 會自動加 teacher role，應該改為不自動給角色（或改成 student）

### P1 — Merge 後可做（Demo 3 範圍）

- [ ] **Create org/school UI**：Admin panel 只有 detail/edit，缺新增功能
- [ ] **User management API + UI**：列表、搜尋、停用用戶
- [ ] **Role assignment UI**：指派/移除用戶角色的介面
- [ ] **DELETE endpoints**：Organization / School 的軟刪除 API

### P2 — 後續迭代

- [ ] 前端 auth 接入現有學習流程（學生登入後自動帶入 session）
- [ ] 教師端課文指派 + 學生名單管理
- [ ] CSV 學生名單批量匯入（#83）
- [ ] Google OAuth 登入（#27）
- [ ] 密碼重設流程

---

*此文件記錄 #223 的完成狀態與剩餘工作，隨進度更新。*
