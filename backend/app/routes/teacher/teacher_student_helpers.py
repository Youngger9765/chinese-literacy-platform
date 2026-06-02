"""Shared helpers for teacher-student route modules.

Extracted from teacher_students.py to avoid repetition across
teacher_student_sessions / teacher_student_tags / teacher_student_reports /
teacher_classroom_stuck.
"""
import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...auth.policies import require_student_visible_to_teacher
from ...models.session import LearningSession
from ...models.user import User
from ...services.lesson_loader import get_lesson_by_id

logger = logging.getLogger(__name__)


def _require_teacher_owns_student(
    teacher_id: int, student_id: int, db: Session
) -> None:
    """Deprecated: Use require_student_visible_to_teacher from auth.policies instead."""
    user = db.query(User).filter(User.id == teacher_id).first()
    if user is None:
        raise HTTPException(status_code=403, detail="Teacher not found")
    require_student_visible_to_teacher(student_id, user, db)


def resolve_story_title(story_slug: str | None) -> str | None:
    """Resolve a story_slug to its display title.

    Returns None when story_slug is absent or the lesson cannot be found.
    Falls back to story_slug itself when it is non-numeric.
    """
    if not story_slug:
        return None
    try:
        story = get_lesson_by_id(int(story_slug))
        if story:
            return story["title"]
        return None
    except (ValueError, TypeError):
        return story_slug


def _get_session_for_teacher(
    teacher_id: int, student_id: int, session_id: int, db: Session
) -> LearningSession:
    """Fetch a session after verifying teacher authorization."""
    _require_teacher_owns_student(teacher_id, student_id, db)
    session = (
        db.query(LearningSession)
        .filter(
            LearningSession.id == session_id,
            LearningSession.student_id == student_id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session
