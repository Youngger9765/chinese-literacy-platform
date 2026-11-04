"""
account_claim_service.py — Child-account handover for #3824, approval-gated.

A teacher-created ("child") account (#3818: created_by_teacher_id set by
batch-create / CSV upload / Junyi class import's new-student branch) FILES A
REQUEST to become a regular, self-owned account: verifies current_password,
sets a new password immediately, and reserves the desired new email in
`pending_email` — WITHOUT touching created_by_teacher_id or `email`.

## Design history (why this is approval-gated, not email-verification-gated)

v1 (single-phase): request_claim() cleared created_by_teacher_id the instant
it succeeded. A security review (H1) found this let anyone who merely knew a
teacher-issued card password permanently strip the real creator's recovery
authority in one call.

v2 (email-verification two-phase): completion moved to redeeming an emailed
verification token, so created_by_teacher_id stayed set until someone proved
control of the new email's mailbox. A SECOND review pass found this only
DOWNGRADES H1, not closes it: an attacker who sets new_email to an address
they themselves control can file the request AND redeem their own token
within about a minute, with no notification mechanism giving the real
creator any reason to look. (It also turned out to be moot in practice today
— `settings.is_dev` is False in staging/production, so no environment
currently has real email sending wired up, meaning phase 2 could not
actually be completed anywhere persistent — but that is an accident of what
isn't built yet, not a property of the design.)

v3 (this version, Young's explicit direction, 2026-11-03): completion
requires an explicit approval action by the account's recorded creator (the
"password teacher"), via POST /classrooms/{id}/students/{student_id}/
approve-claim (classroom_password.py) — the same classroom-scoped
authorization gate #3818 already uses for reset-password. This mirrors
Junyi's own model (a child account's creator — parent or teacher — controls
it, not an emailed link) and closes H1 completely: whoever merely knows the
current password can FILE a request, but nothing they do by themselves can
EVER complete it. Completion requires a second, independent party (the
specific teacher on record) to take an explicit action.

Everything this module does is therefore request-filing only:
- Verifies current_password, enforces new_password strength, checks
  new_email isn't already live or pending elsewhere.
- Sets the new password immediately (same as change-password) and reserves
  pending_email.
- Does NOT generate any verification token, does NOT touch `email` or
  created_by_teacher_id — both wait for classroom_password.py's
  approve_account_claim() / reject_account_claim().

Router (routes/auth.py) calls request_claim() and handles HTTP request/
response shaping + audit logging, matching the "thin HTTP boundary, business
logic in a service module" split already established for register/login/
password-reset.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..auth.password import hash_password, verify_password
from ..models.user import User
from ..services.auth_registration_service import enforce_password_strength

logger = logging.getLogger(__name__)

# #3833 — a forgotten claim must not squat its target email forever (a
# teacher who never approves/rejects would otherwise let `pending_email`
# block that address indefinitely for everyone else).
#
# There is no dedicated "pending_email filed at" column — adding one needs
# a migration, out of scope for this low-priority issue (the issue itself:
# "不急，排進一般待辦即可"). `updated_at` is reused instead: request_claim()
# below is exactly the write that sets BOTH the new password hash AND
# pending_email together, in the same transaction, so updated_at faithfully
# captures "when this claim was filed" at that moment.
#
# Known, accepted limitation: `updated_at` is whole-row, not column-scoped.
# If the account logs in again while the claim is still pending,
# last_login_at's own write (routes/auth.py) also bumps updated_at via
# SQLAlchemy's onupdate=func.now(), silently extending the apparent filing
# time. This can only ever make expiry MORE conservative (a still-active
# account's claim takes longer to be treated as stale), never less safe --
# it will not auto-expire a claim the account holder is actively using, but
# it will reliably free up an email that is both pending AND genuinely
# dormant, which is the actual complaint in #3833. A dedicated column would
# close this gap precisely; that is future work if it turns out to matter
# in practice.
PENDING_EMAIL_EXPIRY_DAYS = 14


def _is_pending_claim_stale(user: User) -> bool:
    """True if `user.pending_email` is set and old enough to be treated as
    forgotten. Never true for an account with no pending claim at all."""
    if user.pending_email is None:
        return False
    filed_at = user.updated_at
    if filed_at is None:
        return False
    if filed_at.tzinfo is None:
        filed_at = filed_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - filed_at > timedelta(days=PENDING_EMAIL_EXPIRY_DAYS)


def request_claim(
    db: Session,
    current_user: User,
    *,
    current_password: str,
    new_email: str,
    new_password: str,
) -> None:
    """File a request that the CALLER's own teacher-created account be
    claimed as a regular account. Does NOT clear created_by_teacher_id or
    write to `email` -- see module docstring for why (approval-gated, not
    self-service). Operates only on `current_user`; there is no student_id
    parameter, by design (see PRD "誰能做這件事").

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
    # deliberately NOT in that exemption list, so in the normal request path
    # this branch is unreachable. It stays here so a future accidental
    # re-exemption of this route still cannot skip this requirement.
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

    # AC4: reject if another account already holds this email live, OR
    # already has it reserved as ITS pending claim target. A genuine
    # simultaneous race on the same target email is still possible (two
    # requests both pass this SELECT before either commits); the
    # authoritative guard is the UNIQUE constraint on `users.email`, enforced
    # when a teacher actually APPROVES one of the two requests and writes to
    # it (see classroom_password.approve_account_claim(), which catches
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
        # #3833: a STALE pending claim (never approved or rejected) is
        # auto-expired here and does not block -- this is the only place
        # the conflict actually matters, so it is also the only place that
        # needs to know about expiry. A LIVE email (existing.email ==
        # new_email) never expires, no matter how old that row is -- expiry
        # only ever applies to a pending claim target.
        if existing.email != new_email and existing.pending_email == new_email and _is_pending_claim_stale(existing):
            existing.pending_email = None
            logger.info(
                "Account %d's pending claim on %r auto-expired (#3833, >%d days "
                "stale) to let account %d claim it instead",
                existing.id, new_email, PENDING_EMAIL_EXPIRY_DAYS, current_user.id,
            )
            db.commit()
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="此 Email 已被其他帳號使用或已被申請過戶",
            )

    current_user.password_hash = hash_password(new_password)
    current_user.pending_email = new_email
    if current_user.student_profile:
        # #3438: the student just set a password only they know -- same as
        # change-password, this must flip to True or get_current_user's
        # must-change-password gate would keep blocking every OTHER
        # endpoint for this account on its very next request. Note this is
        # independent of the approval mechanism above: the new PASSWORD
        # takes effect immediately (same as change-password always has),
        # only the new EMAIL + created_by_teacher_id wait for a teacher's
        # explicit approve-claim call.
        current_user.student_profile.password_changed = True

    db.commit()

    logger.info(
        "Account %d requested a claim (child-account handover, #3824, "
        "pending teacher approval)",
        current_user.id,
    )
