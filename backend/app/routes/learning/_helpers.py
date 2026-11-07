"""Shared helpers for learning sub-modules.

Provides common access-control utilities and shared Pydantic schemas
used across multiple learning route files.
"""
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...models.school import Classroom, ClassroomStudent
from ...models.session import LearningSession
from ...models.user import User
from ...models.parent_link import ParentStudentLink


# ── Shared Pydantic schemas ───────────────────────────────────────────────────

#: Same cap `sanitize_ai_input` already enforces server-side (input_sanitizer.py
#: MAX_INPUT_LENGTH) -- declaring it on the schema too means an oversized turn
#: is rejected with a 422 before any handler code runs, not silently truncated
#: deep inside the sanitizer after the whole payload was already parsed.
CONVERSATION_TURN_TEXT_MAX_LENGTH = 2000


class ConversationTurn(BaseModel):
    """A single turn in a dialogue — used by comprehension Q&A and scoring.

    Claude Security find_01AS6qqjWCjVEXLM2gfFuGyT (medium): `role` used to
    be a bare `str`, and only a turn whose role was EXACTLY "student" was
    ever sanitized/truncated by the route handlers (learning_comprehension_
    score.py). A client-supplied turn labelled anything else -- "ai" in
    particular, since the handlers assumed that label meant "server-
    generated, therefore already safe" -- passed straight into the Gemini
    prompt unfiltered and at unbounded length. Restricting `role` to the
    only two values ANY route handler or the frontend ever actually
    produces means a request with any other value now fails schema
    validation (422) before it reaches a handler at all -- there is no
    longer a third label for a handler to special-case or forget to
    sanitize.
    """
    role: Literal["student", "ai"]
    text: str = Field(..., max_length=CONVERSATION_TURN_TEXT_MAX_LENGTH)


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
