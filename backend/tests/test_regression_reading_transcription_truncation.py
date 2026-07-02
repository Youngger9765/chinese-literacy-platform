"""Regression: reading transcription must not truncate long readings.

Bug (memory verification 2026-07-02): transcribe_reading_audio used a hardcoded
max_output_tokens=1024. The response is JSON {transcript, reasoning} where the
transcript ≈ the full reading (target_text up to ~3000 chars). For a long
reading the transcript+reasoning exceeded 1024 tokens → Gemini cut the JSON off
→ json.loads raised → the broad except degraded to a generic-error fallback
(student had to re-read), with no signal that the token budget was the cause.

Fix: size the output budget to the reading length (_transcription_max_tokens)
and detect MAX_TOKENS truncation explicitly (_REASON_TRUNCATED).

Run: cd backend && python -m pytest tests/test_regression_reading_transcription_truncation.py -v
"""
from __future__ import annotations

from app.services import reading_transcription_service as svc


def test_short_reading_keeps_floor_budget():
    """Very short readings still get at least the 1024 floor."""
    assert svc._transcription_max_tokens("你好") == 1024
    assert svc._transcription_max_tokens("") == 1024


def test_long_reading_gets_more_than_the_old_hardcoded_1024():
    """A realistic full-text reading must get a budget well above the old 1024,
    otherwise the transcript JSON truncates (the bug being fixed)."""
    long_reading = "字" * 600  # ~600-char reading (mid-length lesson)
    budget = svc._transcription_max_tokens(long_reading)
    assert budget > 1024, "long readings must exceed the old hardcoded 1024 budget"
    # ≈ 2 output tokens/char + reasoning buffer
    assert budget >= 600 * 2


def test_budget_is_clamped_to_ceiling():
    """Even the longest lesson (~3000 chars) stays within a safe ceiling."""
    huge = "字" * 5000
    budget = svc._transcription_max_tokens(huge)
    assert budget <= 8192


def test_budget_monotonic_non_decreasing_with_length():
    a = svc._transcription_max_tokens("字" * 100)
    b = svc._transcription_max_tokens("字" * 800)
    c = svc._transcription_max_tokens("字" * 2000)
    assert a <= b <= c


def test_truncated_reason_constant_exists():
    """An explicit MAX_TOKENS fallback reason must exist (not a silent JSON error)."""
    assert getattr(svc, "_REASON_TRUNCATED", None) == "truncated"
