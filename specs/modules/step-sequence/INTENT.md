---
spec_id: step.sequence.registry
module: step-sequence
title: Step Registry + resolveActiveSteps — STEP_REGISTRY 與學習步驟動態解析
stability: active
canonical_source: frontend/src/config/stepConfig.ts
owns_code:
  - frontend/src/config/stepConfig.ts
owns_data: []  # 一修的 _parsed_2026-05-01/ 已封存（#2683）。二修抽取器補齊對應欄位前，
               # 這個 module 不擁有任何資料檔 —— 跟它的 spec 契約現況一致，
               # 登記在 data/curriculum_qa/content_known_gaps.yaml#locks_removed_with_the_first_edition
spec_tests:
  - backend/specs/test_step_sequence_spec.py
related_issues: [1374]
source_meetings:
  - docs/meetings/2026-05-01-experts-review.md
last_reviewed: 2026-06-02
owner: young
---

# Step Sequence — STEP_REGISTRY + resolveActiveSteps 規格

> 給**人**讀的 spec。機器契約在 `backend/specs/test_step_sequence_spec.py`。
> 改 `stepConfig.ts` 或增刪步驟前先讀這份。

## 1. 這個 module 在管什麼

`frontend/src/config/stepConfig.ts` 定義了所有步驟的 metadata（STEP_REGISTRY）
和預設學習順序（DEFAULT_STEP_SEQUENCE）。`resolveActiveSteps()` 是唯一的「解析函式」：
給定一個課文的 `step_sequence`（YAML 裡選填），回傳該課文實際顯示的步驟列表。

## 2. 關鍵資料結構

| 結構 | 型態 | 語意 |
|------|------|------|
| `STEP_REGISTRY` | `Record<string, StepConfig>` | step id → metadata（無順序語意）|
| `DEFAULT_STEP_SEQUENCE` | `string[]` | 預設 16 步驟順序（含 disabled）|
| `ACTIVE_STEPS` | `StepConfig[]` | = `resolveActiveSteps()` 結果（enabled only）|
| `step_sequence` in YAML | `string[] | null` | 課文自訂序列（選填）|

## 3. resolveActiveSteps() 規則

1. 若課文 YAML 帶 `step_sequence` 且非空 → 使用該序列
2. 否則使用 `DEFAULT_STEP_SEQUENCE`
3. 不認識的 step id 靜默跳過（silently dropped）
4. `enabled: false` 的步驟過濾掉（不出現在 StepperNav）
5. 回傳值 = 過濾後的 `StepConfig[]`

> ⚠️ 步驟 3 是**靜默**行為：YAML 寫錯 id（如 `vocab_definition` 而非
> `vocab-definition`）不會報錯，步驟只是消失。`test_step_sequence_spec.py`
> 的 Contract 3 就是要抓這類 typo。

## 4. 目前 enabled / disabled 狀態（2026-06-02）

| Step ID | enabled | 原因 |
|---------|---------|------|
| `listening` | false | 2026-05-01 expert review，移至 ToolPicker |
| `vocab` | false | 同上 |
| `sentence-practice` | false | 同上，7/1 後評估 |
| `dictation` | false | 2026-03-27 product decision |

其餘 12 個 step 皆為 `enabled: true`。

## 5. dbStepNumber — 請勿隨意改動

每個 step 的 `dbStepNumber` 對應 `LearningSession.current_step` 欄位（PostgreSQL）。
更改這個數字 = 改變 DB 儲存的 step 編號 = 需要 DB migration。

**只有在** `LearningSession.current_step` 欄位也一起 migrate 的情況下，才能改
`dbStepNumber`。

## 6. 與 content-schema spec 的邊界

`content-schema` spec 也在 `step_sequence` 上有一條測試（Contract 3：所有 YAML
的 step_sequence 值必須是有效的 step id）。兩個 spec 的測試邏輯相同但來源不同：

- `content-schema` 的 step id 集合 = `VALID_STEP_IDS` 常數（在 test file 裡 hard-code）
- `step-sequence` 的這份 spec 也在 test 裡同樣 hard-code 同一組值（單一真相：`stepConfig.ts`）

未來若 STEP_REGISTRY 新增步驟，兩個 test file 都需要更新。這是已知的雙重維護點，
暫接受（相對於引入跨語言同步機制的複雜度）。

## 7. Open questions

- 目前 132 個 YAML 有 `step_sequence`，但動態機制的實際使用率約 0.5%（MEMORY.md 記錄）。
  大部分 step_sequence 值和 DEFAULT_STEP_SEQUENCE 幾乎相同。是否考慮移除這些重複宣告？
  （待查 + 與方大哥確認）
- `resolveActiveSteps()` silently drop unknown ids 是設計決策還是遺留行為？
  是否應該改成 warn？（待查）
