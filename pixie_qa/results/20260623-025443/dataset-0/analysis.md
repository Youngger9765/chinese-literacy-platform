# Dataset Analysis (Detailed) — spotlight-vision-judge

**Run**: `20260623-025443` | **Dataset**: spotlight-vision-judge | **Entries**: 14

## 1. Overview
Multimodal vision judge (scripts/spotlight_vision_judge.py, Gemini 2.5-flash @ us-central1)
classifying rendered 聚光燈 / 重點表 pages on live staging into
faithful / cross_lesson / skeleton / figure_broken. Each entry = (story_id, step),
ground truth = human-adjudicated verdict in eval_metadata.expected_verdict.

Overall: 14/14 verdict_match (100%), JudgeReasoningQuality mean 0.961.

## 2. Raw aggregation data

### Per-evaluator statistics
| evaluator | n | pass(>=0.85) | mean | min | max |
|---|---|---|---|---|---|
| verdict_match | 14 | 14 | 1.000 | 1.00 | 1.00 |
| JudgeReasoningQuality | 14 | 13 | 0.961 | 0.80 | 1.00 |

### Low-score cells (non-1.0)
| entry | story | verdict_match | JudgeReasoningQuality | note |
|---|---|---|---|---|
| 6 | 1132 國高中數學課 | 1.0 | 0.80 | figure verdict disputed (blurry image borderline) |
| 5 | 1015 友情/愛情 | 1.0 | 0.90 | reasoning slightly less specific on body |
| 7 | 6 第一百碗麵(RS) | 1.0 | 0.85 | reasoning brief |
| 9 | 1143 焚而不毀的倫敦 | 1.0 | 0.90 | recovered from prior false figure_broken |

All other 10 entries: both evaluators 1.0.

### By verdict class (verdict_match recall vs adjudicated truth)
- cross_lesson: 2/2 (1020, 1103)
- figure_broken: 2/2 (1118 real broken box, 1132 adjudicated)
- faithful: 10/10
- skeleton: 0 cases (1024 adjudicated faithful; skeleton is an L1 base-text concern,
  not a render-vision verdict; see Hypothesis 1)

## 3. Hypothesis 1 - Test cases
Hypothesis: The dataset has a blind spot - no live cell whose RENDERED page is a genuine
skeleton, so the skeleton verdict class is unverified by this run.
- Evidence: entry-1 (1024) was the only skeleton candidate; captured reasoning
  (entry-1/eval-output.jsonl) shows a content-rich render (身體覺察選擇題), adjudicated faithful.
  Across the gate full matrix only 1024 had skeleton base text, and its render is not skeleton.
- Validation: confirmed against rendered screenshot + gate L1_BASE_TEXT_QUALITY - skeleton
  lives in the base-text/data layer, masked by the rendered scaffold.
- Conclusion: either drop skeleton from the vision verdict space (let gate L1 own it), or
  source a cell that RENDERS as a bare skeleton before claiming skeleton recall. Until then
  skeleton coverage = 0 and must not be claimed verified.

## 4. Hypothesis 2 - Evaluators
Hypothesis: verdict_match is a meaningful (non-rubber-stamp) scorer, and JudgeReasoningQuality
adds signal beyond it (catches the borderline call verdict_match cannot).
- Evidence: verdict_match is 14/14 here, but the SAME judge scored 11/14 against the ORIGINAL
  pre-adjudication labels in standalone calibration (rounds 2/3) - the evaluator does move with
  label correctness; 100% reflects corrected ground truth, not a rubber stamp.
  JudgeReasoningQuality separated entry-6 (1132, 0.80) from the rest (0.85-1.0), flagging the
  one case whose verdict rests on a disputed/borderline judgment (entry-6/eval-output.jsonl
  reasoning describes a blurry image as load-failure-like).
- Validation: cross-checked each score against captured reasoning; the low score lands on the
  genuinely uncertain case.
- Conclusion: keep both. verdict_match = headline accuracy; JudgeReasoningQuality = per-case
  audit surfacing borderline judgments for human review.

## 5. Hypothesis 3 - Application (the judge)
Hypothesis: The judge correctly detects the defect classes it owns (cross_lesson,
figure_broken) and does not false-positive on legitimate scaffold / loaded-but-generic images.
- Evidence:
  - cross_lesson 2/2 with concrete reasoning quoting the off-topic body (entry-0 天才/費德勒;
    entry-3 雨林/箭毒).
  - figure_broken: entry-11 (1118) cites the exact "圖片載入失敗" placeholder - true broken
    figure caught. entry-6 (1132) fires on a blurry/degraded image (disputed/borderline).
  - No false figure_broken on loaded-but-generic icons: entry-5 (1015) and entry-9 (1143)
    note "圖片是通用圖示但已載入" -> faithful (entry-9 recovered after figure_broken prompt
    tightening).
  - Scaffold carve-out works: entry-4 (1098 背影) distinguishes worked-example name 林玫伶
    from the on-topic body -> faithful.
- Validation: every verdict reasoning cites specific on-screen evidence; no entry has a verdict
  contradicted by its own reasoning.
- Conclusion: judge is reliable on the live, adjudicated set. Residual risk is the borderline
  figure case (1132) where "degraded but loaded" vs "broken" is genuinely fuzzy.

## 6. Open questions
- skeleton verdict has no positive render-level test case (H1) - unresolved until a truly-
  skeleton render is sourced or the class is moved to L1.
- 1132: is a severely degraded/blurry image a content defect (figure_broken) or acceptable
  (faithful)? Needs a human content-quality policy call.
- This run uses live staging render (not pinned screenshots), so it measures judge AND current
  staging content together; a content fix on staging would change scores.
