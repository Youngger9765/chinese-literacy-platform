"""
email_verification_service.py — Email verification flow for #1844.

Extracted from routes/auth.py. Handles:
- Token lookup and validation
- Idempotent verification (already-verified returns success message)
- Token clearing after successful verification
- Resend verification token generation
- #3824 phase 2: completing a pending child-account-handover claim when its
  verification token is the one being redeemed (see account_claim_service.py
  for phase 1 and the full two-phase rationale)

Used by both GET and POST /auth/verify-email endpoints.
"""

import logging
import secrets
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..models.user import User

logger = logging.getLogger(__name__)

EMAIL_VERIFICATION_TOKEN_BYTES = 32


@dataclass
class EmailVerificationResult:
    """Return shape for verify_email_by_token.

    claim_completed and the three fields after it are only populated when
    this verification redeemed a #3824 pending-claim token (i.e. the user
    had `pending_email` set) -- routes/auth.py uses them to emit the
    CLAIM_ACCOUNT_COMPLETED audit entry. Ordinary (non-claim) email
    verification leaves them at their defaults.
    """

    message: str
    claim_completed: bool = False
    claimed_user_id: int | None = None
    previous_teacher_id: int | None = None
    final_email: str | None = None


def verify_email_by_token(db: Session, token: str) -> EmailVerificationResult:
    """Verify a user's email by token. Idempotent — already-verified is OK.

    If this token belongs to a pending #3824 account claim (`pending_email`
    is set), redeeming it does double duty: it both verifies the email AND
    completes the handover — writing `pending_email` into the live `email`
    column and clearing `created_by_teacher_id` (the original creator's
    reset-password authority ends here, not at the phase-1 request — see
    account_claim_service.py's module docstring).

    Raises:
        HTTPException 400: if token does not match any active user.
        HTTPException 409: the pending email collided with another account
            that grabbed the same address between phase 1's check and this
            redemption (security review finding L2 — a genuine race, not
            the common case phase 1 already rejects).

    Returns:
        An EmailVerificationResult (message for VerifyEmailResponse.message,
        plus claim-completion detail for audit logging).
    """
    user = (
        db.query(User)
        .filter(User.email_verification_token == token, User.is_active == True)
        .first()
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的驗證 token。",
        )

    if user.email_verified and user.pending_email is None:
        return EmailVerificationResult(message="電子郵件已驗證。")

    pending_email = user.pending_email
    if pending_email is not None:
        previous_teacher_id = user.created_by_teacher_id
        user.email = pending_email
        user.pending_email = None
        # #3824 H1 fix: THIS is the one moment created_by_teacher_id clears —
        # not phase 1 (request_claim). Everything up to here was reversible
        # (the original creator could still reset the password, which also
        # clears a pending claim — see classroom_password.py); redeeming this
        # token, which only the real mailbox owner can do, is the proof of
        # ownership that makes the handover final.
        user.created_by_teacher_id = None

    user.email_verified = True
    user.email_verification_token = None

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="此 Email 已被其他帳號搶先使用，過戶失敗，請重新申請",
        )

    if pending_email is not None:
        logger.info(
            "Account %d completed a claim (child-account handover, #3824): "
            "previous creator %s -> cleared",
            user.id, previous_teacher_id,
        )
        return EmailVerificationResult(
            message="帳號過戶成功！請使用新的 Email 與密碼登入。",
            claim_completed=True,
            claimed_user_id=user.id,
            previous_teacher_id=previous_teacher_id,
            final_email=pending_email,
        )

    return EmailVerificationResult(message="電子郵件驗證成功！現在可以登入了。")


def resend_verification_token(db: Session, email: str) -> tuple[str, str | None]:
    """Generate a new verification token for the given email.

    Does NOT raise if email is unknown or already verified — returns a
    generic message to prevent email enumeration.

    Returns:
        (message, token_or_none) where token is the new token only when
        settings.is_dev=True and the user exists + is unverified.
    """
    user = db.query(User).filter(User.email == email, User.is_active == True).first()

    if user is None or user.email_verified:
        return (
            "若帳號存在且尚未驗證，驗證信已重新發送。",
            None,
        )

    new_token = secrets.token_hex(EMAIL_VERIFICATION_TOKEN_BYTES)
    user.email_verification_token = new_token
    db.commit()

    return (
        "驗證信已重新發送。（測試模式下 token 直接回傳）",
        new_token if settings.is_dev else None,
    )
