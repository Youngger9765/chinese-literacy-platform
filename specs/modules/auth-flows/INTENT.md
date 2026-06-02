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
last_reviewed: 2026-06-02
owner: young
---

# Auth Flows：註冊/登入 API 流程不變式（pointer module）

> **這是 pointer-only module。** 沒有獨立的 `backend/specs/test_auth_flows_spec.py`。
> 底層密碼/JWT 純函式由 `backend/specs/test_auth_spec.py`（`auth` module）覆蓋；
> 本模組管的是 **HTTP API 層的業務邏輯不變式**，由 `legacy_tests:` 指向的
> `test_auth_api.py` + `test_auth_route_split_1844.py` 覆蓋。

## 1. 這個 module 在管什麼

`POST /auth/register`、`POST /auth/login`、`POST /auth/forgot-password` 等 HTTP 路由的
業務規則，包括教師自動學校建立、學生自我註冊阻擋、重複 email 衝突，以及 #1844 路由拆分後的行為一致性。

## 2. 核心不變式（Invariants）

### I-1: 學生不能自我註冊

```
POST /auth/register { "role": "student" } → 403 Forbidden
POST /auth/register { "role": "STUDENT" } → 422 (uppercase blocked)
```

對應測試（`test_auth_route_split_1844.py`）：
`test_student_self_registration_blocked`、`test_student_role_uppercase_blocked`

### I-2: 教師第一次註冊自動建立 School

```
POST /auth/register { "role": "teacher", "email": "t@school.edu" } →
  201 + school 自動建立
  user 被 assign teacher role
```

對應測試：`test_teacher_gets_school_auto_created`、`test_teacher_gets_teacher_role_assigned`

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
