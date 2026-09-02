"""Teacher "preview as student" token issuance (Issue #3027).

Why this exists
----------------
Hans's on-site teacher demo feedback: teachers cannot see what a student sees,
so a fully-shipped feature (AI story recommendations, GET
/learning/recommendations/{student_id}) was reported as "missing" simply
because there was no way to reach it from the teacher side.

This endpoint mints a short-lived, read-only JWT whose `sub` claim is the
STUDENT's id (not the teacher's) — every existing route that resolves
`current_user` from `sub` therefore keeps working completely unmodified when
a teacher previews. The token additionally carries `preview=True` +
`preview_by=<teacher_id>`, which PreviewModeWriteGuardMiddleware
(app/main.py) checks to block every non-GET/HEAD/OPTIONS request made with
it — regardless of which endpoint it targets. See
docs/prd/2026-09-hans-feedback-teacher-visibility.md for the full design and
the enumerated list of write paths this protects.

Authorization is deliberately NARROWER than the existing
`verify_student_access` helper (backend/app/routes/learning/_helpers.py),
which also allows the student themselves and linked parents. Only a teacher
who owns a classroom containing this student may mint a preview token —
self-preview and parent-preview are out of scope for this feature.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.jwt import PREVIEW_TOKEN_EXPIRE_MINUTES, create_preview_access_token
from ...database import get_db
from ...models.school import Classroom, ClassroomStudent
from ...models.user import User

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


class PreviewTokenResponse(BaseModel):
    preview_token: str
    student_id: int
    student_name: str
    expires_in_minutes: int


def _verify_teacher_of_student(student_id: int, current_user: User, db: Session) -> None:
    """Only the teacher of a classroom containing this student may preview them.

    Narrower than verify_student_access on purpose — see module docstring.
    Does NOT accept any admin/role-flag shortcut (see
    docs/prd/2026-09-hans-feedback-teacher-visibility.md §1.2: `is_admin` is
    not a safe global bypass in this codebase).
    """
    teacher_access = (
        db.query(Classroom)
        .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            ClassroomStudent.student_id == student_id,
            Classroom.teacher_id == current_user.id,
        )
        .first()
    )
    if not teacher_access:
        raise HTTPException(status_code=403, detail="Not a teacher of this student")


@router.post(
    "/teacher/students/{student_id}/preview-token",
    response_model=PreviewTokenResponse,
)
def issue_preview_token(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Issue a short-lived, read-only "preview as student_id" token."""
    _verify_teacher_of_student(student_id, current_user, db)

    student = db.query(User).filter(User.id == student_id).first()
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found")

    token = create_preview_access_token(student_id=student_id, teacher_id=current_user.id)
    logger.info(
        "Preview token issued: teacher=%d student=%d", current_user.id, student_id
    )
    return PreviewTokenResponse(
        preview_token=token,
        student_id=student_id,
        student_name=student.name,
        expires_in_minutes=PREVIEW_TOKEN_EXPIRE_MINUTES,
    )
