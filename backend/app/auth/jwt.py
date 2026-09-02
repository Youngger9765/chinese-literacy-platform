from datetime import datetime, timedelta, timezone

import jwt

from ..config import settings

# Issue #3027: a "preview as student" token is a scoped, short-lived read-only
# loan of a student's own identity to a teacher — not a login. Kept short so a
# forgotten/leaked preview link stops working on its own quickly.
PREVIEW_TOKEN_EXPIRE_MINUTES = 20


def create_access_token(user_id: int) -> str:
    """Create a JWT access token for the given user ID."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user_id),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_preview_access_token(student_id: int, teacher_id: int) -> str:
    """Create a short-lived, read-only "preview as student" token (Issue #3027).

    `sub` is set to the STUDENT's id (not the teacher's) so every existing
    read route that resolves `current_user` from `sub` — e.g.
    GET /learning/recommendations/{student_id} — keeps working completely
    unmodified when a teacher previews. The `preview` / `preview_by` claims
    are what PreviewModeWriteGuardMiddleware (app/main.py) checks to block
    every non-GET/HEAD/OPTIONS request carrying this token, regardless of
    which endpoint it targets — see
    docs/prd/2026-09-hans-feedback-teacher-visibility.md §1.2/§1.3 for why a
    single middleware-level block was chosen over patching each of the ~26
    write endpoints individually.
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=PREVIEW_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(student_id),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "preview": True,
        "preview_by": teacher_id,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token. Returns payload dict.

    Raises jwt.ExpiredSignatureError if expired.
    Raises jwt.InvalidTokenError for other errors.
    """
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
