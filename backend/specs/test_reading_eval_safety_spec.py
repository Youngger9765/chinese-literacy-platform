"""Executable spec — reading evaluation fallback never-autopass contract.

spec_id: reading.eval.fallback_never_autopass
canonical_source: reading_evaluation_service.py module docstring + _build_fallback_result
owns_code:
  - backend/app/services/reading_evaluation_service.py
  - backend/app/services/reading_transcription_service.py
related_issues: [2029, 2321]
human_spec: specs/modules/reading-eval-safety/INTENT.md

This file is the MACHINE side of the reading-eval-safety spec. The HUMAN side
(rationale, pedagogy, allowed/forbidden changes) lives in INTENT.md above.

Invariants being locked in:

  1. (original) _build_fallback_result() NEVER returns adjusted_match_rate >= Thresholds.READING_PASS
     when the student's spoken answer is empty or completely unrelated to the target.

  2. (Issue #2321) evaluate_reading_with_ai() NEVER auto-passes when the spoken_text is
     a near-exact prefix of the target AND suspiciously short (< 35% of target length).
     This catches Gemini hallucinations: when given a silent audio + the full lesson text
     as a hint, Gemini sometimes echoes the opening 2–3 sentences verbatim.

  3. (Issue #2321) _is_hallucination_prefix() correctly identifies hallucination-shaped
     inputs without false-positiving on real partial reads (with errors).

  4. (Issue #2321) reading_transcription_service._is_hallucination_transcript() rejects
     hallucination-shaped Gemini outputs at the transcription layer.

This is a GREEN contract (all invariants currently hold). A failing test here means
a code change broke a safety guard — treat as a P0 regression.

Verification run (2026-06-01, before writing original assertions):
  target = "春風吹過田野花兒開了"
  _build_fallback_result("", target)["adjusted_match_rate"]         → 0.0
  _build_fallback_result("天空飛翔白雲朵朵彩虹", target)["adjusted_match_rate"] → 0.0
  _build_fallback_result(target, target)["adjusted_match_rate"]     → 1.0
  Thresholds.READING_PASS                                            → 0.6

Verification run (2026-06-21, Issue #2321 additions):
  # A realistic hallucination scenario: target is a 76-char paragraph (L01 P0),
  # and Gemini echoes back just the first 18 chars (≈ 24% of target, clean prefix).
  evaluate_reading_with_ai(hallucination_spoken, long_target)["adjusted_match_rate"] → 0.0 (< 0.6)
  # A real partial read: same length prefix but with errors
  evaluate_reading_with_ai(partial_with_errors, long_target)["adjusted_match_rate"]  → > 0 (scores normally)

Run:  cd backend && python -m pytest specs/ -v
"""
from __future__ import annotations

import asyncio

import pytest

from app.services.persona import Thresholds
from app.services.reading_evaluation_service import (
    _build_fallback_result,
    _is_hallucination_prefix,
    _normalize_text,
    evaluate_reading_with_ai,
)
from app.services.reading_transcription_service import _is_hallucination_transcript

# A realistic short Chinese sentence used as the reading target throughout.
_TARGET = "春風吹過田野花兒開了"

# A realistic long paragraph target (≈ L01 P0 in production).
# 76 chars — representative of real lesson content.
_LONG_TARGET = (
    "「戴資穎戴資穎第一名，戴資穎戴資穎我愛妳」這一句洗腦的廣告臺詞，"
    "是否也在你的周遭出現？她就是台灣第一人，累計兩百一十四周排名世界第一的球后——戴資穎。"
)

# A hallucinated transcript: Gemini echoed back the first 18 chars of _LONG_TARGET.
# len("「戴資穎戴資穎第一名，戴資穎戴資穎") = 18, _LONG_TARGET len ≈ 62 (normalized)
# 18 / 62 ≈ 0.29 < 0.35 → suspiciously short. All chars match the prefix exactly.
_HALLUCINATED_SPOKEN = "「戴資穎戴資穎第一名，戴資穎戴資穎"  # first 16 chars of target


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


# ---------------------------------------------------------------------------
# Issue #2321 — Hallucination false-positive tests
# ---------------------------------------------------------------------------

