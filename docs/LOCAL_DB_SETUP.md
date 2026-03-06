# 本地開發資料庫設定

> 後端使用 PostgreSQL，本地開發需先安裝並建立資料庫。

---

## 1. 安裝 PostgreSQL

### macOS (Homebrew)

```bash
brew install postgresql@15
brew services start postgresql@15
```

驗證安裝：

```bash
psql --version
# psql (PostgreSQL) 15.x
```

### Windows

下載安裝包：https://www.postgresql.org/download/windows/

安裝時記住你設定的密碼（預設 superuser 是 `postgres`）。

---

## 2. 建立資料庫

```bash
# 進入 psql（macOS Homebrew 預設用你的系統使用者名稱）
psql postgres

# 在 psql 裡執行：
CREATE DATABASE lingoleap;
CREATE USER lingoleap_dev WITH PASSWORD 'lingoleap_dev';
GRANT ALL PRIVILEGES ON DATABASE lingoleap TO lingoleap_dev;
ALTER DATABASE lingoleap OWNER TO lingoleap_dev;
\q
```

驗證連線：

```bash
psql -U lingoleap_dev -d lingoleap -h localhost
# 能進入就代表成功，輸入 \q 離開
```

---

## 3. 設定環境變數

```bash
cd backend
cp .env.example .env
```

編輯 `backend/.env`，把 `DATABASE_URL` 改成你剛建的資料庫：

```
DATABASE_URL=postgresql://lingoleap_dev:lingoleap_dev@localhost:5432/lingoleap
```

其他欄位：
- `GEMINI_API_KEY` — 如果不測 AI 功能可以留空
- `ALLOWED_ORIGINS` — 本地開發保持 `http://localhost:3000`

---

## 4. 執行 Migration

```bash
cd backend
pip install -r requirements.txt
alembic upgrade head
```

這會建立所有資料表（users, roles, organizations, schools, classrooms 等）並 seed 8 個預設角色。

驗證資料表：

```bash
psql -U lingoleap_dev -d lingoleap -c "\dt"
```

應該看到：`users`, `roles`, `user_roles`, `student_profiles`, `organizations`, `schools`, `classrooms`, `classroom_students`, `texts`, `learning_sessions` 等表。

---

## 5. 啟動後端

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

測試 API：

```bash
# 註冊帳號
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@test.com", "password": "test1234", "name": "測試用戶"}'

# 登入
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@test.com", "password": "test1234"}'
```

---

## 6. 常見問題

### `psql: error: connection refused`

PostgreSQL 沒有啟動：

```bash
brew services start postgresql@15
```

### `FATAL: role "xxx" does not exist`

用你的系統使用者名稱連線，或建立對應的 role：

```bash
psql postgres -c "CREATE ROLE xxx WITH LOGIN SUPERUSER;"
```

### `alembic upgrade head` 失敗

1. 確認 `DATABASE_URL` 在 `.env` 裡設定正確
2. 確認 PostgreSQL 正在運行
3. 確認 `lingoleap` 資料庫存在

### 想重建資料庫（清除所有資料）

```bash
psql postgres -c "DROP DATABASE lingoleap;"
psql postgres -c "CREATE DATABASE lingoleap OWNER lingoleap_dev;"
cd backend && alembic upgrade head
```

---

*最後更新：2026-03-06*
