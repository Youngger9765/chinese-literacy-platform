---
spec_id: learning.stats.completed_story_canonical
module: learning-stats
title: 學習統計 — 完成課文的唯一定義（canonical completion clause）
stability: active
canonical_source: backend/app/services/learning_stats_service.py
owns_code:
  - backend/app/services/learning_stats_service.py
spec_tests:
  - backend/specs/test_learning_stats_spec.py
related_issues: [1181, 1192]
last_reviewed: 2026-06-02
owner: young
---

# 學習統計：完成課文的唯一定義

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生）。機器可驗的契約在
> `backend/specs/test_learning_stats_spec.py`。改 `learning_stats_service.py` 前先讀這份。

## 1. 這個 module 在管什麼

`learning_stats_service.py` 是跨 dashboard、進度、和遊戲化三個端點的**共享統計層**。
核心問題：一個學習 session 什麼時候算「完成」？

這個問題有兩條路徑（來自 Issue #1181）：

- **直接完成**：`LearningSession.status == 'completed'`
- **作業路徑**：session 有一個 `AssignmentSubmission` 且 status 在 `('submitted', 'graded')`
  — 因為作業提交端點**沒有**更新 `LearningSession.status`（已知 bug，保留為設計現況）

## 2. 唯一真相（canonical source）

`_is_session_done_clause()` 是「完成」的**單一定義**。所有需要判斷課文是否完成的
端點都必須引用這個函式，不允許在各端點自行寫 `status == 'completed'`。

```python
# 正確用法（學習）
from ..services.learning_stats_service import _is_session_done_clause

count = db.query(func.count(distinct(LearningSession.story_slug)))
         .filter(LearningSession.student_id == sid, _is_session_done_clause())
         .scalar()
```

## 3. 公共 API

| 函式 | 說明 |
|------|------|
| `get_completed_story_count(db, student_id)` | 回傳 `int`，永不為負數，即使無資料也回傳 `0`（不是 `None`） |
| `get_completed_story_slugs(db, student_id)` | 回傳 `list[str]`，元素不重複（distinct 查詢） |

兩個函式使用相同的 `_is_session_done_clause()` filter，確保 count 和 slugs 永遠一致：
`len(get_completed_story_slugs(db, sid)) == get_completed_story_count(db, sid)`。

## 4. 待查（無法在無 DB 環境驗證）

以下不寫 pytest contract（需要真實或 mock DB）：

- `_is_session_done_clause()` 的 OR 邏輯在 PostgreSQL 執行的正確性 — 待查
- `get_completed_story_count` 和 `get_completed_story_slugs` 的一致性（count == len(slugs)）— 待查（需 DB 整合測試）
- 空資料集時 `scalar()` 是否真的回傳 `0`（不是 `None`）— 代碼有 `int(result or 0)` 轉換，邏輯清楚，但未在本 spec 環境跑

## 5. 允許 / 禁止的改動

✅ **允許**
- 在 `_is_session_done_clause()` 加入新的完成路徑（例如：未來的 `status == 'reviewed'`）
- 新增使用 `_is_session_done_clause()` 的統計函式

⛔ **禁止（會破壞契約）**
- 在各端點 route 直接寫 `LearningSession.status == 'completed'`（繞過 canonical clause）
- 讓 `get_completed_story_count` 回傳 `None`（呼叫端預期 `int`）
- 在 `_is_session_done_clause()` 移除 AssignmentSubmission 分支（會漏算作業路徑的完成）

## 6. Open questions

- Issue #1181（session status 未更新）什麼時候修？修了之後 OR 邏輯是否可簡化？
- 是否要把 `_is_session_done_clause` 改成 public function 並加到 `__all__`？
  （目前以 `_` 前綴表示 module-internal，但多處 route 直接引用）

## 7. 怎麼維護這份 spec

- 改 completion clause（Issue #1181 修復時）→ 更新本檔 §2 + 更新 `_is_session_done_clause()` 的 docstring
- 新增統計函式 → 更新 §3 表格
- 修 completion route 讓 `LearningSession.status` 正確更新 → 評估是否可簡化 OR 邏輯並更新 §4 待查