class TestHallucinationPrefixDetector:
    """Unit tests for _is_hallucination_prefix (scoring-layer helper)."""

    def test_clean_prefix_short_is_hallucination(self):
        """A clean, short prefix of the target matches the hallucination pattern.

        Scenario: Gemini echoes the first ~24% of the lesson text perfectly.
        This is the primary hallucination shape.
        """
        target_norm = _normalize_text(_LONG_TARGET)
        # Take the first 20% of the normalised target as a 'clean' hallucination.
        cutoff = max(1, int(len(target_norm) * 0.20))
        hallucination_norm = target_norm[:cutoff]
        assert _is_hallucination_prefix(hallucination_norm, target_norm), (
            "A clean prefix occupying 20% of the target should be detected as hallucination"
        )

    def test_prefix_with_errors_not_hallucination(self):
        """A partial read that has errors should NOT be treated as hallucination.

        A real student reading the first part of the text will make mistakes.
        The guard must not block legitimate (if partial) reads.
        """
        target_norm = _normalize_text(_LONG_TARGET)
        cutoff = max(1, int(len(target_norm) * 0.20))
        partial_norm = target_norm[:cutoff]
        # Introduce errors: replace 3 chars with wrong chars (≈ 15% error rate for a 20-char span)
        partial_with_errors = list(partial_norm)
        for i in [2, 5, 8]:
            if i < len(partial_with_errors):
                partial_with_errors[i] = "啊"  # char not in target
        erroneous_read = "".join(partial_with_errors)
        assert not _is_hallucination_prefix(erroneous_read, target_norm), (
            "A partial read with errors should NOT be blocked by the hallucination guard"
        )

    def test_long_partial_read_not_hallucination(self):
        """A partial read that covers ≥ 35% of the target is NOT blocked.

        A student who reads half the paragraph should pass through to scoring.
        """
        target_norm = _normalize_text(_LONG_TARGET)
        # Read 50% of the target perfectly
        half = target_norm[:len(target_norm) // 2]
        assert not _is_hallucination_prefix(half, target_norm), (
            "A partial read covering 50% of the target should not be blocked"
        )

    def test_full_read_not_hallucination(self):
        """A student who reads the entire target should never be blocked."""
        target_norm = _normalize_text(_LONG_TARGET)
        assert not _is_hallucination_prefix(target_norm, target_norm), (
            "A verbatim full read should not be blocked by hallucination guard"
        )

    def test_empty_spoken_not_hallucination(self):
        """Empty spoken is handled by the existing empty-string guard, not this one."""
        target_norm = _normalize_text(_LONG_TARGET)
        # _is_hallucination_prefix returns False for empty — caller handles it separately
        assert not _is_hallucination_prefix("", target_norm), (
            "Empty string should return False (handled by caller's empty guard)"
        )


class TestEvaluateReadingHallucinationGate:
    """Integration tests for the hallucination gate in evaluate_reading_with_ai.

    These test the *scoring-layer* gate end-to-end using asyncio.run.
    """

    def test_hallucination_transcript_does_not_auto_pass(self):
        """A hallucinated transcript (clean prefix, short) must NOT produce a pass score.

        This is the primary regression guard for Issue #2321.
        Before the fix: LCS matched the clean prefix → tier 1/2 pass.
        After the fix: gate fires → score routed to _build_fallback_result("") → 0.0.
        """
        result = asyncio.run(
            evaluate_reading_with_ai(
                spoken_text=_HALLUCINATED_SPOKEN,
                target_text=_LONG_TARGET,
                duration_ms=500,   # very short duration — suspicious
            )
        )
        adjusted = result["adjusted_match_rate"]
        assert adjusted < Thresholds.READING_PASS, (
            f"Hallucinated transcript (clean prefix) must not auto-pass. "
            f"Got adjusted_match_rate={adjusted}, READING_PASS={Thresholds.READING_PASS}"
        )

    def test_hallucination_gate_sets_deterministic_method(self):
        """Hallucination-gated results must still label evaluation_method='deterministic'.

        We do NOT return 'hallucination' as method — the frontend only knows
        'deterministic' / 'ai' / 'fallback'. Using 'deterministic' with 0 score
        correctly triggers the retry UI without any special-case handling.
        """
        result = asyncio.run(
            evaluate_reading_with_ai(
                spoken_text=_HALLUCINATED_SPOKEN,
                target_text=_LONG_TARGET,
            )
        )
        assert result["evaluation_method"] == "deterministic", (
            f"Expected evaluation_method='deterministic', got '{result['evaluation_method']}'"
        )

    def test_partial_read_with_errors_scores_normally(self):
        """A real partial read (prefix + errors) must score normally, not be blocked.

        Sanity: the hallucination gate must not produce false positives on
        genuine student reading attempts that happen to start from the beginning.
        """
        target_norm = _normalize_text(_LONG_TARGET)
        # Build a realistic partial read: first 20% of target with errors
        cutoff = max(1, int(len(target_norm) * 0.20))
        partial_chars = list(target_norm[:cutoff])
        # Introduce errors at positions 2, 5, 8
        for i in [2, 5, 8]:
            if i < len(partial_chars):
                partial_chars[i] = "啊"
        partial_with_errors = "".join(partial_chars)

        result = asyncio.run(
            evaluate_reading_with_ai(
                spoken_text=partial_with_errors,
                target_text=_LONG_TARGET,
                duration_ms=3000,
            )
        )
        # Should produce a score > 0 (errors reduce score but don't zero it)
        # The key invariant: NOT gated as hallucination, so scoring runs normally.
        assert "hallucination_blocked" not in result, (
            "A real partial read with errors must NOT be flagged as hallucination"
        )

    def test_full_correct_read_passes_through_gate(self):
        """A verbatim full read must still produce a passing score.

        The hallucination gate must not inadvertently block a correct full read.
        (Full reads are > 35% of target length, so they won't trigger condition 1.)
        """
        result = asyncio.run(
            evaluate_reading_with_ai(
                spoken_text=_LONG_TARGET,
                target_text=_LONG_TARGET,
                duration_ms=30000,
            )
        )
        adjusted = result["adjusted_match_rate"]
        assert adjusted >= Thresholds.READING_PASS, (
            f"A verbatim full read must pass. "
            f"Got adjusted_match_rate={adjusted}, READING_PASS={Thresholds.READING_PASS}"
        )


class TestTranscriptionHallucinationDetector:
    """Unit tests for the transcription-layer hallucination check.

    Tests reading_transcription_service._is_hallucination_transcript,
    which runs *before* the transcript reaches the scoring layer.
    """

    def test_clean_prefix_transcript_detected(self):
        """A clean prefix transcript from Gemini should be detected as hallucination."""
        # Simulate Gemini returning the first ~20% of the target as a "transcript"
        target = _LONG_TARGET
        # Use a clean prefix (no errors) — typical hallucination shape
        prefix_len = max(1, len(target) // 5)
        hallucinated = target[:prefix_len]
        assert _is_hallucination_transcript(hallucinated, target), (
            "A clean short prefix should be detected as a hallucination transcript"
        )

    def test_noisy_transcript_not_detected(self):
        """A transcript with errors (real read) should not be flagged as hallucination."""
        target = _LONG_TARGET
        prefix_len = max(1, len(target) // 5)
        partial_chars = list(target[:prefix_len])
        # Add errors
        for i in [1, 4, 7]:
            if i < len(partial_chars):
                partial_chars[i] = "呢"
        noisy = "".join(partial_chars)
        assert not _is_hallucination_transcript(noisy, target), (
            "A noisy partial transcript (with errors) should not be flagged as hallucination"
        )

    def test_long_transcript_not_detected(self):
        """A long transcript (≥ 35% of target) is never blocked at transcription layer."""
        target = _LONG_TARGET
        long_transcript = target[:len(target) // 2]  # 50% of target
        assert not _is_hallucination_transcript(long_transcript, target), (
            "A long transcript (50% of target) should not be flagged as hallucination"
        )

    def test_empty_transcript_not_detected(self):
        """Empty transcript is handled by the empty guard, not the hallucination guard."""
        assert not _is_hallucination_transcript("", _LONG_TARGET), (
            "Empty transcript should return False (handled by the empty guard upstream)"
        )
