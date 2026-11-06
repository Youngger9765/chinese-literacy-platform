from datetime import datetime, timedelta, timezone

import jwt

from ..config import settings

# Issue #3027: a "preview as student" token is a scoped, short-lived read-only
# loan of a student's own identity to a teacher — not a login. Kept short so a
# forgotten/leaked preview link stops working on its own quickly.
PREVIEW_TOKEN_EXPIRE_MINUTES = 20


def create_access_token(
    user_id: int, *, password_change_floor: datetime | None = None
) -> str:
    """Create a JWT access token for the given user ID.

    `password_change_floor`, when set, marks this token as provably valid
    against a specific `password_changed_at` value -- either because this
    call JUST wrote it (routes/auth.py's change_password, reissuing a
    replacement token in its own response) or because minting this token
    required proving the account's CURRENT credential right now (login,
    google_login, junyi_login all pass `user.password_changed_at`: a
    token they mint cannot possibly predate it). It is carried as an
    explicit `pwc_floor` claim, NOT encoded via `iat` -- two things rule
    `iat` out:

    1. `iat` is whole-second resolution (the JWT spec, not a choice made
       here), so a token minted mere milliseconds after a
       password_changed_at write can still land in the SAME floored
       second, which auth/dependencies.py's get_current_user treats as
       ambiguous and rejects, fail-closed.
    2. The obvious workaround -- mint this token with `iat` pushed past
       that second -- does not work: PyJWT's decode() independently
       rejects a token whose `iat` is in the future
       (`ImmatureSignatureError: The token is not yet valid (iat)`),
       confirmed empirically here. There is no way to out-run that check
       by picking a "bigger" `iat`.

    `pwc_floor` sidesteps both: get_current_user treats a token as valid
    against password_changed_at if `pwc_floor >= password_changed_at`
    (regardless of its real `iat`), which only exempts it from THIS
    specific change -- a later, different password change still
    invalidates it through the normal `iat` comparison, because by then
    `pwc_floor` is older than the new password_changed_at.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user_id),
        "exp": expire,
        "iat": now,
    }
    if password_change_floor is not None:
        floor = password_change_floor
        # Normalize here, not at each call site: a value read back from
        # SQLAlchemy after a commit/refresh round trip through SQLite
        # comes back naive (tzinfo stripped) even though it was always
        # written as UTC (see auth/dependencies.py's own comment on this
        # same SQLite behavior) -- and `datetime.timestamp()` on a naive
        # value is interpreted as LOCAL time, not UTC. Confirmed this
        # shifted the claim by exactly the local UTC offset (8h on this
        # machine) when a caller passed the post-commit attribute
        # directly instead of a value it had kept tz-aware itself.
        if floor.tzinfo is None:
            floor = floor.replace(tzinfo=timezone.utc)
        payload["pwc_floor"] = int(floor.timestamp())
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
