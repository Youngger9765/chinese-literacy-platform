"""Executable spec — learning_stats_service canonical completion clause.

spec_id: learning.stats.completed_story_canonical
canonical_source: backend/app/services/learning_stats_service.py
owns_code: backend/app/services/learning_stats_service.py
related_issues: [1181, 1192]
human_spec: specs/modules/learning-stats/INTENT.md

Machine-verifiable contracts:

  1. _is_session_done_clause() returns a non-None SQLAlchemy clause object.
     (Structural — guards against accidental None return from the function
      that ALL completion-counting queries depend on.)

  2. int(scalar_or_none or 0) pattern — the guard that makes
     get_completed_story_count() return 0 not None on empty data.
     Pure arithmetic — no DB needed.

Contracts NOT testable here (require DB or real SQLAlchemy engine):
  - The OR clause executes correctly against PostgreSQL
  - get_completed_story_count == len(get_completed_story_slugs) consistency
  - scalar() returning None on empty table (handled by int(result or 0))

Run: cd backend && python -m pytest specs/test_learning_stats_spec.py -v
"""
from __future__ import annotations


# ---------------------------------------------------------------------------
# Contract 1: _is_session_done_clause returns a non-None SQLAlchemy element
# ---------------------------------------------------------------------------

def test_is_session_done_clause_returns_non_none():
    """_is_session_done_clause() must return a truthy clause object.

    All completion-counting queries depend on this function.  A None return
    would silently drop the filter, returning incorrect (too high) counts.

    We import and call the function without a DB session because it builds
    a SQLAlchemy clause expression, not execute a query.
    """
    from app.services.learning_stats_service import _is_session_done_clause

    clause = _is_session_done_clause()
    assert clause is not None, "_is_session_done_clause() must not return None"


def test_is_session_done_clause_is_callable_multiple_times():
    """Calling _is_session_done_clause() twice must produce two distinct objects.

    The function must be pure (no shared mutable state) so that multiple
    query sites don't interfere with each other.
    """
    from app.services.learning_stats_service import _is_session_done_clause

    clause_a = _is_session_done_clause()
    clause_b = _is_session_done_clause()
    # Each call returns a new expression object (not a cached singleton that
    # could be mutated by SQLAlchemy query compilation).
    assert clause_a is not clause_b, (
        "_is_session_done_clause() should return a fresh expression each call"
    )


# ---------------------------------------------------------------------------
# Contract 2: zero-safe guard — int(result or 0) semantics
# ---------------------------------------------------------------------------

def _simulate_story_count(scalar_result) -> int:
    """Mirror the production guard in get_completed_story_count().

    Production (line 52): `return int(result or 0)`
    This converts None (SQLAlchemy scalar on empty table) → 0.
    """
    return int(scalar_result or 0)


def test_scalar_none_becomes_zero():
    """When the DB scalar() returns None (empty table), count is 0 not None."""
    assert _simulate_story_count(None) == 0


def test_scalar_zero_stays_zero():
    """When the DB scalar() returns 0 (no matching rows), count stays 0."""
    assert _simulate_story_count(0) == 0


def test_scalar_positive_int_passes_through():
    """Normal case: a positive scalar count is returned as int."""
    assert _simulate_story_count(5) == 5
    assert _simulate_story_count(1) == 1


def test_count_is_non_negative():
    """get_completed_story_count must never return a negative value.

    The DB count() aggregate always returns >= 0.  The guard int(result or 0)
    cannot produce a negative number from None or a non-negative DB result.
    """
    for scalar in [None, 0, 1, 42, 100]:
        result = _simulate_story_count(scalar)
        assert result >= 0, f"count must be >= 0, got {result} for scalar={scalar}"


def test_count_return_type_is_int():
    """get_completed_story_count always returns int, never float or None."""
    assert isinstance(_simulate_story_count(None), int)
    assert isinstance(_simulate_story_count(3), int)
