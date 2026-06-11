"""Shared helpers for learning sub-modules.

Provides common access-control utilities and shared Pydantic schemas
used across multiple learning route files.
"""
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models.school import Classroom, ClassroomStudent
from ...models.session import LearningSession
from ...models.user import User
from ...models.parent_link import ParentStudentLink


# ── Shared Pydantic schemas ───────────────────────────────────────────────────

class ConversationTurn(BaseModel):
    """A single turn in a dialogue — used by comprehension Q&A and scoring."""
    role: str   # "ai" | "student"
    text: str


def get_owned_session(session_id: int, current_user: User, db: Session) -> LearningSession:
    """Fetch a LearningSession that belongs to the authenticated user.

    Raises 404 if the session does not exist, 403 if it belongs to another user.
    Used by learning_step_progress, learning_annotations, and any other route
    that operates on a single student-owned session.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    return session


def verify_student_access(
    student_id: int,
    current_user: User,
    db: Session,
) -> None:
    """Verify the current user can access this student's data.

    Allowed if:
    - current_user IS the student
    - current_user is a teacher of a classroom containing the student
    - current_user is a parent linked to the student
    """
    if current_user.id == student_id:
        return

    # Check if current_user is a teacher of any classroom containing the student
    teacher_access = (
        db.query(Classroom)
        .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            ClassroomStudent.student_id == student_id,
            Classroom.teacher_id == current_user.id,
        )
        .first()
    )
    if teacher_access:
        return

    # Check if current_user is a parent linked to this student
    parent_link = (
        db.query(ParentStudentLink)
        .filter(
            ParentStudentLink.parent_id == current_user.id,
            ParentStudentLink.student_id == student_id,
            ParentStudentLink.is_active == True,  # noqa: E712
        )
        .first()
    )
    if parent_link:
        return

    raise HTTPException(status_code=403, detail="Access denied")
