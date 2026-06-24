# Dataset Analysis - Summary

**Dataset**: spotlight-vision-judge | **Entries**: 14 | **Pass rate**: 14/14 verdict_match (100%)

## Results at a glance
| Evaluator | Pass rate | Avg score | Notes |
|---|---|---|---|
| verdict_match | 14/14 | 1.00 | judge verdict == adjudicated ground truth, every case |
| JudgeReasoningQuality | 13/14 (>=0.85) | 0.96 | only 1132 low (0.80), the borderline blurry-image call |

## Key findings
1. The judge matches human-adjudicated truth on all 14 cases. The earlier "11/14 FAIL" in
   standalone calibration was driven by 2-3 wrong/stale eval labels, not judge errors - this
   run confirms it once those labels are corrected.
2. The judge reliably catches the defect classes it owns: cross_lesson 2/2 (quotes the
   off-topic body), real broken figure 1/1 (cites "圖片載入失敗"), and does NOT false-positive
   on loaded-but-generic icons (1015, 1143 faithful).
3. skeleton has zero render-level coverage: the only candidate (1024) renders as real content.
   skeleton is a base-text/data-layer defect (gate L1 already catches it), not a vision verdict.

## Recommended actions (priority order)
1. Decide skeleton ownership: drop it from the vision verdict space (let gate L1 own it) OR add
   a cell that truly renders as a skeleton. Until then do not claim skeleton recall.
2. Set a content-quality policy for severely degraded/blurry images (1132): faithful or
   figure_broken? This is the only borderline verdict.
3. For the headline gate, treat verdict_match (deterministic) as the accuracy metric and keep
   JudgeReasoningQuality as the per-case reasoning audit.
