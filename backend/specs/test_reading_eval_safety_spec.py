"""Executable spec — reading evaluation fallback never-autopass contract.

spec_id: reading.eval.fallback_never_autopass
canonical_source: reading_evaluation_service.py module docstring + _build_fallback_result
owns_code: backend/app/services/reading_evaluation_service.py
related_issues: [2029]
human_spec: specs/modules/reading-eval-safety/INTENT.md

This file is the MACHINE side of the reading-eval-safety spec. The HUMAN side
(rationale, pedagogy, allowed/forbidden changes) lives in INTENT.md above.

Invariant being locked in:
  _build_fallback_result() NEVER returns adjusted_match_rate >= Thresholds.READING_PASS
  when the student's spoken answer is empty or completely unrelated to the target.

This is a GREEN contract (the invariant currently holds). A failing test here means
a code change broke the safety guard — treat as a P0 regression.

Verification run (2026-06-01, before writing these assertions):
  target = "春風吹過田野花兒開了"
  _build_fallback_result("", target)["adjusted_match_rate"]         → 0.0
  _build_fallback_result("天空飛翔白雲朵朵彩虹", target)["adjusted_match_rate"] → 0.0
  _build_fallback_result(target, target)["adjusted_match_rate"]     → 1.0
  Thresholds.READING_PASS                                            → 0.6

Run:  cd backend && python -m pytest specs/ -v
"""
from __future__ import annotations

import pytest

from app.services.persona import Thresholds
from app.services.reading_evaluation_service import _build_fallback_result

# A realistic short Chinese sentence used as the reading target throughout.
_TARGET = "春風吹過田野花兒開了"


def test_empty_spoken_never_passes():
    """A student who said nothing must not pass.

    This is the most catastrophic silent failure: Gemini unavailable →
    fallback runs → fallback inflates score → student auto-passes without
    demonstrating any skill. The guard here ensures that cannot happen.
    """
    result = _build_fallback_result("", _TARGET)
    adjusted = result["adjusted_match_rate"]
    assert adjusted < Thresholds.READING_PASS, (
        f"Empty answer should never pass. "
        f"Got adjusted_match_rate={adjusted}, READING_PASS={Thresholds.READING_PASS}"
    )


def test_totally_wrong_answer_never_passes():
    """A student who reads a completely unrelated sentence must not pass.

    Ensures the fallback does real scoring, not a trivial always-fail stub.
    The spoken text shares no characters with the target.
    """
    spoken = "天空飛翔白雲朵朵彩虹"
    result = _build_fallback_result(spoken, _TARGET)
    adjusted = result["adjusted_match_rate"]
    assert adjusted < Thresholds.READING_PASS, (
        f"Totally wrong answer should never pass. "
        f"Got adjusted_match_rate={adjusted}, READING_PASS={Thresholds.READING_PASS}"
    )


def test_evaluation_method_is_fallback():
    """Fallback results must always be labelled evaluation_method='fallback'.

    This label lets callers (and future audits) distinguish rule-engine scores
    from AI scores. Losing this label would break downstream logging and make
    fallback activations invisible in production.
    """
    r_empty = _build_fallback_result("", _TARGET)
    r_wrong = _build_fallback_result("天空飛翔白雲朵朵彩虹", _TARGET)

    assert r_empty["evaluation_method"] == "fallback", (
        f"Expected 'fallback', got '{r_empty['evaluation_method']}'"
    )
    assert r_wrong["evaluation_method"] == "fallback", (
        f"Expected 'fallback', got '{r_wrong['evaluation_method']}'"
    )


def test_correct_answer_passes_sanity():
    """A student who reads the target verbatim must pass.

    This sanity check ensures the guard is not trivially-always-fail:
    if this test breaks it means the fallback is broken in both directions,
    not just the safety direction. Without this, the safety tests above
    would pass even if the scoring logic returned 0.0 for everything.
    """
    result = _build_fallback_result(_TARGET, _TARGET)
    adjusted = result["adjusted_match_rate"]
    assert adjusted >= Thresholds.READING_PASS, (
        f"Verbatim correct answer should pass. "
        f"Got adjusted_match_rate={adjusted}, READING_PASS={Thresholds.READING_PASS}"
    )
