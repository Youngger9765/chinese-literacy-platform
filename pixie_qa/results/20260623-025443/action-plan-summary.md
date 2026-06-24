# Action Plan - Summary

**Overall**: 14 entries, 100% verdict_match vs human-adjudicated truth, reasoning quality 0.96.
The judge is accurate and well-reasoned; remaining work is eval coverage + one policy call.

## Actions (priority order)
1. **Resolve the skeleton gap**: skeleton has no render-level test case (its only candidate,
   1024, renders as real content). Decide: drop skeleton from the vision verdict space and let
   gate L1 own it, OR source a truly-skeleton render. This removes a measurement-artifact gate
   fail (skeleton recall 0/1).
2. **Policy for degraded images (1132)**: define whether a loaded-but-very-blurry image is
   figure_broken or faithful. It is the only borderline verdict (JudgeReasoningQuality 0.80);
   the right answer depends on a content-quality policy that does not yet exist.
3. **Re-baseline disputed labels**: fold the adjudicated truths (1024 faithful, 1103
   cross_lesson, 1132 figure_broken) back into the source eval yaml so the standalone
   calibration (still 11/14 on old labels) and pixie (14/14) agree.
