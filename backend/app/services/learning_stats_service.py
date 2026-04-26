"""Shared helpers for computing learning statistics.

Centralises canonical queries so that dashboard, progress, and gamification
endpoints always return consistent numbers.
"""
from __future__ import annotations

from sqlalchemy import exists, func as sqlfunc, or_
from sqlalchemy.orm import Session

from ..models.assignment import AssignmentSubmission
from ..models.session import LearningSession


def _is_session_done_clause():
    """Return an OR clause that matches 'canonically completed' sessions.

    A session is done if:
      (a) session.status == 'completed'  — direct completion path, OR
      (b) it has an AssignmentSubmission with status IN ('submitted', 'graded')
          — assignment path where session.status may still be 'in_progress'
          because the submission endpoint did not update it (Issue #1181).

    Using this helper everywhere ensures a single canonical definition across
    dashboard, stats, and gamification endpoints (Issue #1192).
    """
    submitted_sub = (
        exists()
        .where(AssignmentSubmission.session_id == LearningSession.id)
        .where(AssignmentSubmission.status.in_(["submitted", "graded"]))
    )
    return or_(LearningSession.status == "completed", submitted_sub)


def get_completed_story_count(db: Session, student_id: int) -> int:
    """Return the number of distinct stories a student has completed.

    Canonical definition: sessions where status='completed' OR the session has
    an AssignmentSubmission with status in ('submitted', 'graded').

    This is the single source of truth used by the dashboard, progress, and
    gamification endpoints to ensure they all report the same value.
    """
    result = (
        db.query(sqlfunc.count(sqlfunc.distinct(LearningSession.story_slug)))
        .filter(
            LearningSession.student_id == student_id,
            _is_session_done_clause(),
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
            _is_session_done_clause(),
            LearningSession.story_slug.isnot(None),
        )
        .all()
    )
    return [r[0] for r in rows]
