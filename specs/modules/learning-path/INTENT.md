---
spec_id: learning.path.recommendation
module: learning-path
title: 個別化學習路徑推薦 — 推薦課文必須在課程目錄中存在
stability: active
canonical_source: backend/app/services/learning_path_service.py
owns_code:
  - backend/app/services/learning_path_service.py
spec_tests:
  - backend/specs/test_learning_path_spec.py
related_issues: [252]
last_reviewed: 2026-06-02
owner: young
---

# 個別化學習路徑推薦（Learning Path Service）

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生）。機器可驗的契約在
> `backend/specs/test_learning_path_spec.py`。
> 改動 `learning_path_service.py` 前先讀這份。

## 1. 這個 module 在管什麼

`recommend_next_stories()` 以純演算法（無 LLM 呼叫）分析學生學習歷程，
從課程目錄中選出最適合的下一篇課文（預設推薦 5 篇）。

**演算法不隨機，不呼叫外部服務；相同輸入在測試環境下產生相同輸出。**

## 2. 推薦來源

推薦清單的課文**全部來自 `get_all_lessons()` 返回的課程目錄**（`backend/data/lessons/`）。
函數不自行捏造 `story_slug` — 所有推薦的 `story_slug` 必定是 `str(lesson["lesson_number"])`
對某個真實 lesson 的計算結果。

**這是最重要的不變量**：推薦不存在的課文 = 前端 API 返回 404 = 學生頁面空白。

## 3. 核心不變量

### 3.1 推薦課文的 story_slug 必須在課程目錄中存在

```
returned story_slug ∈ {str(l["lesson_number"]) for l in get_all_lessons()}
```

### 3.2 返回 list 長度 ≤ limit 參數

`recommend_next_stories(student_id, db, limit=N)` 返回的 list 長度 ≤ N。
（候選課文少於 limit 時，返回所有候選而不是 pad None）

### 3.3 每筆推薦結果包含必要欄位

```python
{
    "story_slug":             str,
    "title":                  str,
    "grade":                  int,
    "genre":                  str,
    "difficulty_match_score": int,
    "reason":                 str,  # 非空
}
```

### 3.4 grade 在合法範圍 [4, 9]

目前課程目錄只有 4–9 年級。推薦結果的 `grade` 欄位必定在此範圍。

### 3.5 課程目錄本身（`get_all_lessons()` 返回值）的結構守恆

這是推薦演算法的「輸入合法性」前提：
- 返回 list 非空（有課文才能推薦）
- 每個 lesson 有 `lesson_number`（numeric）、`grade`（int）、`title`（str）
- `grade` 在 [4, 9]

## 4. 演算法評分摘要（給讀 code 的人）

| 因子 | 分數 |
|------|------|
| 難度完全符合（同年級）| +30 |
| 難度接近（±1 年級）| +20 |
| 難度稍遠（±2 年級）| +10 |
| 每個卡關生字在課文中出現 | +5（最多 +25）|
| 最近嘗試過（7 天內）| -15 |
| 上一篇課文同類型重複 | -10 |
| 已精熟（正確率 ≥ 80%）| 排除不推薦 |

## 5. 待查（DB 依賴路徑，spec 層無法測試）

- `recommend_next_stories()` 主入口依賴 `DbSession`（`LearningSession` + `CharacterError` 查詢）
- 學生有歷史資料時的個人化推薦正確性屬整合測試範疇
- `well_done_slugs` 排除邏輯（accuracy ≥ 80%）和 `recently_attempted_slugs` 的 timezone 處理
  均需 DB mock 才能驗證，列為 `待查`

## 6. 允許 / 禁止的改動

✅ **允許**
- 調整評分常數（`DIFFICULTY_EXACT`、`CHAR_BONUS_PER_CHAR` 等）
- 新增評分因子

⛔ **禁止（會破壞契約）**
- 讓推薦結果包含不在課程目錄中的 `story_slug`（前端直接用 slug 發 API 請求）
- 讓返回 list 包含 `None` 元素
- 讓 `reason` 欄位為空字串（前端直接顯示給學生）
