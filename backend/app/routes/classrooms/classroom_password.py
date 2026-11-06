import secrets
import string
from datetime import datetime, timezone

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
    # Matches get_classroom_detail's owner/co-teacher/admin gate: this only
    # governs whether the caller can see this student at all (classroom
    # roster visibility). It is NOT sufficient authority to reset a
    # password -- see the password-teacher gate below.
    require_classroom_member(classroom, current_user, db)

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

    # (#3818) Two independent gates, both required (defense in depth) unless
    # the caller is system_admin:
    #
    # 1. Caller must CURRENTLY hold an active `teacher` role at this
    #    classroom's school. require_classroom_member above only checked
    #    classroom.teacher_id / ClassroomTeacher membership, which does NOT
    #    verify the role is still active -- a teacher whose account was
    #    deactivated (role revoked) but who is still classroom.teacher_id
    #    would otherwise still pass. This is the pre-#3818 check, restored
    #    after a security review flagged its removal as a regression.
    # 2. Caller must be the student's recorded password teacher -- the
    #    teacher who actually created THIS account (batch-create / CSV
    #    upload / Junyi class import), not any co-teacher who merely also
    #    teaches the classroom. Accounts nobody is recorded as having
    #    created (created_by_teacher_id is NULL: self-registration via
    #    email/Google/Junyi SSO, or legacy data) can never be reset by a
    #    teacher; fail closed, the student uses forgot-password instead.
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
        if user.created_by_teacher_id != current_user.id:
            raise HTTPException(
                status_code=403,
                detail="Only the student's password teacher (the teacher who created "
                       "this account) may reset it",
            )

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
    # Claude Security find_016vZk1d3wRKkhjQMTUbGU6Y (low): invalidate any
    # token issued before this teacher reset -- see auth/dependencies.py's
    # get_current_user, which compares this against each token's `iat`.
    # Floored to the whole second (coordinator review 2026-11-06, see
    # routes/auth.py's change_password for why) so a token minted in the
    # same second as this reset -- e.g. the student logging in right after
    # the teacher resets it -- is still accepted.
    user.password_changed_at = datetime.now(timezone.utc).replace(microsecond=0)
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
