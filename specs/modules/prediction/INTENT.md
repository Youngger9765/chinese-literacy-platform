---
spec_id: prediction.difficulty
module: prediction
title: 學習困難預測 — 規則引擎不變量（無 ML）
stability: active
canonical_source: backend/app/services/prediction_service.py
owns_code:
  - backend/app/services/prediction_service.py
spec_tests:
  - backend/specs/test_prediction_spec.py
related_issues: [254]
last_reviewed: 2026-06-02
owner: young
---

# 學習困難預測（Prediction Service）

> 這份是給**人**讀的 spec（方大哥 / 教授 / 實習生）。機器可驗的契約在
> `backend/specs/test_prediction_spec.py`。
> 改動 `prediction_service.py` 前先讀這份。

## 1. 這個 module 在管什麼

`predict_learning_difficulty()` 分析學生的 `LearningSession` 記錄，對其學習困難程度給出預測結果（低/中/高），讓教師在問題惡化前提早介入。

**這是純規則引擎，不含 ML 模型、不含 LLM 呼叫。**

## 2. 五個訊號

| 訊號 | 閾值 | 描述 |
|------|------|------|
| 前期正確率低 | < 60% | 前 3 篇課文平均正確率不足 |
| 生字錯誤率高 | > 30% | 錯誤獨特生字數 / 所有獨特生字數 |
| 正確率持續下滑 | 連續 3 session | 嚴格遞減 |
| 低投入度 | 最長間隔 > 14 天 | session 間空白過長 |
| 多篇卡關 | ≥ 2 篇 | 同課嘗試 ≥ 3 次且進步 < 5% |

## 3. 核心不變量

### 3.1 無 session 記錄時安全回傳 `risk_level: "low"`

`_empty_prediction()` 永遠返回合法結構：
- `risk_level == "low"`（不是 None、不是空字串）
- `confidence_score == 0.0`（明確表達沒有資料支撐）

**禁止**：無資料時返回 `risk_level: "no_data"` 或 `None`，呼叫者不做防禦。

### 3.2 pure helper 函數在相同輸入下確定性輸出

`_check_declining_trend()`、`_check_stuck_count()`、`_compute_risk_level()` 不訪問 DB，
給定相同的 session 串列必然返回相同結果。這使得 UI 呈現、教師報告不會因時間點而變動。

### 3.3 risk_level 只有三個合法值

`_compute_risk_level()` 返回值只能是 `"low"`、`"medium"`、`"high"`，
不能返回其他字串或 None。

### 3.4 confidence_score 在 [0, 1] 範圍內

函數文件標注 `float   # 0-1`；`_compute_risk_level()` 使用 `round(... * data_confidence, 2)`，
`data_confidence` 本身 clamp 在 [0, 1]，所以輸出亦然。

### 3.5 declining trend 邏輯：嚴格遞減（不含平盤）

`_check_declining_trend()` 用 `last_n[i] > last_n[i+1]`（嚴格大於），
連續持平（例如 80, 80, 80）**不**觸發 declining 訊號。

### 3.6 stuck count：< 5% 進步才算卡關

`_check_stuck_count()` 比較「前半最高 vs 後半最高」，差距 < 5 才標 stuck。
若後半明顯改善（≥ 5%），不算卡關。

## 4. 允許 / 禁止的改動

✅ **允許**
- 調整閾值常數（`LOW_ACCURACY_THRESHOLD` / `DECLINING_SESSIONS` 等），
  只要同步更新 spec 的閾值表格和對應測試
- 新增訊號種類

⛔ **禁止（會破壞契約）**
- 讓 `predict_learning_difficulty()` 在無 session 時 raise exception
- 讓 `_compute_risk_level()` 返回 `"low"` 以外的第四個 level 值（前端 UI hard-coded 三色）
- 讓 `confidence_score > 1.0`（前端進度條上限 100%）
- 讓 pure helpers 引入隨機性或時間依賴

## 5. 教學 / 產品脈絡

- 預測結果以 badge 顯示在教師儀表板，顏色：綠（low）/ 黃（medium）/ 紅（high）
- `confidence_score` 低時（< 0.3）教師界面顯示「資料不足，僅供參考」
- `recommended_actions` 對教師以條列呈現，字串由 service 負責，前端只做顯示

## 6. DB 依賴的函數（待查 — 無法在 spec 層直接測試）

`predict_learning_difficulty()` 主入口依賴 `DbSession`，
`_check_character_error_rate()` 依賴 `CharacterError` 查詢。
這些函數的整合行為列為 `待查`，由整合測試覆蓋，不在本 spec 範圍。
