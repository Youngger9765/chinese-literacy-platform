# LingoLeap 管理員操作手冊

> 版本：v1.0 | 更新日期：2026-03-09 | 適用對象：系統管理員、技術維運人員

---

## 目錄

1. [系統架構](#系統架構)
2. [部署環境](#部署環境)
3. [日常維運](#日常維運)
4. [監控與告警](#監控與告警)
5. [資料庫維護](#資料庫維護)
6. [故障排除](#故障排除)
7. [CI/CD 流程](#cicd-流程)

---

## 系統架構

```
Frontend (React 19 + Vite + Tailwind)
  └── Cloud Run: lingoleap-frontend

Backend (FastAPI + SQLAlchemy)
  └── Cloud Run: lingoleap-backend
       ├── Cloud SQL: PostgreSQL 15 (lingoleap-db, asia-east1)
       ├── Vertex AI Gemini (us-central1, service account auth)
       └── Artifact Registry (asia-east1)
```

### 關鍵組件

| 組件 | 技術 | 說明 |
|------|------|------|
| 前端 | React 19 + TypeScript + Tailwind CSS | SPA，由 Cloud Run 提供服務 |
| 後端 | FastAPI + Python 3.12 | RESTful API + WebSocket |
| 資料庫 | PostgreSQL 15 on Cloud SQL | 用戶資料、學習記錄 |
| AI 服務 | Vertex AI Gemini 2.5 Flash | 蘇格拉底對話、朗讀評估 |
| CI/CD | GitHub Actions | 自動建置與部署 |

---

## 部署環境

### GCP 設定

```bash
# 切換到正確的 gcloud config
gcloud config configurations activate lingoleap

# 確認當前 config
gcloud config list
```

| 設定 | 值 |
|------|-----|
| Project | `lingoleap-dev` |
| Region | `asia-east1` |
| AI Region | `us-central1`（Vertex AI 僅此 region 支援） |

### 環境說明

| 環境 | Branch | 說明 |
|------|--------|------|
| Production | `main` | 正式生產環境，推送到 main 自動部署 |
| Staging | `staging` | 測試環境，供教師和學生測試新功能 |
| PR Preview | `feat/issue-N-*` | 臨時預覽環境，PR 關閉後自動刪除 |

### 手動部署

**後端**
```bash
# 建置映像
gcloud builds submit \
  --tag asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/backend:v{VERSION} \
  --project lingoleap-dev \
  ./backend

# 部署到 Cloud Run
gcloud run deploy lingoleap-backend \
  --image asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/backend:v{VERSION} \
  --platform managed \
  --region asia-east1 \
  --project lingoleap-dev
```

**前端**
```bash
# 建置映像
gcloud builds submit \
  --tag asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/frontend:v{VERSION} \
  --project lingoleap-dev \
  ./frontend

# 部署到 Cloud Run
gcloud run deploy lingoleap-frontend \
  --image asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/frontend:v{VERSION} \
  --platform managed \
  --region asia-east1 \
  --project lingoleap-dev \
  --port 8080
```

### 環境變數管理

環境變數透過 Cloud Run 設定，不要 commit 到 git：

| 變數 | 說明 |
|------|------|
| `DATABASE_URL` | Cloud SQL Unix socket 連線字串 |
| `ALLOWED_ORIGINS` | CORS 白名單（前端 URL） |
| `SECRET_KEY` | JWT 簽署密鑰 |

---

## 日常維運

### 查看服務狀態

```bash
# 查看後端 Cloud Run 服務狀態
gcloud run services describe lingoleap-backend \
  --region asia-east1 \
  --project lingoleap-dev

# 查看前端 Cloud Run 服務狀態
gcloud run services describe lingoleap-frontend \
  --region asia-east1 \
  --project lingoleap-dev
```

### 查看即時日誌

```bash
# 後端日誌（最近 100 筆）
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=lingoleap-backend" \
  --limit 100 \
  --project lingoleap-dev \
  --format "table(timestamp, textPayload)"

# 只看錯誤日誌
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=lingoleap-backend AND severity>=ERROR" \
  --limit 50 \
  --project lingoleap-dev
```

### Artifact Registry 映像清理

系統有 4 層防護避免映像堆積：

| 層級 | 機制 | 策略 |
|------|------|------|
| Layer 1 | GCP cleanup-policy | untagged >7天刪除 + tagged 保留最新 10 個 |
| Layer 2 | deploy.yml | `prod-*` 保留最新 3 個 |
| Layer 3 | staging-deploy.yml | `staging-*` 保留最新 3 個 |
| Layer 4 | preview-deploy.yml | PR 關閉後，`issue-N-*` 全部刪除 |

---

## 監控與告警

### 健康檢查

```bash
# 後端 API 健康檢查
curl -s https://lingoleap-backend-{HASH}.asia-east1.run.app/health
# 預期回應: {"status": "ok", "db": "connected"}
```

### 關鍵監控指標

| 指標 | 正常範圍 | 告警閾值 |
|------|---------|---------|
| API 回應時間 | < 500ms | > 2000ms |
| 錯誤率 | < 1% | > 5% |
| Cloud SQL CPU | < 50% | > 80% |
| Cloud Run 記憶體 | < 70% | > 90% |

---

## 資料庫維護

### 連線到 Cloud SQL

```bash
# 使用 Cloud SQL Proxy
cloud-sql-proxy lingoleap-dev:asia-east1:lingoleap-db &
psql -h 127.0.0.1 -U postgres -d lingoleap
```

### 資料庫遷移

**重要：** 執行 migration 前必須先通知相關人員，並在低峰時段執行。

```bash
cd backend

# 查看待執行的 migrations
alembic history

# 執行 migration（先在 staging 測試）
alembic upgrade head

# 回滾（緊急狀況）
alembic downgrade -1
```

### 備份

Cloud SQL 每日自動備份，保留 7 天。

手動建立備份：
```bash
gcloud sql backups create \
  --instance lingoleap-db \
  --project lingoleap-dev
```

---

## 故障排除

### 常見問題診斷

**問題 1：API 回傳 503**

可能原因：
1. AI 服務（Vertex AI）連線問題 → 查看 backend 日誌中的 AI 錯誤
2. 資料庫連線失敗 → 確認 Cloud SQL 狀態
3. Cloud Run 服務重啟 → 查看 Cloud Run console

診斷步驟：
```bash
# 查看最近的錯誤日誌
gcloud logging read \
  "resource.type=cloud_run_revision AND severity>=ERROR" \
  --limit 20 \
  --project lingoleap-dev
```

**問題 2：AI 對話功能失效**

可能原因：
1. Vertex AI Gemini 模型端點問題
2. Service account 權限問題

診斷：
- 確認 AI service location 為 `us-central1`（不是 `asia-east1`）
- 確認 service account 有 `roles/aiplatform.user` 權限

**問題 3：學生登入後出現 422 錯誤（Session Not Found）**

這通常發生在 Cloud Run 重新部署後，記憶體中的 session 被清除。

解法：前端已有自動重建 session 的機制（`SessionExpiredError`），學生重新整理頁面即可。

長期解法：若問題頻繁發生，考慮啟用 Redis 作為 session 儲存。

**問題 4：朗讀功能無聲音**

- 確認瀏覽器已允許麥克風權限
- 確認使用支援 Web Speech API 的瀏覽器（Chrome 最新版建議）

---

## CI/CD 流程

### GitHub Actions Workflows

| Workflow | 觸發條件 | 部署目標 |
|----------|---------|---------|
| `deploy.yml` | push to main | Production |
| `staging-deploy.yml` | push to staging | Staging |
| `preview-deploy.yml` | PR opened/updated/closed | PR Preview（臨時） |

### 查看 CI/CD 狀態

```bash
# 查看最近的 workflow runs
gh run list --limit 10

# 監看特定 run
gh run watch {RUN_ID} --exit-status
```

### 緊急回滾

如果 production 部署有問題：

```bash
# 查看可用的映像版本
gcloud artifacts docker images list \
  asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/backend \
  --project lingoleap-dev

# 部署指定版本
gcloud run deploy lingoleap-backend \
  --image asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap/backend:{PREVIOUS_TAG} \
  --region asia-east1 \
  --project lingoleap-dev
```
