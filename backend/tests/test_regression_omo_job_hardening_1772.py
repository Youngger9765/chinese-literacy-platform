"""Regression tests for OMO background-task hardening (issue #1772).

Tests:
    Timeout:
        _run_identification: asyncio.TimeoutError → status='error', Chinese message
        _run_grading:        asyncio.TimeoutError → status='error', Chinese message
    Idempotency:
        _run_identification: no-op when status already in {'identified','grading','graded'}
        _run_grading:        no-op when status already 'graded'
    Module docstring:
        asyncio imported
        _IDENTIFICATION_TIMEOUT / _GRADING_TIMEOUT constants present
        _IDENTIFICATION_TERMINAL / _GRADING_TERMINAL sets correct
        _fetch_upload_status helper exported

Run:
    cd backend && python -m pytest tests/test_regression_omo_job_hardening_1772.py -v
"""

import asyncio
import sys
import os
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest


# ---------------------------------------------------------------------------
# Import module under test
# ---------------------------------------------------------------------------

from app.services import omo_jobs
from app.services.omo_jobs import (
    _run_identification,
    _run_grading,
    _IDENTIFICATION_TIMEOUT,
    _GRADING_TIMEOUT,
    _IDENTIFICATION_TERMINAL,
    _GRADING_TERMINAL,
    _fetch_upload_status,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TINY_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 12 + b"\xff\xd9"


def _make_upload_mock(status: str):
    """Return a MagicMock that behaves like an OmoUpload with the given status."""
    obj = MagicMock()
    obj.status = status
    obj.id = 99
    obj.attempts = []
    obj.identification = None
    return obj


# ---------------------------------------------------------------------------
# Module-level constants check
# ---------------------------------------------------------------------------

class TestModuleConstants:
    def test_identification_timeout_value(self):
        assert _IDENTIFICATION_TIMEOUT == 90, "Expected 90s identification timeout"

    def test_grading_timeout_value(self):
        assert _GRADING_TIMEOUT == 120, "Expected 120s grading timeout"

    def test_identification_terminal_set(self):
        assert _IDENTIFICATION_TERMINAL == frozenset({"identified", "grading", "graded"})

    def test_grading_terminal_set(self):
        assert _GRADING_TERMINAL == frozenset({"graded"})

    def test_asyncio_imported(self):
        import inspect
        src = inspect.getsource(omo_jobs)
        assert "import asyncio" in src

    def test_fetch_upload_status_callable(self):
        assert callable(_fetch_upload_status)


# ---------------------------------------------------------------------------
# Timeout tests — _run_identification
# ---------------------------------------------------------------------------

class TestIdentificationTimeout:
    @pytest.mark.asyncio
    async def test_timeout_sets_error_status(self):
        """When _do_identify hangs past 90s, status → 'error' with Chinese message."""
        updated_calls = []

        async def _slow_identify(*args, **kwargs):
            await asyncio.sleep(200)  # Simulates a hung task

        with (
            patch("app.services.omo_jobs._fetch_upload_status", return_value="identifying"),
            patch("app.services.omo_jobs._update_upload", side_effect=lambda upload_id, **kw: updated_calls.append(kw)),
            patch("asyncio.wait_for", side_effect=asyncio.TimeoutError),
        ):
            await _run_identification(
                upload_id=1,
                image_bytes_list=[_TINY_JPEG],
                mime_types=["image/jpeg"],
            )

        assert updated_calls, "Expected _update_upload to be called on timeout"
        last_call = updated_calls[-1]
        assert last_call.get("status") == "error"
        msg = last_call.get("error_message", "")
        assert "超時" in msg or "timeout" in msg.lower(), f"Expected timeout message, got: {msg!r}"
        assert str(_IDENTIFICATION_TIMEOUT) in msg

    @pytest.mark.asyncio
    async def test_timeout_does_not_reraise(self):
        """TimeoutError must be caught — caller must NOT see an unhandled exception."""
        with (
            patch("app.services.omo_jobs._fetch_upload_status", return_value="identifying"),
            patch("app.services.omo_jobs._update_upload"),
            patch("asyncio.wait_for", side_effect=asyncio.TimeoutError),
        ):
            # Should complete without raising
            await _run_identification(
                upload_id=2,
                image_bytes_list=[_TINY_JPEG],
                mime_types=["image/jpeg"],
            )


# ---------------------------------------------------------------------------
# Timeout tests — _run_grading
# ---------------------------------------------------------------------------

class TestGradingTimeout:
    @pytest.mark.asyncio
    async def test_timeout_sets_error_status(self):
        """When _do_grade hangs past 120s, status → 'error' with Chinese message."""
        updated_calls = []

        with (
            patch("app.services.omo_jobs._fetch_upload_status", return_value="grading"),
            patch("app.services.omo_jobs._update_upload", side_effect=lambda upload_id, **kw: updated_calls.append(kw)),
            patch("asyncio.wait_for", side_effect=asyncio.TimeoutError),
        ):
            await _run_grading(upload_id=3, lesson_id=1)

        assert updated_calls, "Expected _update_upload to be called on timeout"
        last_call = updated_calls[-1]
        assert last_call.get("status") == "error"
        msg = last_call.get("error_message", "")
        assert "超時" in msg or "timeout" in msg.lower(), f"Expected timeout message, got: {msg!r}"
        assert str(_GRADING_TIMEOUT) in msg

    @pytest.mark.asyncio
    async def test_timeout_does_not_reraise(self):
        """TimeoutError must be caught — caller must NOT see an unhandled exception."""
        with (
            patch("app.services.omo_jobs._fetch_upload_status", return_value="grading"),
            patch("app.services.omo_jobs._update_upload"),
            patch("asyncio.wait_for", side_effect=asyncio.TimeoutError),
        ):
            await _run_grading(upload_id=4, lesson_id=1)


# ---------------------------------------------------------------------------
# Idempotency tests — _run_identification
# ---------------------------------------------------------------------------

class TestIdentificationIdempotency:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("terminal_status", ["identified", "grading", "graded"])
    async def test_skips_when_already_terminal(self, terminal_status):
        """_run_identification is a no-op when upload is already in a terminal state."""
        update_called = []

        with (
            patch("app.services.omo_jobs._fetch_upload_status", return_value=terminal_status),
            patch("app.services.omo_jobs._update_upload", side_effect=lambda *a, **kw: update_called.append(kw)),
        ):
            await _run_identification(
                upload_id=10,
                image_bytes_list=[_TINY_JPEG],
                mime_types=["image/jpeg"],
            )

        assert not update_called, (
            f"Expected no DB writes when status={terminal_status!r}, "
            f"but got: {update_called}"
        )

    @pytest.mark.asyncio
    async def test_proceeds_when_status_identifying(self):
        """_run_identification proceeds (calls wait_for) when status='identifying'."""
        wait_for_called = []

        async def _fake_wait_for(coro, timeout):
            wait_for_called.append(timeout)
            # Drain the coroutine to avoid ResourceWarning
            try:
                await coro
            except Exception:
                pass

        with (
            patch("app.services.omo_jobs._fetch_upload_status", return_value="identifying"),
            patch("app.services.omo_jobs._update_upload"),
            patch("asyncio.wait_for", side_effect=_fake_wait_for),
        ):
            await _run_identification(
                upload_id=11,
                image_bytes_list=[_TINY_JPEG],
                mime_types=["image/jpeg"],
            )

        assert wait_for_called, "Expected asyncio.wait_for to be called"
        assert wait_for_called[0] == _IDENTIFICATION_TIMEOUT


# ---------------------------------------------------------------------------
# Idempotency tests — _run_grading
# ---------------------------------------------------------------------------

class TestGradingIdempotency:
    @pytest.mark.asyncio
    async def test_skips_when_already_graded(self):
        """_run_grading is a no-op when upload is already 'graded'."""
        update_called = []

        with (
            patch("app.services.omo_jobs._fetch_upload_status", return_value="graded"),
            patch("app.services.omo_jobs._update_upload", side_effect=lambda *a, **kw: update_called.append(kw)),
        ):
            await _run_grading(upload_id=20, lesson_id=1)

        assert not update_called, (
            f"Expected no DB writes when status='graded', but got: {update_called}"
        )

    @pytest.mark.asyncio
    @pytest.mark.parametrize("non_terminal_status", ["identifying", "identified", "grading"])
    async def test_proceeds_when_not_graded(self, non_terminal_status):
        """_run_grading proceeds (calls wait_for) when status is not yet 'graded'."""
        wait_for_called = []

        async def _fake_wait_for(coro, timeout):
            wait_for_called.append(timeout)
            try:
                await coro
            except Exception:
                pass

        with (
            patch("app.services.omo_jobs._fetch_upload_status", return_value=non_terminal_status),
            patch("app.services.omo_jobs._update_upload"),
            patch("asyncio.wait_for", side_effect=_fake_wait_for),
        ):
            await _run_grading(upload_id=21, lesson_id=1)

        assert wait_for_called, f"Expected asyncio.wait_for to be called for status={non_terminal_status!r}"
        assert wait_for_called[0] == _GRADING_TIMEOUT
