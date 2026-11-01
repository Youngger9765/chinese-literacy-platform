import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.password import hash_password
from ...auth.policies import is_system_admin, require_classroom_member
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
    # Matches get_classroom_detail's owner/co-teacher/admin gate, not owner-only mutation gates, because co-teacher resets are an explicit product requirement.
    require_classroom_member(classroom, current_user, db)

    if not is_system_admin(current_user.id, db):
        caller_has_school_teacher_role = (
            db.query(UserRole)
            .join(Role)
            .filter(
                UserRole.user_id == current_user.id,
                UserRole.is_active.is_(True),
                Role.name == "teacher",
                UserRole.scope_type == "school",
                UserRole.scope_id == str(classroom.school_id),
            )
            .first()
        )
        if caller_has_school_teacher_role is None:
            raise HTTPException(
                status_code=403,
                detail="Caller does not hold teacher authority at this classroom's school",
            )

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

    active_target_roles = (
        db.query(Role.name, UserRole.scope_type, UserRole.scope_id)
        .join(Role)
        .filter(
            UserRole.user_id == student_id,
            UserRole.is_active.is_(True),
        )
        .all()
    )

    def _is_allowed_target_role(role_name: str, scope_type: str, scope_id: str | None) -> bool:
        if role_name != "student":
            return False
        # (#3804) Every account now carries a platform-scoped `student` role
        # by default from registration (grant_default_student_role) -- that
        # row is universal and harmless, not a sign the target also holds
        # some other privilege, so it must not trip this gate. The gate's
        # actual job is still enforced below: a school-scoped student role
        # must match THIS classroom's school.
        if scope_type == "platform":
            return True
        return scope_type == "school" and scope_id == str(classroom.school_id)

    has_disallowed_target_role = any(
        not _is_allowed_target_role(role_name, scope_type, scope_id)
        for role_name, scope_type, scope_id in active_target_roles
    )
    if has_disallowed_target_role:
        raise HTTPException(
            status_code=403,
            detail="Cannot reset password for a non-student account",
        )

    if (
        user.student_profile is not None
        and user.student_profile.school_id != classroom.school_id
    ):
        raise HTTPException(
            status_code=403,
            detail="Student is not a verified member of this classroom's school",
        )

    # (#3804) bool(active_target_roles) used to mean "has the school-scoped
    # student role granted at enrollment" -- the only role a student could
    # have. Now every account also carries the universal platform-scoped
    # default student role, so that trivially-true check no longer proves
    # membership in THIS school; it must look for the actual school-scoped
    # row (allowed by _is_allowed_target_role above, so this is just finding
    # it, not re-validating it).
    has_matching_student_role = any(
        scope_type == "school" and scope_id == str(classroom.school_id)
        for _role_name, scope_type, scope_id in active_target_roles
    )
    has_matching_student_profile = (
        user.student_profile is not None
        and user.student_profile.school_id == classroom.school_id
    )
    if not has_matching_student_role and not has_matching_student_profile:
        raise HTTPException(
            status_code=403,
            detail="Student is not a verified member of this classroom's school",
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
