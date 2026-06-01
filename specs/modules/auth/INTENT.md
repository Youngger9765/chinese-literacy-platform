---
spec_id: auth.password_jwt
module: auth
title: 密碼雜湊 + JWT 簽發/驗證契約
stability: active
canonical_source: backend/app/auth/password.py + backend/app/auth/jwt.py
owns_code:
  - backend/app/auth/password.py
  - backend/app/auth/jwt.py
spec_tests:
  - backend/specs/test_auth_spec.py
related_issues: []
complementary_tests:
  - backend/tests/test_characterization_auth_policies.py
last_reviewed: 2026-06-02
owner: young
---

# Auth：密碼雜湊 + JWT 簽發/驗證契約

> 這份是給**人**讀的 spec（實習生 / AI 修 auth）。
> 機器可驗的契約在 `backend/specs/test_auth_spec.py`。
> `test_characterization_auth_policies.py` 管的是 classroom 權限矩陣（owner/co-teacher/admin/non-member），
> 本模組管的是更底層的密碼雜湊 + JWT token 的 round-trip 正確性。

## 1. 這個 module 在管什麼

### `backend/app/auth/password.py`

- `hash_password(plain: str) -> str` — bcrypt 雜湊，cost=12，72-byte 截斷（bcrypt 硬限制）
- `verify_password(plain: str, hashed: str) -> bool` — bcrypt 驗證

### `backend/app/auth/jwt.py`

- `create_access_token(user_id: int) -> str` — 簽發 JWT，payload 含 `sub`（str）、`exp`、`iat`
- `decode_token(token: str) -> dict` — 驗證並解碼 JWT；過期 → `jwt.ExpiredSignatureError`；無效 → `jwt.InvalidTokenError`

## 2. 核心不變式（Invariants）

### I-1: 密碼 round-trip

```
verify_password(hash_password(pw), pw) == True
```

任意非空字串都成立。不同字串 verify 結果必須為 False：

```
verify_password(hash_password("correct"), "wrong") == False
```

### I-2: bcrypt 雜湊每次不同（salt randomization）

同一明文兩次 hash_password 產生不同雜湊值（bcrypt gensalt 是 random）。
但兩個不同雜湊對同一明文 verify 都必須回傳 True。

### I-3: JWT round-trip — sub 欄位是 str(user_id)

```
decode_token(create_access_token(user_id))["sub"] == str(user_id)
```

`create_access_token` 接受 int，payload["sub"] 儲存為 str。

### I-4: 無效 token 一定 raise

- Token 篡改（任何字元變動）→ `jwt.InvalidTokenError`（`DecodeError` 是其 subclass）
- 完全亂碼 token → 同上

### I-5: 72-byte 截斷行為（bcrypt 硬限制）

超過 72 bytes 的 UTF-8 明文，第 73 byte 起的部分被 truncate。
兩個只在第 73 byte 後相異的明文，互相 verify 回傳 True（這是 bcrypt 的已知行為，本 spec 顯式記錄而非迴避）。

## 3. 設計說明

- bcrypt cost=12：登入冷路徑可接受，比 cost=10 高 4x 計算成本（2026-06 現行配置）
- JWT 使用 `settings.jwt_secret_key` + `settings.jwt_algorithm`（讀自 `.env`）
- Token expiry 由 `settings.jwt_expire_minutes` 決定；spec tests 使用測試 secret，不需要真實 DB

## 4. 反模式（不要做）

- ❌ 把明文密碼存進 DB — 只存 hash_password 的輸出
- ❌ 用 `==` 比較密碼字串 — 用 `verify_password`（timing-safe bcrypt.checkpw）
- ❌ 縮短 JWT expiry 到 < 1 分鐘（會在 classroom load 途中過期）
- ❌ 在 token payload 塞敏感資訊（role/email）— payload 可 base64 解碼

## 5. 注意：與 test_characterization_auth_policies.py 的分工

`test_characterization_auth_policies.py` → classroom 層的業務邏輯（owner/member/admin/403）
`test_auth_spec.py`（本 spec）→ 最底層密碼+token 純函式
兩者不重疊，互補。
