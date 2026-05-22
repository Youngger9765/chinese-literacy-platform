import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload, selectinload

from ..auth.classroom_check import compute_has_classroom
from ..auth.dependencies import get_current_user, get_user_org_ids, require_role
from ..auth.policies import is_admin
from ..config import settings
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


class UpdateMeRequest(BaseModel):
    """Request body for PATCH /users/me.

    All fields are optional — only provided fields are updated.
    Sensitive fields (email, password, roles) are intentionally excluded.
    """

    name: Optional[str] = Field(None, max_length=100)
    avatar_url: Optional[str] = Field(None, max_length=500)
    phone: Optional[str] = Field(None, max_length=20)


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
    """Get current authenticated user with their roles.

    Also includes issue #457 fields:
    - has_classroom: True unless user is a student with no classroom enrollment.
    - teacher_gating_enforced: mirrors the ENFORCE_TEACHER_GATING env var so the
      frontend knows whether to enforce the classroom gate.
    """
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

    has_classroom = compute_has_classroom(db, current_user.id)

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
        has_classroom=has_classroom,
        teacher_gating_enforced=settings.enforce_teacher_gating,
    )


@router.patch("/users/me", response_model=UserResponse)
def update_me(
    payload: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the current authenticated user's profile.

    Only name, avatar_url, and phone may be changed here.
    Sensitive fields (email, password, roles) require dedicated flows.
    Returns the updated user with their roles.
    """
    updated = False

    if payload.name is not None:
        current_user.name = payload.name
        updated = True

    if payload.avatar_url is not None:
        current_user.avatar_url = payload.avatar_url
        updated = True

    if payload.phone is not None:
        current_user.phone = payload.phone
        updated = True

    if updated:
        db.add(current_user)
        db.commit()
        db.refresh(current_user)
        logger.info("User %d updated profile fields: %s", current_user.id, list(payload.model_fields_set))

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
    """List users with pagination and optional search.

    system_admin sees all users on the platform.
    org_admin sees only users whose org-scoped UserRole matches
    the caller's own org scope(s) — enforcing 個資法 §20.
    """
    query = db.query(User)

    # Scope restriction: org_admin may only see users within their org(s).
    # system_admin (get_user_org_ids returns None) skips this filter.
    if not is_admin(current_user.id, db):
        caller_org_ids = get_user_org_ids(current_user)  # list[str], never None here
        if not caller_org_ids:
            # org_admin with no org scope → see nothing
            return UserListResponse(items=[], total=0)
        # Keep only users who have at least one active org-scoped role
        # matching one of the caller's orgs.
        query = query.filter(
            User.id.in_(
                db.query(UserRole.user_id)
                .filter(
                    UserRole.is_active == True,
                    UserRole.scope_type == "organization",
                    UserRole.scope_id.in_(caller_org_ids),
                )
            )
        )

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
    """Get full user detail by ID.

    system_admin may read any user.
    org_admin may only read users who belong to the same org scope —
    enforcing 個資法 §20 (cross-org reads → 403).
    """
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

    # Scope check for org_admin: target user must share at least one org with caller.
    if not is_admin(current_user.id, db):
        caller_org_ids = set(get_user_org_ids(current_user) or [])
        target_org_ids = {
            ur.scope_id
            for ur in user.user_roles
            if ur.is_active and ur.scope_type == "organization" and ur.scope_id
        }
        if not (caller_org_ids & target_org_ids):
            raise HTTPException(
                status_code=403,
                detail="Not authorized to view this user",
            )

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
