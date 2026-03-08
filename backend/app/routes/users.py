import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, selectinload

from ..auth.dependencies import get_current_user, require_role
from ..database import get_db
from ..models.user import User, UserRole, Role
from ..schemas.user import UserResponse, UserRoleResponse
from ..schemas.user_admin import (
    UserDetailResponse,
    UserListItem,
    UserListResponse,
    UserRoleItem,
)

router = APIRouter(tags=["users"])
logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _build_role_items(user: User) -> list[UserRoleItem]:
    """Build UserRoleItem list from eagerly-loaded user_roles relationship."""
    return [
        UserRoleItem(
            role_name=ur.role.name,
            scope_type=ur.scope_type,
            scope_id=ur.scope_id,
        )
        for ur in user.user_roles
        if ur.is_active
    ]


# ── Current user endpoint ────────────────────────────────────────────────────


@router.get("/users/me", response_model=UserResponse)
def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get current authenticated user with their roles."""
    user_roles = (
        db.query(UserRole, Role)
        .join(Role, UserRole.role_id == Role.id)
        .filter(UserRole.user_id == current_user.id, UserRole.is_active == True)
        .all()
    )

    roles = [
        UserRoleResponse(
            role_name=role.name,
            role_display_name=role.display_name,
            scope_type=ur.scope_type,
            scope_id=ur.scope_id,
        )
        for ur, role in user_roles
    ]

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        phone=current_user.phone,
        avatar_url=current_user.avatar_url,
        is_active=current_user.is_active,
        email_verified=current_user.email_verified,
        onboarding_completed=current_user.onboarding_completed,
        last_login_at=current_user.last_login_at,
        terms_accepted_at=current_user.terms_accepted_at,
        terms_version=current_user.terms_version,
        created_at=current_user.created_at,
        roles=roles,
    )


# ── Admin user management endpoints ─────────────────────────────────────────


@router.get("/users", response_model=UserListResponse)
def list_users(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None),
    current_user: User = require_role("system_admin", "org_admin"),
    db: Session = Depends(get_db),
):
    """List all users with pagination and optional search. Admin only."""
    query = db.query(User)

    if search:
        pattern = f"%{search}%"
        query = query.filter(
            User.name.ilike(pattern) | User.email.ilike(pattern)
        )

    total = query.count()

    users = (
        query.options(
            selectinload(User.user_roles).joinedload(UserRole.role)
        )
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    items = [
        UserListItem(
            id=u.id,
            email=u.email,
            name=u.name,
            is_active=u.is_active,
            created_at=u.created_at,
            roles=_build_role_items(u),
        )
        for u in users
    ]

    return UserListResponse(items=items, total=total)


@router.get("/users/{user_id}", response_model=UserDetailResponse)
def get_user_detail(
    user_id: int,
    current_user: User = require_role("system_admin", "org_admin"),
    db: Session = Depends(get_db),
):
    """Get full user detail by ID. Admin only."""
    user = (
        db.query(User)
        .options(
            joinedload(User.user_roles).joinedload(UserRole.role)
        )
        .filter(User.id == user_id)
        .first()
    )
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return UserDetailResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        phone=user.phone,
        avatar_url=user.avatar_url,
        is_active=user.is_active,
        email_verified=user.email_verified,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        roles=_build_role_items(user),
    )
