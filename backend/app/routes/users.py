import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload, selectinload

from ..auth.classroom_check import compute_has_classroom
from ..auth.password_policy import compute_must_change_password
from ..auth.dependencies import get_current_user, require_role
from ..config import settings
from ..database import get_db
from ..models.user import User, UserRole, Role
from ..schemas.user import (
    ActivateTeacherRequest,
    ActivateTeacherResponse,
    ActivateTeacherSchoolInput,
    SchoolActivationBrief,
    UserResponse,
    UserRoleResponse,
)
from ..schemas.user_admin import (
    UserDetailResponse,
    UserListItem,
    UserListResponse,
    UserRoleItem,
)
from ..services.auth_registration_service import activate_teacher_for_schools

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
        must_change_password=compute_must_change_password(current_user),
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


# ── Self-serve teacher activation (#3804) ───────────────────────────────────


@router.post("/users/me/activate-teacher", response_model=ActivateTeacherResponse)
def activate_teacher(
    payload: ActivateTeacherRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Self-serve: any logged-in account can become a teacher by naming the
    school(s) they teach at. No approval, no domain guessing (#3804, Young
    2026-11-01). Does not remove or affect the student role granted at
    registration — the account simply gains a teacher role on top of it, and
    the frontend's existing WorkspaceContext role switcher picks this up
    automatically once there are 2+ roles.

    Idempotent: naming a school the caller is already a teacher of again is a
    no-op for that school (still returns it, with is_new=False).
    """
    # #3812: merge the two request shapes into one list before resolving —
    # a bare `school_names` entry is equivalent to {"name": ...} (the
    # manual/legacy path), never a directory code. See schemas/user.py
    # ActivateTeacherRequest docstring for why both fields exist.
    schools_input = list(payload.schools) + [
        ActivateTeacherSchoolInput(name=name) for name in payload.school_names
    ]
    schools_with_flag = activate_teacher_for_schools(db, current_user, schools_input)
    db.commit()

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

    return ActivateTeacherResponse(
        schools=[
            SchoolActivationBrief(
                id=school.id,
                name=school.name,
                is_new=is_new,
                # The real, authoritative state -- computed inside
                # activate_teacher_for_schools, which knows whether this
                # was a new grant, an idempotent re-call on an already-
                # active row, or a still-pending one. NOT re-derived here
                # from is_new alone (that under-reports an already-active
                # role on a repeat call -- caught by this project's own
                # regression test, test_an_existing_active_role_at_a_
                # pre_existing_school_is_never_downgraded).
                role_active=role_active,
            )
            for school, is_new, role_active in schools_with_flag
        ],
        roles=roles,
    )


# ── Admin user management endpoints ─────────────────────────────────────────


@router.get("/users", response_model=UserListResponse)
def list_users(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: str | None = Query(None),
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """List users with pagination and optional search.

    (#3804) system_admin-only. org_admin's "see users within my org(s)" scope
    is retired along with the org tenancy tier — there is no longer an
    admin tier between "my own classroom's students" and system_admin.
    """
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
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Get full user detail by ID.

    (#3804) system_admin-only. org_admin's "same org scope" cross-tenant
    read is retired along with the org tenancy tier.
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
