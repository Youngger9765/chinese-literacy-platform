---
spec_id: session.scoring.overall_score
module: session-scoring
title: 學習 session overall_score 加權計算
stability: active
canonical_source: gamification_service.py
owns_code:
  - backend/app/services/gamification_service.py
owns_data: []
spec_tests:
  - backend/specs/test_session_scoring_spec.py
related_issues: [1063]
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-02
owner: young
---

# Session Overall Score — 加權計算規格

> 給**人**讀的 spec（Young / 方大哥 / 實習生）。機器契約在
> `backend/specs/test_session_scoring_spec.py`。改 `gamification_service.py`
> 的 score 計算段之前先讀這份。

## 1. 這個 module 在管什麼

`complete_learning_session()` 在 session 完成時計算並寫入 `LearningSession.overall_score`。
這個欄位是學生最終學習成效的一行數字（0–100），顯示在報告頁和教師 dashboard。

## 2. 加權公式（真相來源：`gamification_service.py` L308–345）

```
overall_score = round(Σ(component_score × weight) / Σ(weight), 1)
```

| Component | DB 欄位 / fallback | Weight |
|-----------|-------------------|--------|
| 朗讀準確率 (reading) | `LearningSession.accuracy * 100` (primary)<br>或 `reading_accuracy` 參數 (fallback) | **40%** |
| 課文理解 (comprehension) | `LearningSession.comprehension_score` (primary)<br>或 `comprehension_passed=True → 80.0` (fallback) | **40%** |
| 生詞練習 (vocab) | `LearningSession.vocab_result["accuracy"]` (× 100 if ≤ 1) | **20%** |

權重是**動態**的：只有實際有數據的 component 才列入分母。
例如：若只有朗讀 + 理解，分母是 0.4+0.4=0.8，結果是這兩個分數的加權均值。

## 3. 不可打破的行為（機器驗的）

1. **純計算正確性**：給定一組 (score, weight) 對，公式結果 `== round(weighted_mean, 1)`。
2. **overall_score 絕不應在完整 session（三個 component 都有數據）後仍為 None**。
   （None 會讓報告頁呈現佔位符，對教授 demo 是 P0 regression。）

## 4. DB 耦合注意事項

完整的 `complete_learning_session()` 需要資料庫連線（SQLAlchemy Session），
無法在 unit test 中直接呼叫。因此：

- **機器契約只測純計算邏輯**（從實際程式碼中把 formula 提取出來驗算）。
- `overall_score is not None` 的整合保證是透過「只有 score > 0 才可寫入」的
  函式流程加以記錄，不做完整 DB mock（避免 test 維護成本過高）。

## 5. 允許 / 禁止的改動

✅ **允許**
- 改個別 component 的 weight（但必須更新本 spec 的表格 + `test_session_scoring_spec.py` 預期值）
- 增加新 component（需同步更新 weight 表格）

⛔ **禁止（會破壞契約）**
- 把 `reading_accuracy` 預設設成非 None 值讓 overall_score 在只有朗讀時看起來達標
  （掩蓋資料缺失）
- 把 `round(..., 1)` 改成整數 round（前端 / 報告頁依賴小數顯示）

## 6. Open questions

- 目前沒有 component 有數據時，`overall_score` 保持 None；報告頁有沒有專門的 fallback UI？
  （待查）
- 未來加入 `story_structure` / `reading_strategy` component 時，weight 如何重分配？
