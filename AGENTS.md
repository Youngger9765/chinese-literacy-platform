# AGENTS.md — OpenAI Codex 規則

> 此檔案供 OpenAI Codex / Copilot Agent 使用
> Claude Code 請看 CLAUDE.md

---

## Git Commit 規則（必須遵守）

使用 Conventional Commits 格式，英文撰寫：

```
feat: add onboarding tour component (Related to #264)
fix: allow blob: in CSP media-src (Fixes #77)
refactor: split teacher.py into sub-modules (Related to #517)
test: add unit tests for font size hook
docs: update README deployment section
```

**格式**：`<type>: <description> (<issue reference>)`

| Type | 用途 |
|------|------|
| feat | 新功能 |
| fix | 修 bug |
| refactor | 重構（不改行為） |
| test | 測試 |
| docs | 文件 |
| chore | 雜務（CI、config） |

**禁止**：
- 中文 commit message
- 沒有 type prefix（如 `update font size`）
- 超過 72 字元的標題

---

## Branch 規則（必須遵守）

**永遠從 `staging` 開 feature branch，不要直接改 staging 或 main**

```bash
git checkout staging
git pull
git checkout -b feat/issue-264-onboarding   # 新功能
git checkout -b fix/issue-77-csp-blob       # 修 bug
```

命名格式：`<type>/issue-<N>-<short-description>`

**禁止**：
- 直接在 `main` 或 `staging` 上 commit
- Branch 名稱沒有 issue 編號

---

## PR 規則

建立 PR 到 `staging`（不是 main）：

```bash
gh pr create --base staging --title "feat: add onboarding tour (Related to #264)" --body "..."
```

PR body 格式：
```markdown
## Summary
- 做了什麼，為什麼

## Test plan
- [ ] 測試步驟 1
- [ ] 測試步驟 2
```

---

## 技術架構

```
Frontend: React 19 + Vite + Tailwind (frontend/)
Backend:  FastAPI + SQLAlchemy + PostgreSQL (backend/)
AI:       Vertex AI Gemini (gemini-2.5-flash, us-central1)
Deploy:   GCP Cloud Run (asia-east1)
```

### 開發指令

```bash
# Frontend
cd frontend && npm install && npm run dev    # localhost:3000

# Backend
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload  # localhost:8000
```

### Staging URL

- Frontend: https://lingoleap-frontend-staging-958347263320.asia-east1.run.app
- Backend: https://lingoleap-backend-staging-958347263320.asia-east1.run.app

---

## Modular Spec System (`specs/`)

Before editing backend code or lesson data, check whether the target file is
owned by a spec module:

1. Read `specs/registry.yaml` (index of all modules, their `owns_code` /
   `owns_data` paths).
2. If the file you are editing appears under a module → read
   `specs/modules/<feature>/INTENT.md` (human-readable SOT) and the
   corresponding `backend/specs/test_<feature>_spec.py` (machine contracts).
3. After changes: run **`bash specs/run-ci.sh`** (local CI = registry-freshness
   gate + all spec contracts). A failing contract means code or data drifted
   from the documented intent; fix the code OR update the spec (but document
   why). Fast registry-only check: `bash specs/run-ci.sh --quick`.
4. No matching module for a genuinely new feature → create
   `specs/modules/<feature>/INTENT.md` before writing code, then rebuild the
   index with `python specs/build_registry.py`.

There are currently **27 modules**. Full index: `specs/registry.yaml`. Full
guide: `specs/README.md`.

**Local CI**: the GitHub Actions auto-run is blocked on a `workflow`-scoped
token (issue 2041). Until that lands, run `bash specs/run-ci.sh` before pushing
any change under `specs/` or `backend/app/services/`. (Last local run: 457
passed / 31 xfailed.)

---

## 禁止事項

- **不要** hardcode API key、密碼、token
- **不要** 用 `--no-verify` 跳過 pre-commit hook
- **不要** 用 `--force` push（除非確定自己在做什麼）
- **不要** 關閉 GitHub Issue（只有 Young 或客戶確認後才能關）
- **不要** 建立 DB migration 檔案（需要先問 Young）
- **不要** 改 `main` branch 的任何東西

---

## 程式碼風格

### Frontend (TypeScript/React)
- 函式元件 + hooks（不用 class component）
- Tailwind CSS（不用 inline style 或 CSS modules）
- 型別用 `interface`，不用 `type` alias（除非 union）

### Backend (Python/FastAPI)
- Type hints on all functions
- 用 `logger.info/warning/error`，不用 `print()`
- API path 用 kebab-case：`/api/teacher/classrooms/{id}/stuck-overview`

---

## 學習流程（7 步驟）

1. 簡介 (Intro)
2. 逐段朗讀 (LiveTutor)
3. 課文理解 (ComprehensionChat)
4. 生字練習 (VocabPractice)
5. 聽寫練習 (DictationPractice)
6. 全文朗讀 (FullReading)
7. 診斷報告 (AssessmentReport)
