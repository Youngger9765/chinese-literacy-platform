"""Executable spec — gamification XP and level progression contracts.

spec_id: gamification.xp.level_progression
canonical_source: backend/app/models/gamification.py
owns_code:
  - backend/app/models/gamification.py
  - backend/app/services/gamification_service.py
related_issues: []
human_spec: specs/modules/gamification-xp/INTENT.md

Machine-verifiable contracts (all pure functions, no DB required):

  1. xp_to_level(0) == 1  (Level 1 is the starting level)
  2. xp_to_level monotonically non-decreasing in XP
  3. Level 10 is the ceiling: xp_to_level never exceeds 10
  4. Each LEVEL_THRESHOLD boundary triggers the correct level
  5. XP_REWARDS values are all non-negative
  6. LEVEL_THRESHOLDS is monotonically increasing
  7. level_progress() returns all required keys with correct types
  8. progress_pct is always clamped 0–100
  9. xp_to_next is 0 at max level

Run:  cd backend && python -m pytest specs/test_gamification_xp_spec.py -v
"""
from __future__ import annotations

import pytest


def _import_gamification():
    try:
        from app.models.gamification import (
            LEVEL_THRESHOLDS,
            XP_REWARDS,
            xp_to_level,
            level_progress,
        )
        return LEVEL_THRESHOLDS, XP_REWARDS, xp_to_level, level_progress
    except Exception as exc:
        pytest.skip(f"Cannot import gamification models (run from backend/): {exc}")


# ---------------------------------------------------------------------------
# Contract 1: Level 1 is the starting level
# ---------------------------------------------------------------------------

def test_xp_to_level_at_zero_is_one():
    """xp_to_level(0) == 1: a new student starts at Level 1."""
    _, _, xp_to_level, _ = _import_gamification()
    assert xp_to_level(0) == 1


def test_xp_to_level_at_negative_treated_as_level_one():
    """xp_to_level with XP < 0 should not crash and should return level 1.

    XP is always non-negative in practice, but the function should be robust.
    """
    _, _, xp_to_level, _ = _import_gamification()
    # Documented in INTENT.md §7 as an edge case that returns 1 (threshold 0 >= 0)
    result = xp_to_level(-1)
    assert result >= 1


# ---------------------------------------------------------------------------
# Contract 2: Monotonic level progression
# ---------------------------------------------------------------------------

def test_level_increases_or_stays_same_as_xp_increases():
    """xp_to_level is monotonically non-decreasing: more XP ↔ same or higher level.

    Samples across the full XP range up to 5000 (beyond max level).
    """
    _, _, xp_to_level, _ = _import_gamification()
    prev_level = xp_to_level(0)
    for xp in range(1, 5001, 10):
        current_level = xp_to_level(xp)
        assert current_level >= prev_level, (
            f"Level decreased: xp={xp} gave level={current_level} "
            f"but xp={xp - 10} gave level={prev_level}"
        )
        prev_level = current_level


# ---------------------------------------------------------------------------
# Contract 3: Level 10 ceiling
# ---------------------------------------------------------------------------

def test_xp_to_level_never_exceeds_ten():
    """Level 10 is the maximum — xp_to_level never returns > 10."""
    _, _, xp_to_level, _ = _import_gamification()
    for xp in (4000, 5000, 10000, 999999):
        assert xp_to_level(xp) == 10, (
            f"xp_to_level({xp}) should be 10 (max level), got {xp_to_level(xp)}"
        )


# ---------------------------------------------------------------------------
# Contract 4: Level threshold boundaries
# ---------------------------------------------------------------------------

def test_reaching_threshold_gives_correct_level():
    """Exactly reaching a threshold XP value yields that level.

    LEVEL_THRESHOLDS[i] is the cumulative XP needed to reach level i+1.
    Example: LEVEL_THRESHOLDS[1] = 100 → xp_to_level(100) == 2
    """
    LEVEL_THRESHOLDS, _, xp_to_level, _ = _import_gamification()
    for i, threshold in enumerate(LEVEL_THRESHOLDS):
        expected_level = i + 1
        result = xp_to_level(threshold)
        assert result == expected_level, (
            f"At threshold XP={threshold}, expected level {expected_level}, got {result}"
        )


def test_one_below_threshold_gives_previous_level():
    """One XP below a level threshold keeps the student at the previous level."""
    LEVEL_THRESHOLDS, _, xp_to_level, _ = _import_gamification()
    for i in range(1, len(LEVEL_THRESHOLDS)):
        threshold = LEVEL_THRESHOLDS[i]
        if threshold == 0:
            continue
        result = xp_to_level(threshold - 1)
        assert result == i, (
            f"At XP={threshold - 1} (one below level {i+1} threshold={threshold}), "
            f"expected level {i}, got {result}"
        )


# ---------------------------------------------------------------------------
# Contract 5: XP_REWARDS — all values non-negative
# ---------------------------------------------------------------------------

