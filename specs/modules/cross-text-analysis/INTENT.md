---
spec_id: cross.text.analysis.graceful_and_structure
module: cross-text-analysis
title: 跨課文分析 — 低資料優雅降級 + 輸出結構契約
stability: active
canonical_source: backend/app/services/cross_text_analysis_service.py
owns_code:
  - backend/app/services/cross_text_analysis_service.py
spec_tests:
  - backend/specs/test_cross_text_analysis_spec.py
related_issues: [253]
last_reviewed: 2026-06-02
owner: young
---

# 跨課文分析：低資料優雅降級 + 輸出結構契約

> 這份是給**人**讀的 spec。機器可驗的契約在 `backend/specs/test_cross_text_analysis_spec.py`。

## 1. 這個 module 在管什麼

`cross_text_analysis_service.py` 分析一個學生橫跨**所有**完成課文的學習模式，輸出：
- `text_type_performance`：依文體/類別/年級聚合分數
- `vocabulary_growth`：詞彙累積時間線
- `difficulty_progression`：分數 vs 課文難度的時間線
- `common_error_patterns`：跨多篇課文重複出現的錯誤字

本 service **唯讀** — 不寫 DB，只讀 `LearningSession` + `Text` + `CharacterError`。

## 2. 低資料優雅降級（核心設計）

`MIN_SESSIONS_FOR_ANALYSIS = 2`：完成課文數 < 2 時，`analyze_cross_text_patterns`
回傳一個結構完整但**空值**的 dict（`has_enough_data: False`），不呼叫四個分析函式。

**此行為是契約**：呼叫端（teacher dashboard）必須能接受 `has_enough_data: False`
不需要 try/except，不會拿到 KeyError 或 IndexError。

## 3. 輸出結構（analyze_cross_text_patterns）

```python
{
    "student_id": int,
    "total_completed_texts": int,      # 0 ≤ N
    "has_enough_data": bool,           # False when N < MIN_SESSIONS_FOR_ANALYSIS
    "text_type_performance": {
        "by_genre": list[dict],        # [{"label": str, "avg_score": float, "attempts": int}]
        "by_category": list[dict],
        "by_grade": list[dict],        # [{"grade": int, "avg_score": float, "attempts": int}]
    },
    "vocabulary_growth": list[dict],   # chronological, cumulative_words monotone non-decreasing
    "difficulty_progression": list[dict],
    "common_error_patterns": list[dict],  # at most 10 items
    "summary": {
        "strongest_genre": str | None,
        "weakest_genre": str | None,
        "total_vocabulary_words": int,
        "recurring_error_chars": int,
    },
}
```

## 4. 純函式不變量（_build_* helpers）

這些函式接受 Python 資料結構，不依賴 DB，可以在單元測試中直接呼叫：

| 函式 | 不變量 |
|------|--------|
| `_build_text_type_performance` | avg_score = round(sum/len, 1)；空輸入 → 三個空 list |
| `_build_vocabulary_growth` | cumulative_words 單調遞增（非遞減）；new_words ≥ 0 |
| `_build_difficulty_progression` | 輸出長度 ≤ 輸入 pairs 長度（None completed_at 被跳過）|
| `_build_common_error_patterns` | 回傳最多 10 項；只含跨 ≥ 2 篇課文的字 |

## 5. 班級分析（analyze_class_cross_text_patterns）

- `student_ids = []` → 回傳全空 dict，`total_students: 0`（不 crash）
- `class_avg_score = round(sum/len, 1)` — 與個人分析一致
- 至多 10 個班級常見錯誤字

## 6. 待查（需 DB / mock）

- `_completed_sessions_with_text` 的 joinedload 是否避免 N+1 — 待查（需 real DB trace）
- `analyze_class_cross_text_patterns` 對大班級（50+ 學生）的性能 — 待查
- `completed_at is None` 的 session 被正確跳過 — 待查（需 mock DB）

## 7. 允許 / 禁止的改動

✅ **允許**
- 調整 `MIN_SESSIONS_FOR_ANALYSIS`（需同步更新 spec 和 INTENT.md）
- 增加新的聚合維度（需在 `text_type_performance` 結構加欄）

⛔ **禁止（會破壞契約）**
- 在 `total_completed_texts < MIN_SESSIONS_FOR_ANALYSIS` 時仍呼叫分析函式（會 IndexError）
- 讓 `vocabulary_growth` 的 `cumulative_words` 遞減
- 讓 `common_error_patterns` 超過 10 項
