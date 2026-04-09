"""Shared helpers for computing learning statistics.

Centralises canonical queries so that dashboard, progress, and gamification
endpoints always return consistent numbers.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..models.session import LearningSession
from ..utils.slug import normalize_story_slug


def _completed_slugs_raw(db: Session, student_id: int) -> list[str]:
    """Fetch raw story_slug values for all completed sessions of a student."""
    rows = (
        db.query(LearningSession.story_slug)
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.status == "completed",
            LearningSession.story_slug.isnot(None),
        )
        .distinct()
        .all()
    )
    return [r[0] for r in rows if r[0]]


def get_completed_story_count(db: Session, student_id: int) -> int:
    """Return the number of distinct stories a student has completed.

    Normalizes slugs so that legacy formats (e.g. "L06", Chinese titles)
    are not double-counted with the canonical numeric format ("6").
    Issue #985.
    """
    raw_slugs = _completed_slugs_raw(db, student_id)
    normalized = {normalize_story_slug(s) for s in raw_slugs}
    return len(normalized)


def get_completed_story_slugs(db: Session, student_id: int) -> list[str]:
    """Return the distinct normalized story slugs the student has completed.

    Same canonical filter as :func:`get_completed_story_count`; the dashboard
    uses the slug list while other endpoints use just the count.
    Issue #985: normalizes slugs to avoid duplicates from legacy formats.
    """
    raw_slugs = _completed_slugs_raw(db, student_id)
    normalized = sorted({normalize_story_slug(s) for s in raw_slugs})
    return normalized
