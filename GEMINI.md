# GEMINI.md — LingoLeap (國語文閱讀學習平台)

AI 閱讀教學平台。前端 React 19 + Vite + Tailwind，後端 FastAPI + PostgreSQL + SQLAlchemy，部署於 GCP Cloud Run。完整慣例見 `CLAUDE.md` 與 `AGENTS.md`（本檔只列 Gemini 必讀的關鍵規則）。

## Modular Spec System (`specs/`)

改 backend code 或 lesson 資料前，**先查該段是否被某個 spec module 擁有**：

1. 讀 `specs/registry.yaml` — 索引，列出每個 module 的 `owns_code` / `owns_data`
2. 要動的檔案落在某 module → 讀該 `specs/modules/<feature>/INTENT.md`（人讀規格，寫明什麼能改/不能改）+ 需要時 `backend/specs/test_<feature>_spec.py`（機器契約）
3. 改完跑 `cd backend && python -m pytest specs/` — 契約 fail = code/data 偏離意圖（修 code 或更新規格，二擇一）
4. 新功能沒對應 module → 先建 `specs/modules/<feature>/INTENT.md` 再寫 code

目的：只載入當下功能需要的規格，不吞整份 PRD / 全會議記錄，避免吃太多無關 context 而誤判。完整說明 `specs/README.md`。

## 其他關鍵規則（同 CLAUDE.md）

- 改 SQLAlchemy model / Alembic migration → 先看 `sqlalchemy-model-safety` 原則（FK index、cascade、idempotent DDL、single head）
- 新增呼叫 LLM 的 FastAPI route → 先看 `llm-endpoint-hardening`（rate-limit、auth、input cap、fail-closed、reasoning field）
- Git flow：`feature/* → staging → main`，PR review 過才 merge
