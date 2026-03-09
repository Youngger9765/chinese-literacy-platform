# 開發指南

**國語文閱讀學習平台（LingoLeap）**
版本 1.0 | 2026 年 3 月

> 本文件供開發者使用，說明本地環境設定、開發流程與測試方式。

---

## 目錄

1. [本地環境設定](#1-本地環境設定)
2. [開發工作流程](#2-開發工作流程)
3. [Git 分支策略](#3-git-分支策略)
4. [測試](#4-測試)
5. [CI/CD 說明](#5-cicd-說明)
6. [常見開發問題](#6-常見開發問題)

---

## 1. 本地環境設定

### 前置需求

| 工具 | 最低版本 | 安裝說明 |
|------|---------|---------|
| Node.js | 20.x | [nodejs.org](https://nodejs.org/)（官方下載） |
| Python | 3.11+ | [python.org](https://python.org/)（官方下載） |
| PostgreSQL | 15 | [postgresql.org](https://www.postgresql.org/) |
| Git | 任意 | 系統預裝或 [git-scm.com](https://git-scm.com/) |
| gcloud CLI | 最新 | [cloud.google.com/sdk](https://cloud.google.com/sdk/docs/install) |

### 1.1 Clone 專案

```bash
git clone https://github.com/your-org/chinese-literacy-platform.git
cd chinese-literacy-platform
```

### 1.2 前端設定

```bash
cd frontend
npm install
```

建立 `.env.local` 設定 API URL：

```env
VITE_API_URL=http://localhost:8000
```

啟動開發伺服器：

```bash
npm run dev
# 開啟 http://localhost:3000
```

### 1.3 後端設定

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

建立 `.env` 檔案：

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/lingoleap
SECRET_KEY=your-dev-secret-key-at-least-32-chars
ALLOWED_ORIGINS=http://localhost:3000
```

啟動後端：

```bash
uvicorn app.main:app --reload --port 8000
# API 文件：http://localhost:8000/docs
```

### 1.4 本地資料庫設定

```bash
# 建立資料庫
createdb lingoleap

# 執行 migration
cd backend
alembic upgrade head

# 確認 migration 版本
alembic current
```

詳細資料庫設定請參考 `docs/LOCAL_DB_SETUP.md`。

### 1.5 Vertex AI 設定（AI 功能）

本地開發如需呼叫 AI 功能（蘇格拉底對話、朗讀分析）：

```bash
# 1. 確認 gcloud 設定正確
gcloud config configurations activate lingoleap
gcloud config list

# 2. 取得應用程式預設憑證（ADC）
gcloud auth application-default login
```

> AI 功能需要連到 GCP Vertex AI，本地開發會消耗 GCP 費用，建議只在需要測試 AI 功能時啟用。

---

## 2. 開發工作流程

### 標準開發流程

所有功能開發必須透過 Issue + PR 流程進行，**絕對禁止直接 commit 到 staging 或 main**。

```
1. 在 GitHub 建立或選擇 Issue
2. 建立 Worktree + Feature Branch（從 staging）
3. 開發並在本地測試
4. Push feature branch
5. 開 PR to staging（CI 會自動部署 PR Preview）
6. 在 PR Preview 測試
7. 等待 Code Review 通過
8. Merge to staging
9. （定期）從 staging PR to main → Production
```

### Worktree 工作流程

使用 git worktree 隔離每個 Issue 的開發環境：

```bash
# 確認在 staging 分支
cd /path/to/project
git checkout staging

# 建立 worktree（分支名稱格式必須正確）
git worktree add ../project-issue-N -b fix/issue-N-description staging

# 進入 worktree 開發
cd ../project-issue-N
# ... 開發、測試 ...

# Push
git push -u origin fix/issue-N-description

# 開 PR 後，清理 worktree
git worktree remove ../project-issue-N --force
git branch -D fix/issue-N-description
```

### 分支命名規則

格式必須嚴格遵守，CI 的 PR Preview 部署依賴此規則：

| 類型 | 格式 | 範例 |
|------|------|------|
| Bug fix | `fix/issue-N-description` | `fix/issue-42-reading-accuracy` |
| 新功能 | `feat/issue-N-description` | `feat/issue-87-heatmap` |

> **不可使用** `fix/description-N` 或 `fix/description` 格式，CI 不會觸發 preview 部署。

---

## 3. Git 分支策略

```
feature/*  ──PR──>  staging  ──PR──>  main
    │                  │                │
    ▼                  ▼                ▼
PR Preview          Staging         Production
（臨時）           （持久）         （持久）
```

| 分支 | 環境 | 自動部署 |
|------|------|---------|
| `main` | Production | push to main |
| `staging` | Staging | push to staging |
| `feat/issue-*` 或 `fix/issue-*` | PR Preview | PR 開啟/更新 |

### Commit Message 規範

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: add classroom heatmap (Related to #87)
fix: correct reading accuracy calculation (Related to #42)
refactor: extract ai_service helper functions
docs: update API reference for learning endpoints
test: add socratic agent evaluation test cases
chore: bump dependencies
```

- **不使用** "Fixes #N" 在 commit message，留給 PR title/body 使用
- Commit message 使用英文
- **禁止** `--no-verify` 跳過 pre-commit hooks

---

## 4. 測試

### 後端測試

```bash
cd backend
pytest                          # 執行所有測試
pytest tests/unit/              # 單元測試
pytest tests/integration/       # 整合測試
pytest -v -k "test_auth"        # 執行特定測試
```

### Socratic Agent 評估測試

```bash
cd backend
# 執行評估套件（16 個測試案例）
python tests/agent-eval/run_eval.py

# 加入多次執行取多數決（推薦）
python tests/agent-eval/run_eval.py --runs 3

# A/B 比較不同模型
python tests/agent-eval/compare_models.py
```

> AI 測試有不確定性，建議用 `--runs 3` 確保結果可靠。

### 前端測試

```bash
cd frontend
npm run test      # 執行單元測試
npm run lint      # TypeScript lint 檢查
npm run build     # 確認 build 成功
```

---

## 5. CI/CD 說明

### GitHub Actions Workflows

| Workflow | 觸發條件 | 說明 |
|----------|---------|------|
| `deploy.yml` | push to `main` | 部署到 Production |
| `staging-deploy.yml` | push to `staging` | 部署到 Staging |
| `preview-deploy.yml` | PR 開啟/更新 | 部署 PR Preview 環境 |
| `preview-cleanup.yml` | PR 關閉 | 清除 PR Preview 資源 |

### PR Preview 環境

PR 開啟後，CI 會自動：
1. 建立 PR Preview 環境（backend + frontend）
2. 在 PR comment 中貼上 Preview URL
3. PR 關閉後，自動刪除 Preview 環境和 Docker images

Preview URL 格式：
- Frontend: `lingoleap-frontend-pr-{N}-xxx.asia-east1.run.app`
- Backend: `lingoleap-backend-pr-{N}-xxx.asia-east1.run.app`

### CI Required Secret

`GCP_SA_KEY`：GCP Service Account 的 JSON key，需在 GitHub Repo Settings > Secrets 中設定。

Service Account 需要的 IAM 角色：
- Cloud Run Admin
- Artifact Registry Writer
- Cloud SQL Client
- Service Account User

---

## 6. 常見開發問題

### Q：本地後端啟動失敗（資料庫連線錯誤）

確認 PostgreSQL 是否執行：

```bash
pg_ctl status -D /usr/local/var/postgresql@15
# 或
brew services list | grep postgresql
```

若未執行：

```bash
brew services start postgresql@15
```

---

### Q：Alembic migration 衝突

當多個 branch 同時修改 DB schema 時，可能產生 migration 衝突：

```bash
# 查看 migration 分支狀況
alembic history --verbose

# 手動解決衝突
# 1. 確認 head revision
alembic heads
# 2. 若有兩個 head，需要 merge migration
alembic merge -m "merge migrations" <rev1> <rev2>
alembic upgrade head
```

> **重要**：schema 變更需要事先告知 Lead，避免衝突。

---

### Q：Vertex AI 權限錯誤（403 Permission Denied）

```bash
# 確認 gcloud 設定
gcloud config list

# 重新取得 ADC
gcloud auth application-default login

# 確認目前帳號
gcloud auth list
```

> 不要執行 `gcloud auth login`，tokens 已快取在 `~/.config/gcloud/`。

---

### Q：前端 CORS 錯誤

確認後端的 `ALLOWED_ORIGINS` 環境變數包含前端 URL：

```env
# .env
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

---

### Q：蘇格拉底對話 422 Session Not Found

Cloud Run 重啟（redeploy）後，in-memory session 會清除。前端已實作自動重建機制，若仍有問題：

1. 重新整理頁面
2. 重新進入課文的步驟四

---

### Q：PR Preview 沒有部署

確認分支名稱格式正確：
- 必須是 `fix/issue-N-*` 或 `feat/issue-N-*`
- 不能是 `fix/description` 或 `feature/description-N`

CI workflow 會過濾非 issue 格式的分支。

---

## 參考資源

- 技術架構：`docs/handover/technical-overview.md`
- API 文件：`docs/handover/api-reference.md`
- 資料庫本地設定：`docs/LOCAL_DB_SETUP.md`
- 本地開發詳細流程：`docs/DEVELOPMENT_GUIDE.md`
- 技術決策紀錄：`docs/TECHNICAL_DECISION.md`
