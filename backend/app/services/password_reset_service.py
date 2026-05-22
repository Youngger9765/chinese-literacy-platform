"""
password_reset_service.py — Password reset flow for #1844.

Extracted from routes/auth.py. Handles:
- Forgot password: token generation without user enumeration
- Reset password: token validation, expiry check, token invalidation after use
- Password strength enforcement (delegated to auth_registration_service)

Security properties preserved:
- Unknown identifier always returns HTTP 200 (no enumeration)
- Token is cleared from DB after successful reset (one-time use)
- Expired tokens are rejected with 400 (not 401, to avoid timing oracle)
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..auth.password import hash_password
from ..config import settings
from ..models.user import User

logger = logging.getLogger(__name__)

PASSWORD_RESET_TOKEN_BYTES = 32
PASSWORD_RESET_EXPIRY_HOURS = 1


def lookup_user_by_identifier(db: Session, identifier: str) -> User | None:
    """Lookup user by email or username (username has no '@').

    Returns the user if found and active, None otherwise.
    Never raises — caller must handle the None case without leaking existence.
    """
    if "@" in identifier:
        return db.query(User).filter(
            User.email == identifier, User.is_active == True
        ).first()
    return db.query(User).filter(
        User.username == identifier, User.is_active == True
    ).first()


def generate_password_reset_token(db: Session, user: User) -> str:
    """Generate a password reset token, store it on the user, and commit.

    Returns the plain token (caller decides whether to surface it).
    """
    reset_token = secrets.token_hex(PASSWORD_RESET_TOKEN_BYTES)
    user.password_reset_token = reset_token
    user.password_reset_expires = datetime.now(timezone.utc) + timedelta(
        hours=PASSWORD_RESET_EXPIRY_HOURS
    )
    db.commit()
    return reset_token


def validate_reset_token(db: Session, token: str) -> User:
    """Find user by reset token and validate it is not expired.

    Raises:
        HTTPException 400: if token is invalid or expired.

    Returns:
        The user whose reset token matched and is still valid.
    """
    user = (
        db.query(User)
        .filter(User.password_reset_token == token, User.is_active == True)
        .first()
    )

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="無效的重設 token，請重新申請密碼重設。",
        )

    now = datetime.now(timezone.utc)
    expires = user.password_reset_expires
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    if expires is None or now > expires:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="重設 token 已過期，請重新申請密碼重設。",
        )

    return user


def apply_password_reset(db: Session, user: User, new_password: str) -> None:
    """Hash new_password, clear the reset token, and commit.

    Caller must have already called validate_reset_token and
    enforce_password_strength before calling this function.
    """
    user.password_hash = hash_password(new_password)
    user.password_reset_token = None
    user.password_reset_expires = None
    db.commit()
