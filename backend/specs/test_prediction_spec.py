"""Executable spec — prediction service rule-engine contracts.

spec_id: prediction.difficulty
canonical_source: backend/app/services/prediction_service.py
related_issues: [254]
human_spec: specs/modules/prediction/INTENT.md

Only pure helper functions are tested here (no DB, no mocking required).
The top-level predict_learning_difficulty() depends on DbSession and is covered
by integration tests; those contracts are noted as 待查 in INTENT.md.

Run:  cd backend && python -m pytest specs/test_prediction_spec.py -v
"""
from __future__ import annotations

import pytest

from app.services.prediction_service import (
    DECLINING_SESSIONS,
    _check_declining_trend,
    _check_stuck_count,
    _compute_risk_level,
    _empty_prediction,
)


# ---------------------------------------------------------------------------
# Lightweight stand-in for LearningSession; only accuracy & story_slug matter
# here (both are simple attribute accesses in the helpers under test).
# ---------------------------------------------------------------------------

class _Session:
    def __init__(self, accuracy: float | None, story_slug: str = "s1") -> None:
        self.accuracy = accuracy
        self.story_slug = story_slug


# =========================================================================
# CONTRACT 1 — _empty_prediction: safe fall-back structure
# =========================================================================

def test_empty_prediction_risk_level_is_low() -> None:
    """No-data prediction must never claim high/medium risk."""
    ep = _empty_prediction()
    assert ep["risk_level"] == "low"


def test_empty_prediction_confidence_is_zero() -> None:
    ep = _empty_prediction()
    assert ep["confidence_score"] == 0.0


def test_empty_prediction_has_all_required_keys() -> None:
    ep = _empty_prediction()
    for key in ("risk_level", "risk_factors", "recommended_actions",
                "confidence_score", "supporting_data"):
        assert key in ep, f"missing key: {key!r}"


def test_empty_prediction_lists_are_empty() -> None:
    ep = _empty_prediction()
    assert ep["risk_factors"] == []
    assert ep["recommended_actions"] == []


# =========================================================================
# CONTRACT 2 — _compute_risk_level: only 3 valid levels
# =========================================================================

VALID_RISK_LEVELS = {"low", "medium", "high"}


@pytest.mark.parametrize("factor_count,expected_level", [
    (0, "low"),
    (1, "low"),
    (2, "medium"),
    (3, "medium"),
    (4, "high"),
    (5, "high"),
])
def test_risk_level_mapping(factor_count: int, expected_level: str) -> None:
    factors = [f"factor_{i}" for i in range(factor_count)]
    sessions = [_Session(80.0)] * 5  # 5 sessions → data_confidence = 1.0
    level, _ = _compute_risk_level(factors, sessions)
    assert level == expected_level


def test_compute_risk_level_returns_valid_level() -> None:
    """The returned level string must always be one of the three valid values."""
    for n_factors in range(8):
        factors = [f"f{i}" for i in range(n_factors)]
        level, _ = _compute_risk_level(factors, [_Session(80.0)] * 5)
        assert level in VALID_RISK_LEVELS, (
            f"invalid risk_level {level!r} for {n_factors} factors"
        )


# =========================================================================
# CONTRACT 3 — _compute_risk_level: confidence_score in [0, 1]
# =========================================================================

@pytest.mark.parametrize("n_sessions", [0, 1, 3, 5, 10, 20])
def test_confidence_score_in_range(n_sessions: int) -> None:
    sessions = [_Session(80.0)] * n_sessions
    _, conf = _compute_risk_level(["factor"], sessions)
    assert 0.0 <= conf <= 1.0, f"confidence={conf} out of [0, 1] for {n_sessions} sessions"


def test_confidence_increases_with_more_sessions() -> None:
    """More session data → higher confidence (up to saturation)."""
    _, conf_few = _compute_risk_level(["f"], [_Session(80.0)] * 2)
    _, conf_many = _compute_risk_level(["f"], [_Session(80.0)] * 5)
    assert conf_many >= conf_few


