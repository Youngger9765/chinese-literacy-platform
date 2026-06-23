"""Evaluators for the spotlight/keypoints vision judge eval.

- verdict_match: deterministic — does the judge's verdict equal the human
  ground-truth verdict for this case? This is the calibration accuracy,
  expressed per-case as a 0/1 score.
- JudgeReasoningQuality: agent evaluator — holistic audit of whether the
  judge's reasoning concretely justifies its verdict (cites on-screen
  elements, logic holds). Completed by the coding agent in Step 6.
"""

from typing import Any

from pixie import Evaluation, Evaluable, create_agent_evaluator


def _get_output(evaluable: Evaluable, name: str) -> Any:
    for item in evaluable.eval_output:
        if item.name == name:
            return item.value
    return None


def verdict_match(evaluable: Evaluable, *, trace=None) -> Evaluation:
    """Score 1.0 iff judge verdict == expected_verdict (from eval_metadata)."""
    meta = evaluable.eval_metadata or {}
    expected = meta.get("expected_verdict")
    got = _get_output(evaluable, "vision_verdict")
    detail = _get_output(evaluable, "judge_detail") or {}
    conf = detail.get("confidence")
    if expected is None:
        return Evaluation(
            score=0.0,
            reasoning="no expected_verdict in eval_metadata — cannot score",
        )
    match = str(got) == str(expected)
    disputed = meta.get("disputed")
    note = f" [disputed: {disputed}]" if disputed else ""
    return Evaluation(
        score=1.0 if match else 0.0,
        reasoning=(
            f"expected={expected} got={got} "
            f"-> {'HIT' if match else 'MISS'} (judge confidence={conf}){note}"
        ),
        details={"expected": expected, "got": got, "confidence": conf,
                 "disputed": disputed},
    )


JudgeReasoningQuality = create_agent_evaluator(
    name="JudgeReasoningQuality",
    criteria=(
        "Review the judge's reasoning (in eval_output 'judge_detail'.reasoning) "
        "against the screenshot it judged and the lesson title/paragraphs. "
        "Score 1.0 if the reasoning concretely justifies the chosen verdict — "
        "it cites specific on-screen text or visual elements (not vague), and "
        "the logic for faithful/cross_lesson/skeleton/figure_broken holds given "
        "what the page actually shows. Score 0.0 if the reasoning is generic, "
        "contradicts the screenshot, or asserts a defect/faithfulness it cannot "
        "support from the page. Note: a correct verdict with hand-wavy reasoning "
        "should still score low; an incorrect verdict whose reasoning honestly "
        "reflects an ambiguous/mislabeled page may still score high on reasoning."
    ),
)
