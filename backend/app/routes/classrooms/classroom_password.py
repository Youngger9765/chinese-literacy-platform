import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.password import hash_password
from ...auth.policies import require_classroom_member
from ...database import get_db
from ...models.school import ClassroomStudent
from ...models.user import Role, StudentProfile, User, UserRole
from ...schemas.classroom import ResetPasswordResponse
from ...services.audit_logger import AuditAction, audit_log_endpoint
from .helpers import get_classroom_or_404

router = APIRouter(tags=["classrooms"])


@router.post(
    "/classrooms/{classroom_id}/students/{student_id}/reset-password",
    response_model=ResetPasswordResponse,
)
def reset_student_password(
    classroom_id: int,
    student_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResetPasswordResponse:
    """Reset an enrolled student's password for an authorized classroom member."""
    classroom = get_classroom_or_404(classroom_id, db)
    require_classroom_member(classroom, current_user, db)

    caller_has_teacher_authority = (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == current_user.id,
            UserRole.is_active.is_(True),
            Role.name.in_(("teacher", "system_admin", "org_admin", "org_owner")),
        )
        .first()
    )
    if caller_has_teacher_authority is None:
        raise HTTPException(status_code=403, detail="Caller does not hold teacher authority")

    enrollment = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
    )
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Student not enrolled in this classroom")

    user = db.query(User).filter(User.id == student_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="Student not found")

    privileged_role = (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == student_id,
            UserRole.is_active.is_(True),
            Role.name.in_(("teacher", "system_admin", "org_admin", "org_owner")),
        )
        .first()
    )
    if privileged_role is not None:
        raise HTTPException(
            status_code=403,
            detail="Cannot reset password for a privileged account",
        )

    password = "".join(
        secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8)
    )
    user.password_hash = hash_password(password)
    user.password_reset_token = None
    user.password_reset_expires = None
    if user.student_profile:
        user.student_profile.password_changed = False
    else:
        db.add(
            StudentProfile(
                user_id=user.id,
                school_id=classroom.school_id,
                student_number=None,
                password_changed=False,
            )
        )

    db.commit()
    audit_log_endpoint(
        request=request,
        action=AuditAction.RESET_STUDENT_PASSWORD,
        user_id=current_user.id,
        target_student_id=student_id,
    )

    return ResetPasswordResponse(
        username=user.username or user.email,
        email=user.email,
        password=password,
    )
