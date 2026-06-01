---
spec_id: ai.usage.cost
module: ai-usage-cost
title: LLM 用量成本估算 — estimate_cost 公式 + PRICING 費率鎖定
stability: active
canonical_source: backend/app/services/ai_usage_tracker.py
owns_code:
  - backend/app/services/ai_usage_tracker.py
owns_data: []
spec_tests:
  - backend/specs/test_ai_usage_cost_spec.py
related_issues:
  - 1730
  - 1744
  - 1729
source_meetings: []
last_reviewed: 2026-06-02
owner: young
---

## Intent

`ai_usage_tracker.estimate_cost()` 把 Gemini 回傳的 token 數換算成美金成本，是
平台所有「換 model 比 cost」決策的計價基礎（見 `docs/ai/llm-model-ab-2026-05.md`）。
`PRICING` 字典裡的每一行費率都綁著一個真實的 model 選型決策：

- `gemini-2.5-flash` (0.30 / 2.50) — OMO grader 鎖定 (#1730)
- `gemini-2.5-flash-lite` (0.075 / 0.30) — 非 OMO 預設 (#1744)
- `gemini-flash-lite-latest` (0.25 / 1.50) — identifier (#1729)

如果有人手滑改了費率或公式，成本比較會整個失真、卻不會有任何報錯 — 這正是
需要契約鎖定的地方。本 module 是純函式契約：無 DB、無 AI、無 network，跑在 < 1ms。

## Invariants

1. `estimate_cost` 公式 = `(input_tokens * price_in + output_tokens * price_out) / 1_000_000`，
   單位為美金。
2. 已知 model 的費率必須等於文件值（2.5-flash = 0.30/2.50，2.5-flash-lite =
   0.075/0.30）。改費率 = 改契約，必須是有意識的決策。
3. 未知 model 必須 **fail-soft fallback** 到 `gemini-2.5-flash-lite` 費率 —
   不可 crash、不可回 0、不可回 None。
4. 0 token → 成本 0.0。
5. 成本對 input/output token 數單調遞增（多 token 不會更便宜），且永遠 >= 0。
6. 預設定價 model（2.5-flash-lite）必須是三者中最便宜的（防止「貴 = 預設」回歸，
   呼應 #1744 省 78% 的決策）。

## Out of scope

- `_resolve_context` / DB 維度補值、`capture_usage` 寫入 usage 表、`_extract_usage`
  從 response 物件抽 token（這些是 DB / response-shape 耦合，屬另一測試 tier）。
- 實際 Gemini 計費對帳（以 Google 帳單為準，本 module 只鎖內部估算公式一致性）。
