---
spec_id: reading.eval.fallback_never_autopass
module: reading-eval-safety
title: 朗讀評估 — AI 失敗時 fallback 絕不自動通過學生
stability: active
canonical_source: backend/app/services/reading_evaluation_service.py (module docstring lines 14-15)
owns_code:
  - backend/app/services/reading_evaluation_service.py
spec_tests:
  - backend/specs/test_reading_eval_safety_spec.py
related_issues: [2029]
last_reviewed: 2026-06-01
owner: young
---

# 朗讀評估：AI 失敗時 fallback 絕不自動通過學生

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生）。機器可驗的契約在
> `backend/specs/test_reading_eval_safety_spec.py`。任何人改 `reading_evaluation_service.py`
> 或 `_build_fallback_result()` 前先讀這份。

## 1. 這個 module 在管什麼

LingoLeap 的朗讀評估功能（Issue #454）使用 Gemini 2.5 Flash 做語意評分。當 Gemini
不可用（網路錯誤、quota 滿、timeout、任何 Exception）時，系統會切換到 rule-engine
fallback：`_build_fallback_result(spoken_text, target_text)`。

這個 module 鎖定的核心不變量是：

> **fallback 永遠不會給出 `adjusted_match_rate >= Thresholds.READING_PASS` 的結果，
> 除非學生真的讀對了足夠多的字。**

這個不變量來自 service 的 module docstring（lines 14–15）：

```
6. On any AI failure → fallback to rule-engine (stt_service.py).
   Fallback NEVER auto-passes students (mirrors understood=False principle).
```

## 2. 為什麼這個不變量是最高優先級

**最災難性的沉默失敗** = AI 錯誤時，學生什麼都沒讀（或讀了完全不相關的句子），
系統卻讓他通過評估，進入下一段。

影響：
- 學生跳過了需要練習的段落，積累學習缺口
- 教師報告顯示「通過」，但學生實際上沒有展示任何能力
- 因為是 AI 失敗時才觸發，這個錯誤在正常測試中幾乎不可見

與 `understood=False` 原則一致（見 `persona.py` 和 `MEMORY.md`）：當系統不確定時，
要往保守方向走（fail safe），**不往樂觀方向走**。

## 3. 守護的代碼路徑

```
evaluate_reading_with_ai()
    ↓  (Gemini 正常)
    → AI scoring path  (evaluation_method = "ai")
    
    ↓  (任何 Exception)
    → _build_fallback_result(spoken_text, target_text)
          ↓
          _normalize_text() + correct_homophones() + compute_match_rate()
          + Levenshtein alignment for diff_tokens
          → adjusted_match_rate = (correct + forgiven) / target_length
          → evaluation_method = "fallback"
```

`_build_fallback_result` 是一個**純函數**（pure function）：
- 無 I/O、無 DB、無 AI 呼叫
- 只依賴 `_normalize_text`、`correct_homophones`、`compute_match_rate`、Levenshtein
- 可在 pytest 中直接同步呼叫，無需任何 mock

## 4. 驗證量測（2026-06-01 實際執行結果）

```
target = "春風吹過田野花兒開了"
Thresholds.READING_PASS = 0.6

_build_fallback_result("", target)["adjusted_match_rate"]         → 0.0  (< 0.6 ✅)
_build_fallback_result("天空飛翔白雲朵朵彩虹", target)["adjusted_match_rate"] → 0.0  (< 0.6 ✅)
_build_fallback_result(target, target)["adjusted_match_rate"]     → 1.0  (>= 0.6 ✅)
```

四個 contract tests 對應上面三個量測：

| Test | 驗證 | 結果 |
|------|------|------|
| `test_empty_spoken_never_passes` | `""` → `adjusted < READING_PASS` | PASS |
| `test_totally_wrong_answer_never_passes` | 完全不同的句子 → `adjusted < READING_PASS` | PASS |
| `test_evaluation_method_is_fallback` | 兩種錯誤輸入都標 `"fallback"` | PASS |
| `test_correct_answer_passes_sanity` | 完整唸對 → `adjusted >= READING_PASS` | PASS |

最後一個 sanity test（正確答案要通過）是關鍵：它防止 contract 退化成一個永遠 return 0
的假函數卻讓前三個測試都通過。

## 5. 這是 GREEN 鎖定，不是 xfail

**目前不變量成立**。這些測試是「安全網」，防止未來的修改打破已有的保護。

對比 `test_omo_assessment_spec.py` 中的 `xfail` 測試（記錄已知 drift），這裡的測試
是硬性斷言：如果 fallback 邏輯被改壞，CI 必須立刻失敗，不能悄悄通過。

## 6. 允許 / 禁止的改動

✅ **允許**
- 改進 fallback 的 feedback 文字
- 調整 `_NEAR_SOUND_PAIRS` 或 `_FILLER_WORDS`
- 提高 `Thresholds.READING_PASS`（更嚴格的標準）
- 改進 Levenshtein 對齊算法（只要仍然區分對錯）

⛔ **禁止（會破壞契約）**
- 讓 fallback 在任何情況下 return `adjusted_match_rate >= READING_PASS`
  而學生實際上沒有充分展示能力
- 移除或弱化 Levenshtein scoring（讓 fallback 變成 always-pass）
- 改變 `evaluation_method` 的值，使 fallback 結果看起來像 AI 結果
- 降低 `Thresholds.READING_PASS` 而不同步更新 spec 和 tests
- 把 `except Exception` block 改成 return 一個預設通過的結果

## 7. 教學 / 產品脈絡（pytest 寫不進去、但 AI 要知道）

- 朗讀評估是 LingoLeap 學習流程的核心環節，位於 StepperNav 的第 2 步（逐段朗讀）
  和第 6 步（全文朗讀）。
- Gemini fallback 被觸發時，通常是在尖峰時間或 Vertex AI 配額不足。這正是
  學生使用量最大的時段，fallback 失誤的影響範圍最廣。
- `evaluation_method = "fallback"` 標籤讓 Young 和方大哥可以在 logs 中過濾出
  fallback 事件，監控 Gemini 可用性，決定是否需要調整 quota 或換 region。
- 「understood=False 原則」貫穿整個 AI 判斷層（socratic agent、OMO grader 等），
  是 LingoLeap AI safety 設計的基礎：**不確定時，選保守，不選樂觀。**
