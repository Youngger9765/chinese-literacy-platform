# 02 — Eval criteria

## Use cases(derived from capability inventory)
- UC1 偵測張冠李戴(cross_lesson):整段內容是別課 → judge 必須判 cross_lesson
- UC2 偵測純骨架(skeleton):render 無實質內文 → judge 判 skeleton
- UC3 偵測破圖(figure_broken):頁面有「圖片載入失敗」框 → judge 判 figure_broken
- UC4 確認忠實(faithful):本課內容/合法鷹架/已載入圖(即使通用)→ judge 判 faithful
- UC5 不誤判(specificity):合法鷹架語、scaffold 夾帶他課人名、通用但已載入的圖 → 不可誤判成缺陷

## Eval criteria(derived from hard problems / failure modes)
| criterion | 對應 failure mode | evaluator |
|---|---|---|
| **verdict 正確性** — judge verdict == 人工 ground-truth verdict | 全部 UC 的核心 | `verdict_match`(deterministic custom,主指標) |
| **缺陷類 recall** — cross/skeleton/figure_broken 不能漏判 | 漏判缺陷 = QA 失效 | 由 verdict_match 分類別統計(Step 6 分析) |
| **reasoning 可稽核性** — reasoning 具體引用畫面元素、邏輯站得住 | LLM judge 可能對答案但理由瞎掰 | `JudgeReasoningQuality`(agent evaluator,Step 6 完成) |

## Applicability scope
- `verdict_match`:**All** entries(dataset-level default)
- `JudgeReasoningQuality`(agent evaluator):**All** entries(每筆都要稽核 reasoning)

## Pass criteria(對齊已建的硬門檻)
- 整體 verdict_match accuracy ≥ 0.85
- 三個關鍵缺陷類(cross_lesson/skeleton/figure_broken)各 recall = 1.0
- 注:這正是 spotlight_vision_judge.py `evaluate_gate()` 的門檻,pixie 把它逐 case 展開出分數
