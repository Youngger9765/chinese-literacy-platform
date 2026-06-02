"""Executable spec — learning path recommendation contracts.

spec_id: learning.path.recommendation
canonical_source: backend/app/services/learning_path_service.py
related_issues: [252]
human_spec: specs/modules/learning-path/INTENT.md

Strategy:
  1. Catalog-structure contracts (no DB) — always run.
  2. Cold-start integration (student with no history) — uses a MagicMock DB
     session that returns empty query results, exercising the full
     recommend_next_stories() pipeline without any real database.

The personalisation path (student with real session history) is 待查:
it requires a PostgreSQL-compatible fixture, which is out of scope for
the spec layer.

Run:  cd backend && python -m pytest specs/test_learning_path_spec.py -v
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.services.learning_path_service import recommend_next_stories
from app.services.lesson_loader import get_all_lessons


# =========================================================================
# CONTRACT 1 — lesson catalog structure (pre-condition for learning path)
# =========================================================================

@pytest.fixture(scope="module")
def all_lessons() -> list[dict]:
    lessons = get_all_lessons()
    assert lessons, "get_all_lessons() must return a non-empty list"
    return lessons


def test_catalog_is_nonempty(all_lessons: list[dict]) -> None:
    assert len(all_lessons) > 0


def test_catalog_lessons_have_required_keys(all_lessons: list[dict]) -> None:
    required = ("lesson_number", "grade", "title")
    bad = [
        (l.get("lesson_number"), k)
        for l in all_lessons
        for k in required
        if k not in l
    ]
    assert not bad, f"lessons missing required keys: {bad[:10]}"


def test_catalog_lesson_numbers_are_numeric(all_lessons: list[dict]) -> None:
    """learning_path sorts by int(story_slug) — slugs must be numeric strings."""
    non_numeric = [
        l["lesson_number"]
        for l in all_lessons
        if not str(l["lesson_number"]).isdigit()
    ]
    assert not non_numeric, (
        f"lesson_number must be numeric (used as story_slug): {non_numeric[:5]}"
    )


def test_catalog_grades_in_valid_range(all_lessons: list[dict]) -> None:
    out_of_range = [l["lesson_number"] for l in all_lessons if l["grade"] not in range(4, 10)]
    assert not out_of_range, (
        f"lessons with grade outside [4, 9]: {out_of_range[:10]}"
    )


def test_catalog_titles_are_nonempty_strings(all_lessons: list[dict]) -> None:
    bad = [
        l["lesson_number"]
        for l in all_lessons
        if not isinstance(l.get("title"), str) or not l["title"].strip()
    ]
    assert not bad, f"lessons with missing/empty title: {bad[:10]}"


# =========================================================================
# Cold-start mock: DB session that returns empty results for a new student
# (no LearningSession rows, no CharacterError rows)
# =========================================================================

def _make_empty_db_mock() -> MagicMock:
    """Return a MagicMock that answers SQLAlchemy query chains with empty results.

    recommend_next_stories() calls db.query(...).filter(...).order_by(...).all()
    and db.query(...).join(...).filter(...).group_by(...).having(...).all().
    All chains return [] here — the cold-start path.
    """
    db = MagicMock()
    # Any query chain's terminal call (.all() / .scalar() / .first()) → empty
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
    db.query.return_value.join.return_value.filter.return_value.group_by.return_value.having.return_value.all.return_value = []
    return db


_NONEXISTENT_STUDENT_ID = 999_999


@pytest.fixture(scope="module")
def cold_start_recs() -> list[dict]:
    db = _make_empty_db_mock()
    return recommend_next_stories(
        student_id=_NONEXISTENT_STUDENT_ID,
        db=db,
        limit=5,
    )


# =========================================================================
# CONTRACT 2 — recommend_next_stories: return value structure
# =========================================================================

def test_recommendations_is_list(cold_start_recs: list) -> None:
    assert isinstance(cold_start_recs, list)


def test_recommendations_length_lte_limit(cold_start_recs: list) -> None:
    assert len(cold_start_recs) <= 5


def test_recommendations_have_required_keys(cold_start_recs: list) -> None:
    required = ("story_slug", "title", "grade", "genre",
                "difficulty_match_score", "reason")
    bad = [
        (r.get("story_slug"), k)
        for r in cold_start_recs
        for k in required
        if k not in r
    ]
    assert not bad, f"recommendation entries missing keys: {bad}"


# =========================================================================
# CONTRACT 3 — ALL recommended story_slugs exist in the catalog
# =========================================================================

def test_recommended_slugs_exist_in_catalog(
    cold_start_recs: list,
    all_lessons: list[dict],
) -> None:
    """Core invariant: no fabricated lesson codes."""
    valid_slugs = {str(l["lesson_number"]) for l in all_lessons}
    invalid = [
        r["story_slug"]
        for r in cold_start_recs
        if r["story_slug"] not in valid_slugs
    ]
    assert not invalid, (
        f"recommended story_slugs not in catalog: {invalid}"
    )


# =========================================================================
# CONTRACT 4 — grade in [4, 9] for all recommendations
# =========================================================================

def test_recommended_grades_in_valid_range(cold_start_recs: list) -> None:
    out_of_range = [
        (r["story_slug"], r["grade"])
        for r in cold_start_recs
        if r["grade"] not in range(4, 10)
    ]
    assert not out_of_range, (
        f"recommendations with grade outside [4, 9]: {out_of_range}"
    )


# =========================================================================
# CONTRACT 5 — reason field is a non-empty string
# =========================================================================

def test_recommended_reasons_are_nonempty(cold_start_recs: list) -> None:
    bad = [
        r["story_slug"]
        for r in cold_start_recs
        if not isinstance(r.get("reason"), str) or not r["reason"].strip()
    ]
    assert not bad, f"recommendations with empty reason: {bad}"


# =========================================================================
# CONTRACT 6 — no None elements in the returned list
# =========================================================================

def test_recommendations_contain_no_none(cold_start_recs: list) -> None:
    nones = [i for i, r in enumerate(cold_start_recs) if r is None]
    assert not nones, f"recommendation list contains None at positions: {nones}"


# =========================================================================
# CONTRACT 7 — limit parameter is respected for various values
# =========================================================================

@pytest.mark.parametrize("limit", [1, 3, 10])
def test_limit_respected(limit: int) -> None:
    db = _make_empty_db_mock()
    recs = recommend_next_stories(
        student_id=_NONEXISTENT_STUDENT_ID,
        db=db,
        limit=limit,
    )
    assert len(recs) <= limit
