# Action Plan (Detailed) — spotlight-vision-judge run 20260623-025443

## Summary
- 1 dataset, 14 entries, 100% verdict_match (vs human-adjudicated truth), JudgeReasoningQuality
  mean 0.961.
- The judge is accurate and well-reasoned on the live, adjudicated set. The remaining work is
  about eval-set coverage and one content/policy decision - not judge logic.

## Priority 1: Resolve the skeleton verdict gap
- What: Decide whether `skeleton` is a vision-judge verdict at all. Either (a) remove it from
  the judge's verdict enum + the gate's critical-defect set and let gate L1
  (BASE_TEXT_QUALITY) own skeleton, or (b) add a dataset entry whose RENDERED page is a genuine
  bare skeleton.
- Why: Hypothesis 1 (dataset-0/analysis.md). The only skeleton candidate (1024) renders as
  real content, so skeleton recall is structurally 0/1 and the verdict class is unverified.
- Evidence: entry-1/eval-output.jsonl (1024 reasoning shows 身體覺察選擇題, content-rich);
  gate full matrix has only 1024 with skeleton base text; its render is not skeleton.
- Expected impact: removes a permanent FALSE gate-fail (skeleton recall 0/1) that is a
  measurement artifact, not a judge defect. Restores a clean pass/fail signal.
- How: in scripts/spotlight_vision_judge.py drop "skeleton" from VERDICTS +
  CRITICAL_DEFECT_VERDICTS (option a); update eval yaml + dataset accordingly; OR source a
  truly-skeleton render and add it (option b). Decision needs Young/coordinator.
- Verification: re-run `pixie test`; verdict_match stays 14/14 and the gate no longer fails on
  skeleton recall.

## Priority 2: Set a policy for severely degraded images (1132)
- What: Define whether a successfully-loaded but heavily blurry/pixelated image counts as
  figure_broken (a content-quality defect) or faithful.
- Why: Hypothesis 3 + the single low JudgeReasoningQuality score (entry-6, 0.80). This is the
  only borderline verdict; its correctness depends on a policy that does not yet exist.
- Evidence: entry-6/eval-output.jsonl - reasoning describes a "模糊、像素化" image as
  load-failure-like; the image is loaded, just degraded.
- Expected impact: removes ambiguity on ~the one class of case the judge is genuinely unsure
  about; lets the figure_broken rule be tightened or loosened with intent.
- How: human content-quality call. If "degraded = defect", keep 1132 as figure_broken and
  optionally add a "low-quality image" sub-signal; if "loaded = ok", relabel 1132 faithful and
  add a prompt clause that blur alone is not broken.
- Verification: 1132's verdict_match + JudgeReasoningQuality both reach 1.0 under the chosen
  policy on re-run.

## Priority 3: Re-baseline the disputed eval labels in the source set
- What: Fold the coordinator-adjudicated truths (1024 faithful, 1103 cross_lesson, 1132
  figure_broken) back into backend/data/curriculum_qa/eval/spotlight_keypoints_eval.yaml as the
  authoritative labels (currently they carry the original label + a `disputed:` note; the pixie
  dataset already uses the adjudicated truth).
- Why: Hypothesis 2 - the standalone calibration still reports 11/14 because it reads the
  original labels; the pixie run reports 14/14 because it reads the adjudicated truth. The two
  pipelines should agree once labels are re-baselined.
- Evidence: dataset eval_metadata.original_label vs expected_verdict for entries 1, 3, 6.
- Expected impact: standalone calibration and pixie both report the same accuracy; removes the
  confusing 11/14-vs-14/14 split.
- How: after Priorities 1-2 are decided, update the yaml labels (with the render/API evidence
  already recorded) and re-run both the standalone calibration and `pixie test`.
- Verification: both pipelines report identical per-case verdicts and the same headline number.
