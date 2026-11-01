---
spec_id: auth_flows.registration_login_invariants
module: auth-flows
title: 註冊/登入 API 流程不變式（pointer module）
stability: active
canonical_source: backend/app/routes/auth.py
owns_code:
  - backend/app/routes/auth.py
legacy_tests:
  - backend/tests/test_auth_api.py
  - backend/tests/test_auth_route_split_1844.py
related_issues:
  - 1844
  - 2058
last_reviewed: 2026-11-01
owner: young
---

# Auth Flows：註冊/登入 API 流程不變式（pointer module）

> **這是 pointer-only module。** 沒有獨立的 `backend/specs/test_auth_flows_spec.py`。
> 底層密碼/JWT 純函式由 `backend/specs/test_auth_spec.py`（`auth` module）覆蓋；
> 本模組管的是 **HTTP API 層的業務邏輯不變式**，由 `legacy_tests:` 指向的
> `test_auth_api.py` + `test_auth_route_split_1844.py` 覆蓋，自助開通老師的完整
> 行為鎖在 `backend/tests/test_self_serve_teacher_3804.py`（本 module 未另外列出，
> 因為它連 permission matrix 都一起鎖，拆開反而讓證據分散）。

## 1. 這個 module 在管什麼

`POST /auth/register`、`POST /auth/login`、`POST /auth/forgot-password`、
`POST /users/me/activate-teacher` 等 HTTP 路由的業務規則，包括預設身分、
自助開通老師、重複 email 衝突，以及 #1844 路由拆分後的行為一致性。

## 2. 核心不變式（Invariants）

> ⚠️ **2026-11-01（#3804，Young 明令）：I-1／I-2 整個反轉。** 舊規則是「學生不能自己
> 註冊、老師註冊自動配學校」；新規則是「人人先是學生、自己決定要不要開通老師」。
> 這不是程式漂移，是刻意的產品決策——改規格不是改回舊的。

### I-1: 任何人註冊都預設成為學生（platform-scoped，無學校）

```
POST /auth/register { "email": "x@y.com", "password": "...", "name": "..." } →
  201 + user 只有一個 role: student, scope_type=platform, scope_id=None
POST /auth/register { ..., "role": "student" } → 一樣 201（role 提示被忽略，非 403）
POST /auth/register { ..., "role": "teacher" } → 一樣 201 且一樣是 student（不再有
  register=teacher 分流）
```

對應測試（`test_auth_route_split_1844.py` / `test_auth_api.py`）：
`test_student_role_hint_is_accepted_not_blocked`、
`test_fresh_registration_gets_platform_scoped_student_role`、
`test_register_role_student_hint_is_accepted_now`、
`test_register_no_role_defaults_to_student`、
`test_register_teacher_role_hint_is_ignored_not_rejected`

### I-2: 自助開通老師 — 填學校名稱即可，不再猜 Email 網域

```
POST /users/me/activate-teacher { "school_names": ["大安國小"] } →
  200 + 以「名稱完全相符（trim + 不分大小寫）」找既有學校或新建
  + user 新增一筆 teacher role, scope_type=school, scope_id=該校 id
  + 原本的 platform-scoped student role 不受影響（兩者並存）
```

對應測試：`test_auth_route_split_1844.py::test_registration_creates_no_school`、
`test_self_activation_by_name_grants_school_scoped_teacher`；完整行為（冪等、
case-insensitive、多校、權限矩陣）鎖在 `test_self_serve_teacher_3804.py`。
設計文件：`docs/prd/2026-11-01-school-as-teacher-attribute-prd.md` §10/§11。

### I-3: 相同 email 重複註冊回 409

```
第二次相同 email → 409 Conflict
```

對應測試：`test_duplicate_email_returns_409`

### I-4: 弱密碼回 422

```
密碼不符強度要求 → 422 Unprocessable Entity
```

對應測試：`test_weak_password_returns_422`

### I-5: 忘記密碼 — 未知 email 仍回 200（防枚舉）

```
POST /auth/forgot-password { "email": "unknown@x.com" } → 200 OK
DB 無任何寫入
```

對應測試：`test_forgot_password_unknown_user_returns_200`、`test_forgot_password_unknown_user_no_db_change`

## 3. 與 auth module 的分工

| Module | 管的範疇 |
|--------|---------|
| `auth` (`specs/modules/auth/INTENT.md`) | 底層：`hash_password` / `verify_password` / `create_access_token` / `decode_token` 純函式 |
| `auth-flows`（本 module）| HTTP API 層：`/auth/register` / `/auth/login` 業務規則 |

## 4. 為何不建獨立 spec test

`test_auth_api.py` 和 `test_auth_route_split_1844.py` 需要完整 DB fixtures（User / School / Role tables）+ FastAPI test client，在 SQLite 模式下可跑但 setup 複雜。現有測試已全面覆蓋，pointer 機制足夠。
