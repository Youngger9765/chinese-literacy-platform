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
from ...models.school import Classroom, ClassroomStudent, ClassroomTeacher
from ...models.user import Role, User, UserRole

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


class PreviewTokenResponse(BaseModel):
    preview_token: str
    student_id: int
    student_name: str
    expires_in_minutes: int


def _is_student_only_account(target_id: int, db: Session) -> bool:
    """find_014THSjuvhjxDwpKystW3dXv (medium, CWE-863), recommendation 1:
    a preview token loans the TARGET's full role set to whoever mints it
    (get_current_user resolves `sub` to the complete User, preview claims
    are not read by anything except the write-blocking middleware). An
    enrolled ClassroomStudent row alone is not proof the target is
    student-only -- the target may have self-activated as a teacher or
    admin AFTER being enrolled (roles are never retroactively revoked),
    or may be a teacher/parent/admin an owner enrolled via join code or
    POST /classrooms/{id}/students.

    True only if EVERY active role the target holds is named "student"
    AND they own or co-teach no classroom at all (belt-and-suspenders:
    ownership/co-teaching should always imply a teacher role too, but
    this does not rely on that invariant holding forever).
    """
    non_student_role = (
        db.query(UserRole.id)
        .join(Role, UserRole.role_id == Role.id)
        .filter(
            UserRole.user_id == target_id,
            UserRole.is_active == True,  # noqa: E712
            Role.name != "student",
        )
        .first()
    )
    if non_student_role is not None:
        return False

    owns_a_classroom = (
        db.query(Classroom.id).filter(Classroom.teacher_id == target_id).first()
    )
    if owns_a_classroom is not None:
        return False

    co_teaches_a_classroom = (
        db.query(ClassroomTeacher.id)
        .filter(ClassroomTeacher.teacher_id == target_id)
        .first()
    )
    if co_teaches_a_classroom is not None:
        return False

    return True


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

    # find_014THSjuvhjxDwpKystW3dXv: enrolment alone is not proof the
    # target is a student whose identity may be safely loaned -- see
    # _is_student_only_account's docstring.
    if not _is_student_only_account(student_id, db):
        raise HTTPException(
            status_code=403,
            detail="This account is not a plain student and cannot be previewed",
        )


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
