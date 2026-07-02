"""Regression: OMO grader circuit breaker must NOT latch permanently open.

Bug (backend audit 2026-07-02): the top-of-function guard raised RuntimeError
whenever ``_consecutive_errors >= threshold`` — but the only success reset lives
*after* the Gemini call, which that same guard prevents any call from reaching.
So 3 transient Vertex errors wedged OMO grading OFF for every student on that
Cloud Run instance until it restarted, even after Vertex recovered.

Fix: time-based half-open breaker. While tripped AND within the cooldown window
it still fast-fails; once the cooldown elapses a probe call is allowed through so
a recovered service can reset the breaker.

Run:  cd backend && python -m pytest tests/test_regression_omo_grader_circuit_breaker.py -v
"""
from __future__ import annotations

import time
from unittest.mock import patch

import pytest

from app.services import omo_grader


@pytest.fixture(autouse=True)
def _reset_breaker_state():
    """Isolate the module-global breaker state between tests."""
    saved = (omo_grader._consecutive_errors, omo_grader._circuit_open_until)
    yield
    omo_grader._consecutive_errors, omo_grader._circuit_open_until = saved
    # Ensure a clean slate for any later test in the session.
    omo_grader._consecutive_errors = 0
    omo_grader._circuit_open_until = 0.0


@pytest.mark.asyncio
async def test_breaker_allows_probe_after_cooldown_elapsed():
    """Once the cooldown has elapsed, a tripped breaker must let a call through
    (half-open probe) instead of raising forever."""
    omo_grader._consecutive_errors = omo_grader._CIRCUIT_BREAKER_THRESHOLD
    omo_grader._circuit_open_until = 0.0  # cooldown already elapsed

    # Isolate the guard: no questions → returns [] without touching Gemini.
    with patch.object(omo_grader, "_build_question_schema", return_value=[]):
        result = await omo_grader.grade_worksheet_images(
            [b"x"], ["image/png"], {"title": "t"}
        )

    assert result == [], "probe should reach the no-questions path, not hard-fail"


@pytest.mark.asyncio
async def test_breaker_still_blocks_during_cooldown():
    """While tripped AND inside the cooldown window, the breaker must fast-fail."""
    omo_grader._consecutive_errors = omo_grader._CIRCUIT_BREAKER_THRESHOLD
    omo_grader._circuit_open_until = time.monotonic() + 60  # still cooling down

    with patch.object(omo_grader, "_build_question_schema", return_value=[]):
        with pytest.raises(RuntimeError):
            await omo_grader.grade_worksheet_images(
                [b"x"], ["image/png"], {"title": "t"}
            )


@pytest.mark.asyncio
async def test_breaker_not_open_below_threshold():
    """Below the error threshold the breaker never blocks, regardless of timing."""
    omo_grader._consecutive_errors = omo_grader._CIRCUIT_BREAKER_THRESHOLD - 1
    omo_grader._circuit_open_until = time.monotonic() + 60

    with patch.object(omo_grader, "_build_question_schema", return_value=[]):
        result = await omo_grader.grade_worksheet_images(
            [b"x"], ["image/png"], {"title": "t"}
        )

    assert result == []
