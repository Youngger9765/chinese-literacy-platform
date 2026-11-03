import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.password import hash_password
from ...auth.policies import require_classroom_editor
from ...database import get_db
from ...models.school import ClassroomStudent
from ...models.user import StudentProfile, User
from ...schemas.classroom import ResetPasswordResponse
from ...services.audit_logger import AuditAction, audit_log_endpoint
from .helpers import get_classroom_or_404, require_renameable_student_target

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
    """Reset an enrolled student's password.

    Owner, accepted 'editor'-role co-teacher, or system_admin (#3820). A
    'viewer'-role co-teacher cannot reset a student's password -- this used
    to be gated at the plain member level (any co-teacher, co-teacher resets
    being an explicit product requirement), which is now split: resets stay
    allowed for editors, but are blocked for the new read-only viewer role.
    """
    classroom = get_classroom_or_404(classroom_id, db)
    # Gate 1 of 2: owner, accepted 'editor'-role co-teacher, or system_admin
    # (#3820) -- a 'viewer'-role co-teacher is blocked here. This only
    # governs whether the caller can act on this classroom at all; it is
    # NOT sufficient authority to reset a password -- see the
    # password-teacher gate below (#3818, gate 2 of 2).
    require_classroom_editor(classroom, current_user, db)

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

    # (#3818, extracted to a shared helper by #3826's security review) Two
    # independent gates, both required (defense in depth) unless the caller
    # is system_admin -- caller must currently hold an active teacher role
    # at this classroom's school AND be the student's recorded password
    # teacher -- plus target-role/school validation so a non-student or
    # wrong-school account can never be touched. See
    # helpers.require_renameable_student_target's docstring for the full
    # rationale; rename_student (classroom_students.py, #3826) calls the
    # exact same gate for the exact same reason (both mutate something
    # shared platform-wide, not classroom-local).
    user = require_renameable_student_target(classroom, student_id, current_user, db)

    # (#3824 security review finding H1) A teacher reset also REVOKES any
    # pending child-account-claim handover (see account_claim_service.py):
    # whoever requested the claim proved they knew the OLD password, which
    # this reset just invalidated, so their in-flight request to bind a new
    # email + eventually strip this teacher's reset authority must not be
    # allowed to complete later via a verification token issued under the
    # old credential. This is the recovery path the two-phase design exists
    # for: the real owner (or the teacher, on their behalf) notices the
    # account looks wrong and resets it DURING the pending window, before
    # the claimant redeems their verification token.
    had_pending_claim = user.pending_email is not None
    if had_pending_claim:
        user.pending_email = None
        user.email_verification_token = None

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
    if had_pending_claim:
        audit_log_endpoint(
            request=request,
            action=AuditAction.CLAIM_ACCOUNT_REVOKED,
            user_id=current_user.id,
            target_student_id=student_id,
            extra={"reason": "password_reset_by_creator"},
        )

    return ResetPasswordResponse(
        username=user.username or user.email,
        email=user.email,
        password=password,
    )
