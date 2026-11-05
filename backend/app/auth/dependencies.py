from datetime import timezone

from fastapi import Depends, HTTPException, Header, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models.user import User, UserRole, Role
from .jwt import decode_token
from .password_policy import compute_must_change_password

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

# #3438: endpoints a student with a pending forced password change may still
# reach -- GET /users/me (so the frontend can render gate state) and the
# change-password endpoint itself (the only escape hatch). Everything else
# behind get_current_user is blocked with 403 while this is true.
#
# #3824 security review finding H1: claim-account (child-account handover)
# was ADDED here in an earlier version of this change and then REMOVED —
# do not re-add it. Letting an account whose teacher-issued password has
# never been changed go straight to claiming (new email + new password +
# eventually stripping the original creator's recovery authority) in one
# shot was exactly the amplifier that turned "someone read the printed
# credential card" into "permanent, instant account theft, unrecoverable
# even by the teacher". Forcing change-password first costs the real owner
# nothing (it is one extra, already-required step) and forces a would-be
# claimant to prove they can authenticate normally before anything
# irreversible-adjacent becomes reachable. account_claim_service.
# request_claim() also checks student_profile.password_changed itself
# (defense-in-depth, same two-independent-gates pattern #3818 used), but
# that check existing is not a reason to re-add this exemption.
_PASSWORD_CHANGE_EXEMPT: set[tuple[str, str]] = {
    ("POST", "/api/auth/change-password"),
    ("GET", "/api/users/me"),
}


def get_optional_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User | None:
    """Return the authenticated user, or None if no/invalid token is provided.

    Unlike get_current_user, this dependency never raises 401 — it simply
    returns None when the request is anonymous or the token is invalid.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        token = authorization.split(" ", 1)[1]
        payload = decode_token(token)
        user_id = int(payload["sub"])
        user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
        return user
    except Exception:
        return None


def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Extract and validate the current user from JWT token."""
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(token)
        user_id = int(payload["sub"])
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = (
        db.query(User)
        .options(joinedload(User.student_profile))
        .filter(User.id == user_id, User.is_active == True)
        .first()
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Claude Security find_016vZk1d3wRKkhjQMTUbGU6Y (low, CWE-613): a
    # stolen token used to keep working for its full (up to 8h) lifetime
    # even after the victim changed their password or a teacher reset it --
    # nothing here ever compared the token against the account's
    # credential history. password_changed_at is NULL for an account that
    # has never had a recorded password change, so this is a pure
    # tightening: every token issued before this feature existed, or for
    # an account whose password has never changed, is completely
    # unaffected. `iat` is encoded as a Unix timestamp by PyJWT regardless
    # of the datetime passed into create_access_token.
    if user.password_changed_at is not None:
        token_iat = payload.get("iat")
        if token_iat is not None:
            # SQLite (used by the test suite) silently drops tz info on a
            # DateTime(timezone=True) column regardless of what was
            # written -- Postgres (prod/staging) does not have this
            # problem, but the comparison must be robust either way: this
            # column is only ever written via datetime.now(timezone.utc),
            # so a naive value read back is always UTC.
            password_changed_at = user.password_changed_at
            if password_changed_at.tzinfo is None:
                password_changed_at = password_changed_at.replace(tzinfo=timezone.utc)
            # Compare at whole-second granularity on BOTH sides. PyJWT
            # encodes `iat` as an integer Unix timestamp (microseconds
            # truncated), while password_changed_at keeps full DB
            # precision -- comparing at mismatched precision made the
            # result depend on which side's sub-second remainder happened
            # to be larger, flipping unpredictably for two events in the
            # same wall-clock second (e.g. "change password, then
            # immediately log in again"). `<=` (not `<`): a token from
            # the SAME second as the change is rejected, fail-closed --
            # the realistic cost is "log in once more", the alternative
            # (`<`) could fail-open and accept a same-second STALE token
            # too, which is the actual security property this exists for.
            if token_iat <= int(password_changed_at.timestamp()):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token invalid: password has changed since this token was issued",
                    headers={"WWW-Authenticate": "Bearer"},
                )

    if compute_must_change_password(user):
        if (request.method, request.url.path) not in _PASSWORD_CHANGE_EXEMPT:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="PASSWORD_CHANGE_REQUIRED",
            )

    return user


def get_user_org_ids(user: User) -> list[str] | None:
    """Return list of org IDs the user is scoped to, or None if system_admin (sees all)."""
    for ur in user.user_roles:
        if ur.is_active and ur.role and ur.role.name == "system_admin":
            return None  # system_admin sees everything
    org_ids = []
    for ur in user.user_roles:
        if ur.is_active and ur.scope_type == "organization" and ur.scope_id:
            org_ids.append(ur.scope_id)
    return org_ids if org_ids else []


def require_role(*role_names: str, scope_type: str | None = None, scope_id: str | None = None):
    """Dependency factory that checks if current user has any of the specified roles.

    Usage:
        @router.get("/admin", dependencies=[Depends(require_role("system_admin"))])
        def admin_endpoint(): ...

        @router.get("/school/{school_id}/manage",
                     dependencies=[Depends(require_role("principal", "director", scope_type="school"))])
        def manage_school(school_id: int): ...
    """
    def _check_role(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        query = (
            db.query(UserRole)
            .join(Role, UserRole.role_id == Role.id)
            .filter(
                UserRole.user_id == current_user.id,
                UserRole.is_active == True,
                Role.name.in_(role_names),
            )
        )
        if scope_type:
            query = query.filter(UserRole.scope_type == scope_type)
        if scope_id:
            query = query.filter(UserRole.scope_id == scope_id)

        if not query.first():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return Depends(_check_role)