# =========================================================================
# CONTRACT 4 — _check_declining_trend: strict monotone decreasing
# =========================================================================

def test_declining_trend_detects_strict_decrease() -> None:
    sessions = [_Session(90.0), _Session(80.0), _Session(70.0)]
    result = _check_declining_trend(sessions)
    assert result["is_declining"] is True


def test_declining_trend_not_triggered_by_flat() -> None:
    """Flat accuracy (no improvement, no decline) must NOT trigger the signal."""
    sessions = [_Session(80.0), _Session(80.0), _Session(80.0)]
    result = _check_declining_trend(sessions)
    assert result["is_declining"] is False


def test_declining_trend_not_triggered_by_improvement() -> None:
    sessions = [_Session(70.0), _Session(80.0), _Session(90.0)]
    result = _check_declining_trend(sessions)
    assert result["is_declining"] is False


def test_declining_trend_not_triggered_by_single_dip() -> None:
    """Only the last DECLINING_SESSIONS values are checked."""
    # Declining in the middle, but the last 3 are improving
    sessions = [_Session(90.0), _Session(80.0), _Session(70.0),
                _Session(75.0), _Session(80.0)]
    result = _check_declining_trend(sessions)
    assert result["is_declining"] is False


def test_declining_trend_skips_none_accuracy() -> None:
    """Sessions with accuracy=None are filtered before trend analysis."""
    sessions = [_Session(None), _Session(90.0), _Session(80.0), _Session(70.0)]
    result = _check_declining_trend(sessions)
    assert result["is_declining"] is True


def test_declining_trend_trend_list_has_no_nones() -> None:
    sessions = [_Session(None), _Session(80.0), _Session(None), _Session(70.0)]
    result = _check_declining_trend(sessions)
    assert all(v is not None for v in result["trend"])


# =========================================================================
# CONTRACT 5 — _check_stuck_count: < 5% improvement = stuck
# =========================================================================

def test_stuck_count_single_stuck_story() -> None:
    """Same story 3 times with < 5% improvement → count 1."""
    sessions = [
        _Session(60.0, "A"), _Session(62.0, "A"), _Session(63.0, "A"),
    ]
    assert _check_stuck_count(sessions) == 1


def test_stuck_count_improved_story_not_stuck() -> None:
    """Story with ≥ 5% improvement is NOT stuck."""
    sessions = [
        _Session(60.0, "A"), _Session(70.0, "A"), _Session(80.0, "A"),
    ]
    assert _check_stuck_count(sessions) == 0


def test_stuck_count_two_stuck_stories() -> None:
    sessions = [
        _Session(60.0, "A"), _Session(61.0, "A"), _Session(62.0, "A"),
        _Session(50.0, "B"), _Session(51.0, "B"), _Session(52.0, "B"),
    ]
    assert _check_stuck_count(sessions) == 2


def test_stuck_count_requires_three_attempts() -> None:
    """Fewer than 3 attempts for a story → cannot be stuck."""
    sessions = [_Session(60.0, "A"), _Session(62.0, "A")]
    assert _check_stuck_count(sessions) == 0


def test_stuck_count_returns_nonnegative_int() -> None:
    assert _check_stuck_count([]) == 0


# =========================================================================
# CONTRACT 6 — determinism: same input → same output for pure helpers
# =========================================================================

def test_declining_trend_is_deterministic() -> None:
    sessions = [_Session(90.0), _Session(80.0), _Session(70.0)]
    r1 = _check_declining_trend(sessions)
    r2 = _check_declining_trend(sessions)
    assert r1 == r2


def test_stuck_count_is_deterministic() -> None:
    sessions = [
        _Session(60.0, "X"), _Session(61.0, "X"), _Session(62.0, "X"),
    ]
    assert _check_stuck_count(sessions) == _check_stuck_count(sessions)


def test_compute_risk_level_is_deterministic() -> None:
    factors = ["f1", "f2"]
    sessions = [_Session(70.0)] * 4
    r1 = _compute_risk_level(factors, sessions)
    r2 = _compute_risk_level(factors, sessions)
    assert r1 == r2
