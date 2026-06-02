---
spec_id: ai.reading.analysis_schema
module: ai-reading
title: AI 朗讀分析 — 輸出 Schema 契約 + Fail-Closed 語意
stability: active
canonical_source: backend/app/services/ai_reading.py
owns_code:
  - backend/app/services/ai_reading.py
spec_tests:
  - backend/specs/test_ai_reading_spec.py
related_issues: [415]
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-02
owner: young
---

# AI 朗讀分析：輸出 Schema 契約 + Fail-Closed 語意

> 這份是給**人**讀的 spec。機器可驗的契約在 `backend/specs/test_ai_reading_spec.py`。
> `generate_reading_analysis` 本身需要 Gemini SDK，無法在 spec 環境執行。

## 1. 這個 module 在管什麼

`ai_reading.py` 的 `generate_reading_analysis(session_data)` 呼叫 Gemini，
對學生的朗讀數據（正確率、速度、錯誤字等）產出個人化診斷回饋。

這是「閱讀分析路徑」的 AI 段，對應 `reading-eval-safety` spec 管理的「安全驗證路徑」。
`reading-eval-safety` 管的是「朗讀評分演算法（正確率/CPM）」；本 module 管的是
「拿到評分後，AI 如何生成診斷文字」。

## 2. 輸入 Schema

`session_data` dict（非 Pydantic，由 route 組裝）：

| 欄位 | 必填 | 型態 | 說明 |
|------|------|------|------|
| `story_title` | 建議 | str | 課文名（預設 "未知課文"）|
| `accuracy` | 建議 | float | 朗讀正確率（0-100）|
| `cpm` | 建議 | float | 字/分鐘速度 |
| `error_chars` | 建議 | list[str] | 錯誤字清單 |
| `total_characters` | 建議 | int | 課文總字數 |
| `comprehension_score` | 選填 | float\|None | 課文理解力（0-100）|
| `vocab_practiced_count` | 選填 | int\|None | 已練習生字數 |
| `vocab_total_count` | 選填 | int\|None | 總生字數 |
| `dictation_correct_count` | 選填 | int\|None | 聽寫正確數 |
| `dictation_total_count` | 選填 | int\|None | 聽寫總題數 |

選填欄位缺失時 → 自動跳過，只分析有的資料。

## 3. 輸出 Schema（Gemini response_schema）

Gemini 以 JSON mode 生成：

```python
{
    "analysis_summary": str,           # 整體分析摘要（2-3句）
    "strengths": list[str],            # 優點（1-3項）
    "areas_for_improvement": list[str], # 待改善（1-3項）
    "practice_suggestions": list[str],  # 練習建議（2-4項）
    "encouragement_message": str,       # 鼓勵語（1句）
}
```

以上 5 個欄位均為 `required`。`generate_reading_analysis` 把整個 Gemini JSON 作為 dict 回傳，
不做任何欄位包裝。

## 4. Fail-Closed 語意

`generate_reading_analysis` 呼叫 `generate_structured_response`（`ai_base.py`），後者：
- AI 失敗時 raise Exception（不靜默失敗，不回傳部分結果）
- 呼叫端（route `learning.py`）負責 try/except → 回傳友善錯誤訊息

因此 `generate_reading_analysis` 自身**不 catch exception** — 失敗會 propagate。
這是故意設計：診斷分析失敗 → route 顯示「暫時無法生成分析」，不靜默跳過。

## 5. 待查（需 Gemini SDK）

- 所有 5 個必填欄位確實出現在 Gemini 回傳的 JSON 中 — **待查**
- `generate_structured_response` 的 retry 行為（MAX_RETRIES=3）— 待查
- Content filter trigger 行為（GeminiContentFilterError propagation）— 待查
- `max_tokens=2048` 是否足夠（長課文 + 多項 enrichment 欄位）— 待查

## 6. 與 reading-eval-safety 的邊界

| Module | 負責 |
|--------|------|
| `reading-eval-safety` | 朗讀正確率計算、CPM、pass/fail 判定（純算法，無 AI）|
| `ai-reading`（本模組）| 拿到評分後，AI 生成診斷文字 |

兩個 module 邊界清楚 — 不互相呼叫。

## 7. 允許 / 禁止的改動

✅ **允許**
- 在 `user_prompt_lines` 加入更多 enrichment 欄位（Issue #415 pattern）
- 調整 `system_prompt` 教學語氣

⛔ **禁止（會破壞契約）**
- 從 `response_schema` 的 `required` 移除任何欄位（呼叫端假設這 5 個欄位必定存在）
- 讓 `generate_reading_analysis` catch 所有 exception 並回傳空 dict（破壞 fail-closed 語意）
