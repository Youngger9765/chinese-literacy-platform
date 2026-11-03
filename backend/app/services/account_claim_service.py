"""
account_claim_service.py — Child-account handover for #3824 (two-phase).

A teacher-created ("child") account (#3818: created_by_teacher_id set by
batch-create / CSV upload / Junyi class import's new-student branch) claims
itself as a regular, self-owned account: binds a real email + a password the
student alone knows, and -- once the new email is verified -- permanently
clears created_by_teacher_id.

## Why two phases (security review finding H1, 2026-11-03)

The first version of this feature cleared created_by_teacher_id the instant
`request_claim()` succeeded. That is a PERMANENT, IRREVERSIBLE transfer of
recovery authority gated on nothing but "knows the current_password" -- which
for a teacher-created account is the printed credential card. Before #3824
existed, a classmate who read someone else's card could log in, but the
teacher could still reset the password to recover the account. The
single-phase design made that recovery impossible: whoever claimed it first,
permanently owns it, and only system_admin can intervene.

Two phases close that hole without abandoning the feature:

  Phase 1 (`request_claim`, this module): verifies current_password, then
  stores the desired new email in `pending_email` and issues a verification
  token. `created_by_teacher_id` is NOT touched -- the original creator can
  still reset this account's password for the whole pending window (and
  doing so clears the pending claim too, see classroom_password.py).

  Phase 2 (`complete_pending_claim`, in email_verification_service.py):
  redeeming the verification token writes `pending_email` into the live
  `email` column and ONLY THEN clears `created_by_teacher_id`.

This means completing a hostile claim now requires actually controlling the
mailbox at the new email address -- not just having once seen a printed
password -- and gives the real owner/teacher a window to notice and recover
via an ordinary password reset before that happens. It is not perfect
account-theft prevention (someone who also controls the new email from the
first request can still complete it quickly), but it converts "permanent,
silent, instant theft" into "theft with a recovery window and an audit
trail", which is the standard this codebase holds similar irreversible
actions to (see classroom_password.py's own two-gate design after #3818's
own security review).

Router (routes/auth.py) calls request_claim() and handles HTTP request/
response shaping + audit logging, matching the "thin HTTP boundary, business
logic in a service module" split already established for register/login/
password-reset.
"""

import logging
import secrets

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..auth.password import hash_password, verify_password
from ..models.user import User
from ..services.auth_registration_service import enforce_password_strength

logger = logging.getLogger(__name__)

EMAIL_VERIFICATION_TOKEN_BYTES = 32


def request_claim(
    db: Session,
    current_user: User,
    *,
    current_password: str,
    new_email: str,
    new_password: str,
) -> str:
    """Phase 1: request that the CALLER's own teacher-created account be
    claimed as a regular account. Does NOT clear created_by_teacher_id or
    write to `email` -- see module docstring for why. Operates only on
    `current_user`; there is no student_id parameter, by design (see PRD
    "誰能做這件事").

    Check order matters here (security review finding M1): the new-password
    strength check runs BEFORE the email-collision check, and
    current_password is verified before either. Originally the email check
    ran first, which let someone who already knows ANY one child account's
    password probe arbitrary email addresses for existence risk-free: submit
    a deliberately weak new_password, and 409 (email taken) vs 422 (weak
    password) tells them whether that email exists on the platform without
    ever risking an actual mutation. Checking current_password, then the new
    password's own strength, closes that specific free-form oracle; the
    rate limit added in routes/auth.py bounds whatever is left.

    Raises HTTPException on every rejection path; callers (routes/auth.py)
    do not need to translate return values into status codes.

    Returns:
        The email-verification token (dev-mode exposure is the route's
        concern, not this service's).
    """
    # AC5: this is a transition for a specific kind of account (one somebody
    # else is recorded as having created) -- not a generic "set my email"
    # endpoint. An account with no recorded creator is either already
    # self-registered or has already completed a claim; either way there is
    # nothing here for this endpoint to do, and silently succeeding would
    # hide that from the caller.
    if current_user.created_by_teacher_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="此帳號不是老師建立的附屬帳號，不需要過戶",
        )

    # Security review finding H1 (defense-in-depth half of the fix): this
    # mirrors #3818's own "two independent gates, both required" philosophy.
    # routes/auth.py's get_current_user dependency already blocks EVERY
    # endpoint except change-password/me for an account whose teacher-issued
    # password has never been changed (#3438) -- claim-account is
    # deliberately NOT in that exemption list (removed from it as part of
    # this fix), so in the normal request path this branch is unreachable.
    # It stays here so a future accidental re-exemption of this route still
    # cannot skip this requirement.
    if current_user.student_profile and not current_user.student_profile.password_changed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="請先透過「變更密碼」設定你自己的密碼，再申請帳號過戶",
        )

    # AC3: defense-in-depth -- re-confirm the current password even though
    # the caller already holds a valid JWT for this account (same pattern as
    # change_password's old_password check). Checked before the new
    # password's strength / the email check so a wrong current_password
    # never reveals anything about either.
    if not verify_password(current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="目前密碼不正確",
        )

    # AC8 / M1: strength-checked BEFORE the email-collision check — see
    # function docstring for why the order matters.
    enforce_password_strength(new_password)

    # AC4 / L2 (race, narrow half): reject if another account already holds
    # this email live, OR already has it reserved as ITS pending claim
    # target. A genuine simultaneous race on the same target email is still
    # possible (two requests both pass this SELECT before either commits);
    # the authoritative guard is the UNIQUE constraint on `users.email`,
    # enforced when phase 2 actually writes to it (see
    # email_verification_service.complete_pending_claim, which catches
    # IntegrityError there). This check exists to fail fast with a clear 409
    # in the common (non-racing) case.
    existing = (
        db.query(User)
        .filter(
            or_(User.email == new_email, User.pending_email == new_email),
            User.id != current_user.id,
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="此 Email 已被其他帳號使用或已被申請過戶",
        )

    verification_token = secrets.token_hex(EMAIL_VERIFICATION_TOKEN_BYTES)

    current_user.password_hash = hash_password(new_password)
    current_user.pending_email = new_email
    current_user.email_verification_token = verification_token
    if current_user.student_profile:
        # #3438: the student just set a password only they know -- same as
        # change-password, this must flip to True or get_current_user's
        # must-change-password gate would keep blocking every OTHER
        # endpoint for this account on its very next request. Note this is
        # independent of the pending-claim mechanism above: the new
        # PASSWORD takes effect immediately (phase 1), only the new EMAIL +
        # created_by_teacher_id wait for verification (phase 2).
        current_user.student_profile.password_changed = True

    db.commit()

    logger.info(
        "Account %d requested a claim (child-account handover, #3824, pending verification)",
        current_user.id,
    )

    return verification_token
