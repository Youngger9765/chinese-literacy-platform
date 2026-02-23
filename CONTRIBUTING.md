# Contributing to LingoLeap

## 開發環境設置

### 前端

```bash
cd frontend
npm install
npm run dev    # http://localhost:3000
```

### 後端

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload  # http://localhost:8000
```

環境變數：複製 `.env.example` 到 `.env`，填入本地設定。
AI 呼叫走 Vertex AI service account（需要 `gcloud auth application-default login`）。

---

## Git Branch 策略

```
feature/*  ──PR──>  staging  ──PR──>  main
```

| Branch | 環境 | 說明 |
|--------|------|------|
| `main` | Production | 穩定版本，只接受從 staging 的 PR |
| `staging` | Staging | 團隊測試，feature branch merge 到這裡 |
| `feature/*` | PR Preview | 個人開發，PR 時自動部署 preview |

### 開發流程

1. 從 `staging` 建立 feature branch
2. 開發完成後 push 並開 PR to `staging`
3. PR 會自動部署 preview 環境（URL 會貼在 PR comment）
4. Review + 測試通過後 merge 到 `staging`
5. Staging 穩定後，由 lead 發 PR merge 到 `main`

### Branch 命名

```
feature/issue-{N}-short-description   # 功能開發
fix/issue-{N}-short-description       # Bug 修復
docs/short-description                # 文件更新
```

---

## Commit 規範

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: add live tutor reading feedback
fix: correct Socratic dialogue 422 error
docs: update API documentation
refactor: restructure speech recognition pipeline
test: add eval test cases for answer evaluation
chore: update CI/CD workflow
```

- Commit message 用**英文**
- PR description 可以用中文
- 關聯 Issue：在 commit body 或 PR description 加 `#N`

---

## PR 流程

1. PR title 格式：`feat: 簡短描述 (#N)`
2. 填寫 Summary + Test Plan
3. CI 通過（lint + build + deploy preview）
4. 至少一人 review（或 lead approve）
5. Merge 用 **Squash and Merge**

---

## API 約定

### 命名規範

| 層級 | 風格 | 範例 |
|------|------|------|
| URL path | kebab-case | `/api/learning-sessions` |
| JSON request/response | snake_case | `story_title`, `student_answer` |
| Frontend TypeScript | camelCase | `storyTitle`, `studentAnswer` |

### 常用 Status Codes

| Code | 用途 |
|------|------|
| 200 | 成功 |
| 201 | 建立成功 |
| 422 | 驗證錯誤（Pydantic validation） |
| 429 | Rate limit |
| 503 | AI 服務暫時不可用 |

### Response 格式

成功：直接回傳資料物件（FastAPI response_model）

錯誤：
```json
{ "detail": "錯誤描述" }
```

---

## 專案結構

```
frontend/
  src/
    components/reading-steps/   # 六大學習步驟元件
    components/stroke-order/    # 筆順練習
    components/zhuyin/          # 注音處理（BpmfIansui font）
    services/api.ts             # API 呼叫層（所有 fetch 都在這）

backend/
  app/
    main.py                     # FastAPI 入口 + CORS
    routes/                     # API 路由
    services/                   # 業務邏輯（AI service, Socratic Agent）
    models/                     # SQLAlchemy DB Schema
```

---

## 技術棧

| 層級 | 技術 |
|------|------|
| 前端 | React 19 + Vite + Tailwind CSS + TypeScript |
| 後端 | FastAPI + SQLAlchemy + PostgreSQL |
| AI | Google Vertex AI Gemini 2.5 Flash |
| 部署 | GCP Cloud Run + Cloud SQL + Artifact Registry |
| CI/CD | GitHub Actions（push/PR 自動部署） |

---

## 六大模組對應

| 模組 | GitHub Label | 說明 |
|------|-------------|------|
| 前台學習 | `mod:frontend-learning` | 逐段朗讀、生字練習、課文理解、全文朗讀 |
| Agent Builder | `mod:agent-builder` | 蘇格拉底對話、朗讀即時回饋 |
| 歷程及報告 | `mod:reports` | 儀表板 + 完整報告 |
| 校班師生課 | `mod:school-class` | 自學 / 作業模式 |
| 遊戲化 | `mod:gamification` | 激勵機制 |
| 後台 | `mod:admin-backend` | 課文上架、知識樹編輯 |
