---
spec_id: exit.ticket.schema_and_scoring
module: exit-ticket
title: 學習出場券 — 題目轉換 + 答案計分契約
stability: active
canonical_source: backend/app/services/exit_ticket_service.py
owns_code:
  - backend/app/services/exit_ticket_service.py
spec_tests:
  - backend/specs/test_exit_ticket_spec.py
related_issues: [463, 1369, 1402]
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-02
owner: young
---

# 學習出場券：題目轉換 + 答案計分契約

> 這份是給**人**讀的 spec。機器可驗的契約在 `backend/specs/test_exit_ticket_spec.py`。

## 1. 這個 module 在管什麼

學習出場券（Exit Ticket）是學生完成一課後的快速驗收問答（MCQ 4 選 1）。
本 module 管：
1. **YAML → 題目轉換**（`_from_lesson_yaml`）：lesson YAML 的 `multiple_choice` 欄位 → exit-ticket schema
2. **答案計分**（`calculate_score`）：學生提交的答案 → `{score, correct_count, total}`

## 2. YAML-first 策略（Issue #1402）

優先從 lesson YAML 的 `multiple_choice` 讀取預製題目（158 篇課文全部有），
**不呼叫 AI**。只有 YAML 沒有 MCQ 時才呼叫 Gemini，AI 不可用時回傳 `source: fallback`。

此策略每月省約 24M tokens（100 學生 × 158 課 × 1 session/day）。

## 3. `_from_lesson_yaml` 題目轉換契約

**輸入 YAML schema（Issue #1369 docx parser 定義）**：
```yaml
multiple_choice:
  - question: "..."
    options: [A_text, B_text, C_text, D_text]
    answer: "A" | "B" | "C" | "D"
```

**輸出 exit-ticket schema**：
```python
{"id": int, "question": str, "options": list[4], "correct_index": int(0-3), "explanation": ""}
```

**關鍵規則**：
- `options` 少於 4 個 → 整題跳過（不產生不完整題目）
- `answer` → `correct_index`：`A→0, B→1, C→2, D→3`
- `correct_index` 永遠 clamp 到 `[0, 3]`（防止越界）
- `explanation` 永遠是空字串（YAML 階段不提供解說）
- `id` 從 1 開始遞增（不是 0-based）

## 4. `calculate_score` 計分契約

**輸入**：
- `questions`: 題目列表（帶 `correct_index`）
- `answers`: `[{"question_id": int, "selected_index": int}, ...]`

**輸出**：`{"score": int(0-100), "correct_count": int, "total": int}`

**關鍵規則**：
- `score = round(correct_count / total * 100)`，`total > 0` 時
- `questions` 或 `answers` 為空時 → `score=0, correct_count=0`
- 答案 `question_id` 用 map 查找，未提交題目視為答錯（不算分）
- `score` 永遠在 `[0, 100]` 範圍內（round 不會超出）
- `PASSING_SCORE = 60`（模組常數，用在報告端篩選，不影響計分邏輯）

## 5. AI fallback 行為（待查）

`generate_exit_ticket_questions` 呼叫 AI 的路徑因需要 Gemini SDK 連線，
無法在本 spec 環境驗證。以下行為在程式碼中可見但未機器驗證：

- AI 呼叫拋出 Exception → `source: fallback, questions: []` — **待查**
- AI 回傳 `fallback=True` → `source: fallback, questions: []` — **待查**
- YAML 有 MCQ → 不呼叫 AI — 可在 unit test 中驗（見 spec_tests）

## 6. 允許 / 禁止的改動

✅ **允許**
- 改 `PASSING_SCORE`（需同步更新報告端邏輯）
- 讓 `explanation` 填入 AI 生成的解說（改 `_from_lesson_yaml` 時）

⛔ **禁止（會破壞契約）**
- 讓 `correct_index` 超出 `[0, 3]` 範圍
- 在 `options < 4` 時產生題目（前端假設固定 4 選 1）
- 讓 `calculate_score` 在空輸入時回傳 `None` 或 `score > 0`

## 7. Open questions

- `explanation` 未來是否由 AI 填入（需改 `_from_lesson_yaml` schema）？
- `id` 是否要改成 lesson YAML 的某個穩定識別符（目前是 enumerate index + 1）？
