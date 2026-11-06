import secrets
import string
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.password import hash_password
from ...auth.policies import require_classroom_editor
from ...database import get_db
from ...models.school import ClassroomStudent
from ...models.user import StudentProfile, User
from ...schemas.classroom import (
    ApproveAccountClaimResponse,
    RejectAccountClaimResponse,
    ResetPasswordResponse,
)
from ...services.audit_logger import AuditAction, audit_log_endpoint
from .helpers import get_classroom_or_404, require_renameable_student_target

router = APIRouter(tags=["classrooms"])


def _require_enrolled(classroom_id: int, student_id: int, db: Session) -> None:
    """Shared by reset-password / approve-claim / reject-claim: confirms the
    target is actually enrolled in THIS classroom. Kept separate from
    ``require_renameable_student_target`` (helpers.py) -- that gate checks
    "may this teacher touch this student account" (created_by_teacher_id,
    role, school) but never checks classroom enrollment at all, matching
    reset_student_password's own inline enrollment check below."""
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
    _require_enrolled(classroom_id, student_id, db)

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
    # pending child-account-claim request (see account_claim_service.py):
    # whoever filed the claim proved they knew the OLD password, which this
    # reset just invalidated, so their request must not be left sitting
    # there for someone to approve later under stale pretenses. This is the
    # recovery path the approval-gated design exists alongside: the real
    # owner (or the teacher, on their behalf) notices the account looks
    # wrong and resets it, clearing whatever was pending.
    had_pending_claim = user.pending_email is not None
    if had_pending_claim:
        user.pending_email = None

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


@router.post(
    "/classrooms/{classroom_id}/students/{student_id}/approve-claim",
    response_model=ApproveAccountClaimResponse,
)
def approve_account_claim(
    classroom_id: int,
    student_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApproveAccountClaimResponse:
    """#3824: the student's recorded password teacher approves a filed
    account-claim request (POST /auth/claim-account), completing the
    handover -- this is the ONLY action that writes `pending_email` into the
    live `email` column and clears `created_by_teacher_id`.

    Deliberately the SAME authorization gate as reset-password (#3818,
    #3826): ``require_classroom_editor`` (a 'viewer'-role co-teacher is
    blocked, same as reset-password) plus
    ``helpers.require_renameable_student_target`` (must be the account's
    recorded creator, or system_admin). This closes security review finding
    H1 completely -- someone who merely knows the account's current
    password can file a request (POST /auth/claim-account), but nothing
    they do themselves can ever complete it. Completion requires this
    specific, independent teacher to take an explicit action.
    """
    classroom = get_classroom_or_404(classroom_id, db)
    require_classroom_editor(classroom, current_user, db)
    _require_enrolled(classroom_id, student_id, db)
    user = require_renameable_student_target(classroom, student_id, current_user, db)

    if user.pending_email is None:
        raise HTTPException(status_code=404, detail="此學生目前沒有待核准的過戶申請")

    final_email = user.pending_email
    previous_teacher_id = user.created_by_teacher_id
    user.email = user.pending_email
    user.pending_email = None
    user.created_by_teacher_id = None

    try:
        db.commit()
    except IntegrityError:
        # L2: another account's claim for the same email was approved first
        # between this request's own SELECT-based check (in
        # account_claim_service.request_claim) and this commit -- a genuine
        # race, not the common case (which 409s earlier, at request time).
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="此 Email 已被其他帳號搶先使用，過戶失敗，請該學生重新申請",
        )

    audit_log_endpoint(
        request=request,
        action=AuditAction.CLAIM_ACCOUNT_COMPLETED,
        user_id=current_user.id,
        target_student_id=student_id,
        extra={"previous_teacher_id": previous_teacher_id, "final_email": final_email},
    )

    return ApproveAccountClaimResponse(
        message="已核准過戶，學生現在可以用新的 Email 與密碼登入。",
        email=final_email,
    )


@router.post(
    "/classrooms/{classroom_id}/students/{student_id}/reject-claim",
    response_model=RejectAccountClaimResponse,
)
def reject_account_claim(
    classroom_id: int,
    student_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RejectAccountClaimResponse:
    """#3824: the student's recorded password teacher rejects a filed
    account-claim request. created_by_teacher_id is left untouched -- the
    teacher keeps full authority over this account; only the pending
    request itself is cleared, so the student may file a new one later.

    Same gate as approve-claim: ``require_classroom_editor`` +
    ``helpers.require_renameable_student_target``."""
    classroom = get_classroom_or_404(classroom_id, db)
    require_classroom_editor(classroom, current_user, db)
    _require_enrolled(classroom_id, student_id, db)
    user = require_renameable_student_target(classroom, student_id, current_user, db)

    if user.pending_email is None:
        raise HTTPException(status_code=404, detail="此學生目前沒有待核准的過戶申請")

    user.pending_email = None
    db.commit()

    audit_log_endpoint(
        request=request,
        action=AuditAction.CLAIM_ACCOUNT_REVOKED,
        user_id=current_user.id,
        target_student_id=student_id,
        extra={"reason": "rejected_by_creator"},
    )

    return RejectAccountClaimResponse(
        message="已拒絕此過戶申請，帳號仍由原建立老師管理。",
    )
