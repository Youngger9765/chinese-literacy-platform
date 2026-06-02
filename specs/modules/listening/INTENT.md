---
spec_id: listening.eval.guards
module: listening
title: 聽力評估安全門 — 垃圾輸入拒評 + 逐字貼上短路 + 分數 Clamp
stability: active
canonical_source: backend/app/services/listening_service.py
owns_code:
  - backend/app/services/listening_service.py
spec_tests:
  - backend/specs/test_listening_spec.py
related_issues: [1098]
last_reviewed: 2026-06-02
owner: young
---

# 聽力評估安全門（Listening Service）

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生）。機器可驗的契約在
> `backend/specs/test_listening_spec.py`。
> 改動 `listening_service.py` 前先讀這份。

## 1. 這個 module 在管什麼

`evaluate_retelling()` 評估學生在聽完課文後的口頭/打字覆述內容，
使用 Gemini AI 給出分數和教學回饋。

此 module 的 spec 聚焦在**三個安全門**（guards），這些是純函數，
可在不呼叫 AI 的情況下直接測試。

## 2. 三個安全門

### Guard 1：垃圾輸入拒評（`_is_garbage_input()`）

```
觸發條件：
  - 去除頭尾空白後長度 < 5 字元，OR
  - 全部是數字 / 空白 / 標點（無中文 CJK、無英文字母）

返回值：True（拒評）
```

**注意**：「太棒了」（3 字）觸發此 guard（< 5），不會被 LLM 評估。
長度下限是 `_MIN_MEANINGFUL_CHARS = 5`。

### Guard 2：逐字貼上短路（`_is_verbatim_paste()`）

```
觸發條件：
  - 學生輸入與原始課文的 SequenceMatcher 相似度 ≥ 0.70（字元級）
  - 且學生輸入長度 ≤ 原文長度 × 1.2（fast path 排除超長輸入）

返回值：True（逐字貼上）
→ 直接給 score=95.0，不呼叫 LLM
```

### Guard 3：分數 Clamp（`evaluate_retelling()` 後處理）

```
result["score"] = max(0, min(100, float(result.get("score", 0))))
```

LLM 返回的分數無論是 -10 或 150 都會被 clamp 到 [0, 100]。

## 3. 兩個短路返回值（固定常數）

| 情況 | score | 特點 |
|------|-------|------|
| 垃圾輸入 | `0.0` | 不呼叫 LLM，包含溫和提示 |
| 逐字貼上 | `95.0` | 不呼叫 LLM，包含鼓勵並提醒用自己的話說 |

這兩個數字是代碼中的字面值，不由任何常數變數控制。

## 4. Schema 不變量

`RETELLING_EVAL_SCHEMA` 有 6 個必要欄位：
`score`、`key_points_covered`、`key_points_missed`、`feedback`、`encouragement`、`reasoning`

`reasoning` 欄位是必填的（CLAUDE.md 的 LLM output 規則：判斷類 prompt 必帶 reasoning）。

## 5. 允許 / 禁止的改動

✅ **允許**
- 調整 `_MIN_MEANINGFUL_CHARS`（目前 5），只要同步更新 spec 的常數描述
- 調整 `_VERBATIM_SIMILARITY_THRESHOLD`（目前 0.70）

⛔ **禁止（會破壞契約）**
- 讓垃圾輸入 guard 在 score 非 0.0 情況下返回（AI 不應評估無語義輸入）
- 讓 `evaluate_retelling()` 在任何輸入下返回 score > 100 或 score < 0（前端顯示進度條）
- 移除 `reasoning` 欄位（教師稽核需要）
- 讓 `RETELLING_EVAL_SCHEMA["required"]` 不含 `"reasoning"`

## 6. AI 路徑（待查）

`evaluate_retelling()` 的主要路徑（非 guard 短路）呼叫 `generate_structured_response()`，
這需要 Vertex AI 連線，在 spec 層無法測試。列為 `待查`：
- AI 返回 schema 是否符合 `RETELLING_EVAL_SCHEMA`（需 mock）
- `reasoning` 欄位在 AI 回應中的實際填充情況（需整合測試）

## 7. 教學 / 產品脈絡

- 聽力評估在「聽力理解」步驟中觸發，學生聽完課文 TTS 後用自己的話描述
- score 顯示在報告頁，驅動「朗朗上口六環節」的聽力環節指標
- 垃圾輸入保護：避免學生亂打後得到誤導性的 AI 回饋（Issue #1098 修復）
