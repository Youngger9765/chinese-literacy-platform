"""
Tests for Bug C fix (Issue #1378): full_reading_attempts array append + cap.

Tests the helper function _maybe_append_full_reading_attempt from
learning_step_progress.py, which:
- Extracts result from step_data['full-reading']['result']
- Appends snapshot to full_reading_attempts (capped at 4)
- Skips duplicate attempts (same cpm + duration_ms)
- Updates full_reading_result scalar for backward compat

Run with:
    cd backend
    python -m pytest tests/test_full_reading_attempts.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from unittest.mock import MagicMock
from app.routes.learning.learning_step_progress import (
    _maybe_append_full_reading_attempt,
    _MAX_FULL_READING_ATTEMPTS,
)


def make_session(existing_attempts=None):
    """Create a mock LearningSession with controllable attributes."""
    session = MagicMock()
    session.full_reading_attempts = existing_attempts if existing_attempts is not None else []
    session.full_reading_result = None
    return session


def make_step_data(cpm=200, accuracy=0.95, match_rate=0.95, duration_ms=30000, audio_url=None):
    return {
        "full-reading": {
            "result": {
                "cpm": cpm,
                "accuracy": accuracy,
                "matchRate": match_rate,
                "durationMs": duration_ms,
                "audioUrl": audio_url,
            }
        }
    }


class TestMaybeAppendFullReadingAttempt:
    def test_first_attempt_appended(self):
        session = make_session()
        step_data = make_step_data(cpm=200)

        _maybe_append_full_reading_attempt(session, step_data)

        assert len(session.full_reading_attempts) == 1
        attempt = session.full_reading_attempts[0]
        assert attempt["attempt_index"] == 1
        assert attempt["cpm"] == 200

    def test_backward_compat_full_reading_result_updated(self):
        session = make_session()
        step_data = make_step_data(cpm=210, accuracy=0.90)

        _maybe_append_full_reading_attempt(session, step_data)

        assert session.full_reading_result is not None
        assert session.full_reading_result["cpm"] == 210

    def test_second_attempt_increments_index(self):
        existing = [
            {"attempt_index": 1, "cpm": 190, "duration_ms": 25000},
        ]
        session = make_session(existing_attempts=existing)
        step_data = make_step_data(cpm=210, duration_ms=28000)

        _maybe_append_full_reading_attempt(session, step_data)

        assert len(session.full_reading_attempts) == 2
        assert session.full_reading_attempts[1]["attempt_index"] == 2
        assert session.full_reading_attempts[1]["cpm"] == 210

    def test_cap_at_4_attempts(self):
        existing = [
            {"attempt_index": i, "cpm": 180 + i * 5, "duration_ms": 30000 + i * 1000}
            for i in range(1, 5)  # 4 existing attempts
        ]
        session = make_session(existing_attempts=existing)
        step_data = make_step_data(cpm=230, duration_ms=22000)

        _maybe_append_full_reading_attempt(session, step_data)

        # Should still be 4 (cap enforced), not 5
        assert len(session.full_reading_attempts) == _MAX_FULL_READING_ATTEMPTS
        assert len(session.full_reading_attempts) == 4

    def test_cap_reindexes_attempt_index(self):
        existing = [
            {"attempt_index": i, "cpm": 180 + i * 5, "duration_ms": 30000 + i * 1000}
            for i in range(1, 5)
        ]
        session = make_session(existing_attempts=existing)
        step_data = make_step_data(cpm=250, duration_ms=20000)

        _maybe_append_full_reading_attempt(session, step_data)

        # After cap, indices should be 1-4
        indices = [a["attempt_index"] for a in session.full_reading_attempts]
        assert indices == [1, 2, 3, 4]

    def test_duplicate_skip_same_cpm_and_duration(self):
        existing = [
            {"attempt_index": 1, "cpm": 200, "duration_ms": 30000},
        ]
        session = make_session(existing_attempts=existing)
        # Same cpm and durationMs as last attempt
        step_data = make_step_data(cpm=200, duration_ms=30000)

        _maybe_append_full_reading_attempt(session, step_data)

        # Should NOT append (page-reload dedup)
        assert len(session.full_reading_attempts) == 1

    def test_no_full_reading_key_in_step_data(self):
        session = make_session()
        step_data = {"vocab": {"result": {}}}  # no full-reading key

        _maybe_append_full_reading_attempt(session, step_data)

        assert len(session.full_reading_attempts) == 0

    def test_none_step_data_no_error(self):
        session = make_session()

        _maybe_append_full_reading_attempt(session, None)

        assert len(session.full_reading_attempts) == 0

    def test_full_reading_result_none_no_append(self):
        session = make_session()
        step_data = {"full-reading": {"result": None}}

        _maybe_append_full_reading_attempt(session, step_data)

        assert len(session.full_reading_attempts) == 0

    def test_attempt_contains_timestamp(self):
        session = make_session()
        step_data = make_step_data(cpm=215)

        _maybe_append_full_reading_attempt(session, step_data)

        attempt = session.full_reading_attempts[0]
        assert "timestamp" in attempt
        assert attempt["timestamp"]  # non-empty string

    def test_attempt_contains_all_expected_fields(self):
        session = make_session()
        step_data = make_step_data(cpm=220, accuracy=0.92, match_rate=0.92, duration_ms=27500, audio_url="gs://bucket/audio.mp3")

        _maybe_append_full_reading_attempt(session, step_data)

        attempt = session.full_reading_attempts[0]
        assert attempt["cpm"] == 220
        assert attempt["accuracy"] == 0.92
        assert attempt["match_rate"] == 0.92
        assert attempt["duration_ms"] == 27500
        assert attempt["audio_url"] == "gs://bucket/audio.mp3"

    def test_malformed_full_reading_attempts_reset_to_empty(self):
        """If full_reading_attempts is corrupt (not a list), reset gracefully."""
        session = make_session()
        session.full_reading_attempts = "corrupt-value"  # type: ignore
        step_data = make_step_data(cpm=200)

        _maybe_append_full_reading_attempt(session, step_data)

        assert len(session.full_reading_attempts) == 1
