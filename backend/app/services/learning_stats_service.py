"""Shared helpers for computing learning statistics.

Centralises canonical queries so that dashboard, progress, and gamification
endpoints always return consistent numbers.
"""
from __future__ import annotations

from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session

from ..models.session import LearningSession


def get_completed_story_count(db: Session, student_id: int) -> int:
    """Return the number of distinct stories a student has completed.

    Canonical definition: COUNT(DISTINCT story_slug) FROM learning_sessions
    WHERE student_id = ? AND status = 'completed' AND story_slug IS NOT NULL.

    This is the single source of truth used by the dashboard, progress, and
    gamification endpoints to ensure they all report the same value.
    """
    result = (
        db.query(sqlfunc.count(sqlfunc.distinct(LearningSession.story_slug)))
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.status == "completed",
            LearningSession.story_slug.isnot(None),
        )
        .scalar()
    )
    return int(result or 0)


def get_completed_story_slugs(db: Session, student_id: int) -> list[str]:
    """Return the distinct story slugs the student has completed.

    Same canonical filter as :func:`get_completed_story_count`; the dashboard
    uses the slug list while other endpoints use just the count.
    """
    rows = (
        db.query(sqlfunc.distinct(LearningSession.story_slug))
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.status == "completed",
            LearningSession.story_slug.isnot(None),
        )
        .all()
    )
    return [r[0] for r in rows]
