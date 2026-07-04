"""
sso_login_service.py — SSO login flow for #1844.

Extracted from routes/auth.py. Handles:
- Google Sign-In: token verification + user lookup/link/create
- Junyi SSO: code exchange + user lookup/link/create

Security properties preserved:
- Existing email users are linked without creating duplicates
- New SSO accounts receive unusable password hash (can't brute-force)
- Parent login feature-flag check (`_ensure_parent_login_allowed`) delegated to caller
  because it requires db access and is also used by normal login

Both flows return (user, is_new_user: bool).
"""

import logging
import secrets

import httpx
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..auth.password import hash_password
from ..config import settings
from ..models.user import User

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Google SSO
# ---------------------------------------------------------------------------


def verify_google_id_token(credential: str) -> dict:
    """Verify a Google id_token and return the decoded id_info dict.

    Raises:
        HTTPException 503: Google OAuth is not configured.
        HTTPException 401: Token is invalid.
    """
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured on this server.",
        )

    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests

        id_info = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            settings.google_client_id,
        )
        return id_info
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google credential: {exc}",
        )


def resolve_google_user(db: Session, id_info: dict) -> tuple[User, bool]:
    """Lookup or create a user for a verified Google id_info.

    Flow:
    1. Lookup by google_id (returning user) → no action needed.
    2. Lookup by email (link existing account) → set google_id.
    3. Create new account (email_verified=True, unusable password).

    Returns:
        (user, is_new_user)

    Raises:
        HTTPException 400: if Google account has no email.
    """
    google_sub: str = id_info["sub"]
    email: str = id_info.get("email", "")
    name: str = id_info.get("name", "") or (email.split("@")[0] if email else "")
    picture: str | None = id_info.get("picture")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account does not expose an email address.",
        )

    # (#2470 MED-3): only trust the email for account lookup/linking if Google has
    # verified it. Otherwise an attacker could add a victim's email (unverified) to
    # their Google account and link/hijack the existing password account.
    if not id_info.get("email_verified"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google email is not verified.",
        )

    is_new_user = False

    # 1. Returning user (matched by google_id)
    user = db.query(User).filter(
        User.google_id == google_sub, User.is_active == True
    ).first()

    if user is None:
        # 2. Existing account — link google_id
        user = db.query(User).filter(
            User.email == email, User.is_active == True
        ).first()
        if user is not None:
            user.google_id = google_sub
            if picture and not user.avatar_url:
                user.avatar_url = picture
        else:
            # 3. New account
            unusable_hash = hash_password(secrets.token_hex(32))
            user = User(
                email=email,
                password_hash=unusable_hash,
                name=name,
                avatar_url=picture,
                google_id=google_sub,
                email_verified=True,
            )
            db.add(user)
            is_new_user = True

    return user, is_new_user


# ---------------------------------------------------------------------------
# Junyi SSO
# ---------------------------------------------------------------------------


def exchange_junyi_code(code: str) -> dict:
    """Exchange a Junyi one-time auth code for user identity data.

    Returns the Junyi user dict: {"userId": ..., "userEmail": ..., "userDisplayName": ...}

    Raises:
        HTTPException 503: network error reaching Junyi backend.
        HTTPException 401: code expired, already used, or forged (Junyi returns 404).
        HTTPException 502: unexpected status from Junyi backend.
        HTTPException 502: malformed Junyi payload.
    """
    junyi_base = settings.junyi_sso_base_url.rstrip("/")
    exchange_url = f"{junyi_base}/api/v2/auth/code"

    try:
        # client_id="lingoleap" required after Junyi multi-RP migration (junyi#4083 / #4085).
        resp = httpx.post(
            exchange_url,
            json={"code": code, "client_id": "lingoleap"},
            timeout=10.0,
        )
    except httpx.RequestError as exc:
        logger.error("junyi_login: network error contacting Junyi SSO: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="無法連線到均一登入服務，請稍後再試。",
        )

    if resp.status_code == 404:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="均一登入連結已過期或已使用，請重新點擊「使用均一帳號登入」。",
        )
    if resp.status_code != 200:
        logger.error(
            "junyi_login: unexpected status %s from Junyi SSO (url=%s)",
            resp.status_code,
            exchange_url,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="均一登入服務回應異常，請稍後再試。",
        )

    try:
        payload = resp.json()
        data = payload["data"]
        return {
            "userId": str(data["userId"]),
            "userEmail": data.get("userEmail", ""),
            "userDisplayName": data.get("userDisplayName", ""),
        }
    except (KeyError, ValueError) as exc:
        logger.error("junyi_login: malformed Junyi payload: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="均一登入回傳資料格式異常。",
        )


def resolve_junyi_user(db: Session, junyi_data: dict) -> tuple[User, bool]:
    """Lookup or create a user for a verified Junyi identity.

    Flow:
    1. Lookup by junyi_identity_id (returning user).
    2. Lookup by email (link existing account) → set junyi_identity_id.
    3. Create new account (student, email_verified=True, unusable password).

    Returns:
        (user, is_new_user)

    Raises:
        HTTPException 400: Junyi provided no email and user doesn't exist.
    """
    junyi_user_id: str = junyi_data["userId"]
    junyi_email: str = junyi_data["userEmail"]
    junyi_display_name: str = junyi_data["userDisplayName"] or (
        junyi_email.split("@")[0] if junyi_email else ""
    )

    is_new_user = False

    # 1. Returning user (matched by junyi_identity_id)
    user = db.query(User).filter(
        User.junyi_identity_id == junyi_user_id,
        User.is_active == True,
    ).first()

    if user is None and junyi_email:
        # 2. Existing account — link junyi_identity_id
        user = db.query(User).filter(
            User.email == junyi_email,
            User.is_active == True,
        ).first()
        if user is not None:
            user.junyi_identity_id = junyi_user_id

    if user is None:
        # 3. New account
        if not junyi_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="均一帳號未提供 Email，無法建立 LingoLeap 帳號。",
            )
        unusable_hash = hash_password(secrets.token_hex(32))
        user = User(
            email=junyi_email,
            password_hash=unusable_hash,
            name=junyi_display_name,
            junyi_identity_id=junyi_user_id,
            email_verified=True,
        )
        db.add(user)
        is_new_user = True
    elif user.junyi_identity_id is None:
        user.junyi_identity_id = junyi_user_id

    return user, is_new_user
