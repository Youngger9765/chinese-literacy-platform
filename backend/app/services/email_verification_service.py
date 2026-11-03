"""
email_verification_service.py — Email verification flow for #1844.

Extracted from routes/auth.py. Handles:
- Token lookup and validation
- Idempotent verification (already-verified returns success message)
- Token clearing after successful verification
- Resend verification token generation

Used by both GET and POST /auth/verify-email endpoints.
"""

import logging
import secrets

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..config import settings
from ..models.user import User

logger = logging.getLogger(__name__)

EMAIL_VERIFICATION_TOKEN_BYTES = 32


def verify_email_by_token(db: Session, token: str) -> str:
    """Verify a user's email by token. Idempotent — already-verified is OK.

    Raises:
        HTTPException 400: if token does not match any active user.

    Returns:
        A confirmation message string (for VerifyEmailResponse.message).
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

    if user.email_verified:
        return "電子郵件已驗證。"

    user.email_verified = True
    user.email_verification_token = None
    db.commit()

    return "電子郵件驗證成功！現在可以登入了。"


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
