---
spec_id: assignment.lifecycle.status
module: assignment-lifecycle
title: 作業生命週期 — submission status 值域 + 輸入淨化契約
stability: active
canonical_source: backend/app/services/assignment_lifecycle_service.py
owns_code:
  - backend/app/services/assignment_lifecycle_service.py
  - backend/app/services/assignment_session_service.py
spec_tests:
  - backend/specs/test_assignment_lifecycle_spec.py
related_issues: [1762, 1764, 1766]
last_reviewed: 2026-06-02
owner: young
---

# 作業生命週期：submission status 值域 + 輸入淨化契約

> 這份是給**人**讀的 spec（方大哥 / 實習生 / AI 改作業流程）。
> 機器可驗的契約在 `backend/specs/test_assignment_lifecycle_spec.py`。
> 修 assignment_lifecycle_service.py 前先讀這份。

## 1. 這個 module 在管什麼

`AssignmentSubmission.status` 控制一個學生作業的狀態機。
`assignment_lifecycle_service.py` + `assignment_session_service.py` 是唯二修改 status 的地方。

## 2. Status 值域（有限集合）

實際在 production code 中出現的 status 字串：

| status | 語意 | 設定位置 |
|--------|------|---------|
| `pending` | 教師建立作業時，系統為每位學生預建 submission | lifecycle_service.py:265 |
| `in_progress` | 學生開始作答（LearningSession 建立）| session_service.py |
| `submitted` | 學生完成提交 | session_service.py |
| `graded` | 教師評分後 | lifecycle_service.py:408 |
| `abandoned` | 對應 assignment 被刪除，session 被標記清理 | lifecycle_service.py:385 |

`AssignmentSubmission` model 的 String(20) column（最大 20 字元）。

**目前沒有 Enum/CheckConstraint** — status 值只靠 application 層約束。
這是技術債：未來應加 DB CHECK constraint 或 Enum 列型別。

## 3. 核心不變式（Invariants）

### I-1: 新建 submission 一定以 `pending` 開始

`create_assignment_with_submissions` 為每位學生建的 `AssignmentSubmission`
初始 status 一律是 `"pending"`。任何其他初始值都是 bug。

### I-2: `grade_assignment_submission` 強制把 status 改為 `graded`

無論 payload 傳什麼，評分後 submission.status 一定是 `"graded"`。
（status 不由 payload 決定，由函式強制設定。）

### I-3: `delete_assignment_with_cleanup` 把關聯 session status 設為 `abandoned`

作業刪除時，所有關聯的 `LearningSession.status` 被設為 `"abandoned"`，
不是刪除（保留稽核軌跡），不是 `"completed"`。

### I-4: 教師輸入的文字欄位在進入 DB 前必須過淨化

`create_assignment` 和 `grade_assignment_submission` 中，
`title`、`description`、`teacher_feedback` 都通過 `sanitize_ai_input`。
（詳見 input-sanitizer module spec。）

### I-5: 已知 status 集合（code-as-spec）

```python
KNOWN_SUBMISSION_STATUSES = {"pending", "in_progress", "submitted", "graded", "abandoned"}
```

任何新增的 status 字串必須加入此集合（並更新這份 spec）。

## 4. 狀態轉移圖（非強制，文件用途）

```
pending → in_progress → submitted → graded
    ↓
abandoned  (assignment 被刪除時)
```

- `abandoned` 只由 delete 路徑觸發，不由學生操作觸發
- status 不保證是單向的（技術上 code 可以設任意字串）；enforcement 靠 spec tests

## 5. 待查事項

- **是否有 `pending → abandoned` 的路徑？**（學生從未開始、assignment 就被刪）
  → 根據 lifecycle_service.py L385，是的。cleanup 遍歷所有 linked sessions，
  但 submission 可能還是 `pending`（如果學生沒開始）。Session.status 設 `abandoned`，
  但 submission.status 是否也被設？待查 `delete_assignment_with_cleanup` 完整邏輯。
- **是否有 DB-level CHECK constraint？** → 目前沒有（看 models/assignment.py）。
  未來如果加 migration 必須與此 spec 的已知值域對齊。

## 6. 反模式（不要做）

- ❌ 在 `assignment_lifecycle_service` 之外設 `submission.status`（繞過集中管理）
- ❌ 把 `graded` 改成任何其他字串（teacher dashboard 的 filter 直接用 "graded" 字串）
- ❌ 在 pending 之外初始化 submission — 教師還沒通知學生，學生不應看到非 pending 狀態
- ❌ delete 後不 set `abandoned` 而是刪掉 LearningSession — 會破壞稽核軌跡