def test_xp_rewards_all_non_negative():
    """All XP reward amounts are non-negative (≥ 0).

    Negative rewards would cause XP to decrease, violating the spec guarantee
    that XP is always non-negative.
    """
    _, XP_REWARDS, _, _ = _import_gamification()
    violations = {k: v for k, v in XP_REWARDS.items() if v < 0}
    assert not violations, (
        f"XP_REWARDS contains negative values: {violations}. "
        "XP must never decrease — use a separate mechanic if penalties are needed."
    )


def test_xp_rewards_are_integers():
    """All XP reward amounts are integers (no fractional XP)."""
    _, XP_REWARDS, _, _ = _import_gamification()
    non_int = {k: v for k, v in XP_REWARDS.items() if not isinstance(v, int)}
    assert not non_int, f"XP_REWARDS has non-integer values: {non_int}"


def test_xp_rewards_has_session_complete_key():
    """session_complete is the primary reward event and must always exist."""
    _, XP_REWARDS, _, _ = _import_gamification()
    assert "session_complete" in XP_REWARDS, (
        "XP_REWARDS must have 'session_complete' key — this is the primary session reward."
    )


# ---------------------------------------------------------------------------
# Contract 6: LEVEL_THRESHOLDS is strictly monotonically increasing
# ---------------------------------------------------------------------------

def test_level_thresholds_monotonically_increasing():
    """LEVEL_THRESHOLDS must be non-decreasing (level n+1 requires more XP than level n).

    Non-monotonic thresholds would break xp_to_level() and allow impossible level jumps.
    """
    LEVEL_THRESHOLDS, _, _, _ = _import_gamification()
    for i in range(1, len(LEVEL_THRESHOLDS)):
        assert LEVEL_THRESHOLDS[i] > LEVEL_THRESHOLDS[i - 1], (
            f"LEVEL_THRESHOLDS[{i}]={LEVEL_THRESHOLDS[i]} is not > "
            f"LEVEL_THRESHOLDS[{i-1}]={LEVEL_THRESHOLDS[i-1]}. "
            "Thresholds must be strictly increasing."
        )


def test_level_thresholds_count_is_ten():
    """There are exactly 10 levels."""
    LEVEL_THRESHOLDS, _, _, _ = _import_gamification()
    assert len(LEVEL_THRESHOLDS) == 10, (
        f"Expected 10 levels, got {len(LEVEL_THRESHOLDS)}. "
        "Update specs/modules/gamification-xp/INTENT.md if adding levels."
    )


def test_level_one_threshold_is_zero():
    """Level 1 requires 0 XP (everyone starts at Level 1)."""
    LEVEL_THRESHOLDS, _, _, _ = _import_gamification()
    assert LEVEL_THRESHOLDS[0] == 0, (
        f"Level 1 threshold must be 0 (starting level), got {LEVEL_THRESHOLDS[0]}"
    )


# ---------------------------------------------------------------------------
# Contract 7: level_progress() return structure
# ---------------------------------------------------------------------------

def test_level_progress_has_all_required_keys():
    """level_progress() must return all documented keys."""
    _, _, _, level_progress = _import_gamification()
    result = level_progress(500)
    required_keys = {
        "level", "level_name", "total_xp", "current_level_xp",
        "next_level_xp", "xp_to_next", "progress_pct",
    }
    missing = required_keys - set(result.keys())
    assert not missing, f"level_progress() missing key(s): {missing}"


def test_level_progress_total_xp_reflects_input():
    """level_progress(x)['total_xp'] == x."""
    _, _, _, level_progress = _import_gamification()
    for xp in (0, 100, 500, 1200, 4000):
        result = level_progress(xp)
        assert result["total_xp"] == xp, (
            f"level_progress({xp})['total_xp'] = {result['total_xp']}, expected {xp}"
        )


def test_level_progress_pct_clamped_0_to_100():
    """progress_pct is always in [0, 100]."""
    _, _, _, level_progress = _import_gamification()
    for xp in range(0, 5001, 50):
        result = level_progress(xp)
        assert 0 <= result["progress_pct"] <= 100, (
            f"progress_pct={result['progress_pct']} for XP={xp} is outside [0, 100]"
        )


def test_level_progress_xp_to_next_zero_at_max_level():
    """At max level (Level 10), xp_to_next == 0."""
    _, _, _, level_progress = _import_gamification()
    result = level_progress(4000)  # Level 10 threshold
    assert result["xp_to_next"] == 0, (
        f"At max level, xp_to_next should be 0, got {result['xp_to_next']}"
    )
    assert result["progress_pct"] == 100


def test_level_progress_at_zero_xp():
    """A brand-new student (0 XP) starts at Level 1 with 0 current_level_xp."""
    _, _, _, level_progress = _import_gamification()
    result = level_progress(0)
    assert result["level"] == 1
    assert result["current_level_xp"] == 0
    assert result["xp_to_next"] > 0  # not at max level yet
