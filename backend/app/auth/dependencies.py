from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole, Role
from .jwt import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


async def get_current_user(
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

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
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
    async def _check_role(
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
