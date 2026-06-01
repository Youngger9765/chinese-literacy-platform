---
spec_id: comprehension.grading.schema_and_fail_closed
module: comprehension-grading
title: 課文理解評分 — COMPREHENSION_SCORE_SCHEMA + fail-closed 保證
stability: active
canonical_source: backend/app/services/ai_comprehension.py
owns_code:
  - backend/app/services/ai_comprehension.py
owns_data: []
spec_tests:
  - backend/specs/test_comprehension_grading_spec.py
related_issues: []
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-02
owner: young
---

# 課文理解評分：Schema + Fail-Closed 規格

> 給**人**讀的 spec。機器契約在
> `backend/specs/test_comprehension_grading_spec.py`。改 `ai_comprehension.py`
> 的 schema 或 `evaluate_comprehension()` 前先讀這份。

## 1. 這個 module 在管什麼

`evaluate_comprehension()` 透過 Gemini 評估學生對課文三個層次的理解力，
回傳一個 JSON 物件。這份 spec 管兩件事：

1. **Schema 結構**：AI 回傳的 JSON 必須包含哪些欄位（`COMPREHENSION_SCORE_SCHEMA`）
2. **分數 clamping**：所有分數 clamp 到 0–100，不允許負數或超過 100

## 2. 三層次理解模型

| 層次 | 欄位 | 語意 | 評分指引 |
|------|------|------|---------|
| 字面理解 | `literal_score` | 學生能否回答課文明確事實 | 0–100 |
| 推論理解 | `inferential_score` | 學生能否推論因果 / 隱含義 | 0–100 |
| 評鑑理解 | `evaluative_score` | 學生能否連結自身 / 評論主題 | 0–100 |
| 整體理解 | `comprehension_score` | 加權平均（字面 30% + 推論 40% + 評鑑 30%） | 0–100 |

> 注意：`comprehension_score` 的加權公式在 AI prompt 裡定義，不在 Python 程式碼裡計算；
> Python 只做 clamping。若加權比例需要改，要同步改 prompt 和本 spec。

## 3. JSON Schema 必要欄位（`COMPREHENSION_SCORE_SCHEMA`）

```json
{
  "comprehension_score": number (0-100),
  "literal_score": number (0-100),
  "inferential_score": number (0-100),
  "evaluative_score": number (0-100),
  "feedback": {
    "literal": string (繁體中文),
    "inferential": string (繁體中文),
    "evaluative": string (繁體中文),
    "overall": string (繁體中文)
  }
}
```

全部欄位都是 required。少任何一個 = AI response 格式錯誤。

## 4. Clamping 行為（Python 端，L256–258）

```python
for key in ("comprehension_score", "literal_score", "inferential_score", "evaluative_score"):
    val = result.get(key, 50)
    result[key] = max(0, min(100, float(val)))
```

- 欄位不存在 → fallback 50
- 負數 → clamp 到 0
- 超過 100 → clamp 到 100

> fallback 50（中間值）是語意正確的：若 AI 未回傳分數，50 代表「無資料，假設中等」，
> 不是「完全不理解（0）」也不是「完全理解（100）」。

## 5. 與 `generate_structured_response` 的關係

`evaluate_comprehension()` 呼叫 `generate_structured_response()`，後者負責
呼叫 Gemini 並做 JSON parse。如果 Gemini 回傳的不是合法 JSON、或 JSON 格式不符
`COMPREHENSION_SCORE_SCHEMA`，`generate_structured_response()` 會 raise exception。
**這個 exception 不會被 `evaluate_comprehension()` 吞掉** — 它會往上傳播到路由層。

路由層有自己的 exception handler（→ HTTP 503）。整個鏈路是 fail-closed 的。

## 6. 允許 / 禁止的改動

✅ **允許**
- 改 feedback 評語的語氣 / 長度（不影響 schema）
- 在 `feedback` 物件裡新增子欄位（需同時更新 `COMPREHENSION_SCORE_SCHEMA`）

⛔ **禁止（會破壞契約）**
- 把 required 欄位從 `COMPREHENSION_SCORE_SCHEMA` 的 `required` 清單裡移除
- 把 clamping 的 fallback 從 50 改成 100 或任何非中間值（會給出錯誤的「滿分」fallback）
- 讓 exception 在 `evaluate_comprehension()` 內被 `except` 吞掉並回傳假資料

## 7. Open questions

- 目前 `generate_socratic_question()` 標記為 deprecated（改用 `SocraticAgent.process_answer()`），
  但仍保留在檔案裡作 backward compat。未來 cleanup 時可以移除。
- 三層次加權（30%+40%+30%）目前只在 prompt 裡，不在程式碼裡計算，難以 unit test。
  是否要把這個計算移到 Python 端？（待查）
