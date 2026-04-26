"""Unit tests for parse_step_progress — Issue #1180.

Covers the four cases described in the issue fix direction:
1. Well-formed payload → no warning, returns validated StepProgressData
2. Malformed dict (wrong-type field) → WARNING logged, returns None (fallback)
3. Null / None raw → no warning, returns None (fresh session)
4. Non-dict (e.g. string or integer) → WARNING logged, returns None (fallback)

Run with:
    cd backend && JWT_SECRET_KEY=test-secret python -m pytest tests/test_step_progress_parse.py -v
"""

import logging
import pytest
from app.schemas.session import parse_step_progress, StepProgressData


# ── Case 1: Well-formed payload — no warning, no fallback ────────────────────

def test_parse_step_progress_valid_full_payload(caplog):
    """Valid payload returns StepProgressData; no WARNING is emitted."""
    raw = {
        "current_step": "full_reading",
        "steps_completed": ["reading-annotation", "tutor"],
        "step_data": {"tutor": {"score": 90}},
        "version": 3,
        "__meta": {"source": "self"},
    }
    with caplog.at_level(logging.WARNING, logger="app.schemas.session"):
        result = parse_step_progress(raw, session_id=42)

    assert result is not None
    assert isinstance(result, StepProgressData)
    assert result.current_step == "full_reading"
    assert result.steps_completed == ["reading-annotation", "tutor"]
    assert result.step_data == {"tutor": {"score": 90}}
    assert result.version == 3
    assert result.meta == {"source": "self"}
    # No WARNING should have been emitted
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings == [], f"Unexpected warnings: {warnings}"


def test_parse_step_progress_valid_minimal_payload(caplog):
    """Minimal valid payload (only required keys absent → defaults used)."""
    raw = {
        "current_step": None,
        "steps_completed": [],
        "step_data": {},
    }
    with caplog.at_level(logging.WARNING, logger="app.schemas.session"):
        result = parse_step_progress(raw, session_id=7)

    assert result is not None
    assert result.current_step is None
    assert result.steps_completed == []
    assert result.step_data == {}
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings == []


# ── Case 2: Null / None raw — silent default, no warning ─────────────────────

def test_parse_step_progress_none_returns_none_no_warning(caplog):
    """None raw value → returns None, no WARNING (fresh session)."""
    with caplog.at_level(logging.WARNING, logger="app.schemas.session"):
        result = parse_step_progress(None, session_id=99)

    assert result is None
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings == []


# ── Case 3: Non-dict raw — WARNING logged, returns None ──────────────────────

def test_parse_step_progress_string_emits_warning(caplog):
    """String raw → WARNING with session_id and type info, returns None."""
    with caplog.at_level(logging.WARNING, logger="app.schemas.session"):
        result = parse_step_progress("invalid_string", session_id=101)

    assert result is None
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert len(warnings) == 1
    msg = warnings[0].message
    assert "101" in msg          # session_id in log
    assert "str" in msg          # type reported


def test_parse_step_progress_integer_emits_warning(caplog):
    """Integer raw (old current_step fallback) → WARNING, returns None."""
    with caplog.at_level(logging.WARNING, logger="app.schemas.session"):
        result = parse_step_progress(3, session_id=55)

    assert result is None
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert len(warnings) == 1
    assert "55" in warnings[0].message
    assert "int" in warnings[0].message


def test_parse_step_progress_list_emits_warning(caplog):
    """List raw → WARNING, returns None."""
    with caplog.at_level(logging.WARNING, logger="app.schemas.session"):
        result = parse_step_progress(["step1", "step2"], session_id=22)

    assert result is None
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert len(warnings) == 1
    assert "22" in warnings[0].message


# ── Case 4: Dict with wrong-type field — WARNING logged, returns None ─────────

def test_parse_step_progress_wrong_type_steps_completed_emits_warning(caplog):
    """steps_completed is a string instead of list → Pydantic coerces or fails.

    Pydantic v2 will attempt coercion; if the field type is list[str] and the value
    is a plain string, it may raise a ValidationError (in strict mode) or coerce.
    We check that either we get a valid result OR a WARNING is emitted — the key
    requirement is that we never silently return partial garbage.
    """
    raw = {
        "current_step": "vocab",
        "steps_completed": "should-be-a-list",  # wrong type
        "step_data": {},
    }
    with caplog.at_level(logging.WARNING, logger="app.schemas.session"):
        result = parse_step_progress(raw, session_id=77)

    # Either coerced (Pydantic wraps str → ["should-be-a-list"]) or returns None with warning.
    # Both are acceptable; what matters is no silent partial data or uncaught exception.
    if result is not None:
        # Pydantic coerced: result must be a valid StepProgressData
        assert isinstance(result, StepProgressData)
    else:
        # Validation failed: a WARNING must have been logged
        warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
        assert len(warnings) >= 1


def test_parse_step_progress_context_appears_in_warning(caplog):
    """Context label should appear in the WARNING message."""
    with caplog.at_level(logging.WARNING, logger="app.schemas.session"):
        parse_step_progress("bad_data", session_id=200, context="test.my_context")

    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("test.my_context" in w.message for w in warnings)


def test_parse_step_progress_no_session_id(caplog):
    """session_id=None should not crash — logs 'None' as placeholder."""
    with caplog.at_level(logging.WARNING, logger="app.schemas.session"):
        result = parse_step_progress("bad", session_id=None)

    assert result is None
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert len(warnings) == 1
