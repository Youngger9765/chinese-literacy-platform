---
spec_id: semester.one_active_invariant
module: semester
title: 學期唯一啟用不變式（pointer module）
stability: active
canonical_source: backend/app/routes/semesters.py + backend/app/models/semester.py
owns_code:
  - backend/app/routes/semesters.py
  - backend/app/models/semester.py
legacy_tests:
  - backend/tests/test_semesters.py
related_issues:
  - 2058
last_reviewed: 2026-06-02
owner: young
---

# Semester：唯一啟用不變式（pointer module）

> **這是 pointer-only module。** 沒有獨立的 `backend/specs/test_semester_spec.py`。
> 所有機器可驗的契約由 `backend/tests/test_semesters.py` 覆蓋，已列於 `legacy_tests:`。

## 1. 這個 module 在管什麼

學期（Semester）屬於某個 School，每間學校在任意時刻最多只有一個 `is_active=True` 的學期。

關鍵路徑：`POST /schools/{school_id}/semesters`（新增學期並設為 active）、`POST /schools/{school_id}/semesters/{id}/activate`（啟用現有學期）。

## 2. 核心不變式（Invariants）

### I-1: 同一 School 最多一個 active 學期

```
新建 active=True 的學期 →
  該 School 所有其他學期的 is_active 被設為 False
```

對應測試（`test_semesters.py`）：
- `test_create_semester_active_deactivates_siblings` — 單元層驗證
- `test_create_active_semester_deactivates_sibling` — API 層驗證
- `test_get_active_semester` / `test_get_active_semester_returns_active` — 查詢一致性

### I-2: activate endpoint 同樣觸發唯一性

啟用一個既有學期時，同 School 其他學期自動 deactivate（與建立新學期行為一致）。

## 3. 為何不建獨立 spec test

`test_semesters.py` 需要真實 DB（SQLAlchemy + PostgreSQL fixtures），無法在 SQLite 模式跑（`DATABASE_URL: sqlite://`）。強行移植到 `backend/specs/` 會複製大量 conftest 設定，維護成本高於收益。

`legacy_tests:` pointer 機制讓 `run-ci.sh` 正式納入這些測試，同時保留原始測試的 DB fixture 環境。
