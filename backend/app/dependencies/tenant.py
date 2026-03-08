"""
Tenant-aware FastAPI dependencies for multi-tenant authorization.

These reusable Depends() functions enforce organization-level data isolation.
They follow a consistent pattern:

    - system_admin bypasses ALL tenant checks
    - org_owner / org_admin have elevated access within their org
    - teacher access is limited to their own resources
    - cross-org access is always denied with HTTP 403

Usage:
    from app.dependencies.tenant import require_org_member, require_classroom_access

    @router.get("/organizations/{org_id}/data")
    def get_org_data(
        org_id: str,
        _: None = Depends(require_org_member("org_id")),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ):
        ...

Note: The low-level helper functions (_check_*) are pure functions that take
explicit arguments, making them easy to unit-test without setting up HTTP
infrastructure. The public Depends() factories call these helpers.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.school import Classroom, School
from ..models.user import User

logger = logging.getLogger(__name__)

# Roles that have elevated admin rights at the organization level
_ORG_ADMIN_ROLES = frozenset({"org_owner", "org_admin"})

# Roles that bypass all tenant checks
_SUPER_ADMIN_ROLES = frozenset({"system_admin"})


# ── Pure helper functions (testable without HTTP) ────────────────────────────


def is_system_admin(user: User) -> bool:
    """Return True if the user has an active system_admin role.

    Args:
        user: Authenticated User ORM object.

    Returns:
        True if user has an active system_admin UserRole, False otherwise.
    """
    return any(
        ur.is_active and ur.role and ur.role.name in _SUPER_ADMIN_ROLES
        for ur in user.user_roles
    )


def _check_org_member(user: User, org_id: str, db: Session) -> None:
    """Verify the user belongs to the given organization.

    system_admin bypasses this check. All other users must have an active
    UserRole with scope_type='organization' and scope_id matching org_id.

    Args:
        user: The current authenticated user.
        org_id: The organization ID to check membership for.
        db: SQLAlchemy Session (not used currently, reserved for future
            DB-level checks).

    Raises:
        HTTPException 403: If the user is not a member of the org.
    """
    if is_system_admin(user):
        return

    for ur in user.user_roles:
        if (
            ur.is_active
            and ur.scope_type == "organization"
            and ur.scope_id == org_id
        ):
            return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Not a member of this organization",
    )


def _check_org_admin(user: User, org_id: str, db: Session) -> None:
    """Verify the user has org-admin level access for the given organization.

    Allowed roles: system_admin (global), org_owner, org_admin (scoped to org).

    Args:
        user: The current authenticated user.
        org_id: The organization ID to check admin access for.
        db: SQLAlchemy Session (reserved for future DB-level checks).

    Raises:
        HTTPException 403: If user lacks org-admin level access.
    """
    if is_system_admin(user):
        return

    for ur in user.user_roles:
        if (
            ur.is_active
            and ur.scope_type == "organization"
            and ur.scope_id == org_id
            and ur.role
            and ur.role.name in _ORG_ADMIN_ROLES
        ):
            return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Requires org admin permission",
    )


def _check_classroom_access(user: User, classroom_id: int, db: Session) -> Classroom:
    """Verify the user can access the given classroom.

    Access is granted if any of the following is true:
    - User is system_admin
    - User is the classroom's teacher (teacher_id == user.id)
    - User is org_admin/org_owner AND the classroom's school belongs
      to the same org as the user

    Args:
        user: The current authenticated user.
        classroom_id: The classroom ID to check access for.
        db: SQLAlchemy Session for fetching classroom/school.

    Returns:
        The Classroom ORM object if access is granted.

    Raises:
        HTTPException 404: If classroom does not exist.
        HTTPException 403: If user lacks access to this classroom.
    """
    classroom = (
        db.query(Classroom)
        .filter(Classroom.id == classroom_id)
        .first()
    )
    if classroom is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found")

    # system_admin bypasses all checks
    if is_system_admin(user):
        return classroom

    # Classroom owner always has access
    if classroom.teacher_id == user.id:
        return classroom

    # org_admin/org_owner can access classrooms in their org
    user_org_admin_ids = {
        ur.scope_id
        for ur in user.user_roles
        if (
            ur.is_active
            and ur.scope_type == "organization"
            and ur.role
            and ur.role.name in _ORG_ADMIN_ROLES
        )
    }

    if user_org_admin_ids:
        # Fetch the school to check its organization
        school = db.query(School).filter(School.id == classroom.school_id).first()
        if school and school.organization_id in user_org_admin_ids:
            return classroom

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Not authorized to access this classroom",
    )


def get_tenant_filter(model: Any, user: User) -> Any | None:
    """Return a SQLAlchemy filter expression for tenant isolation.

    Produces a WHERE clause restricting queries to the user's organization.
    Designed for use with Organization model queries.

    Args:
        model: SQLAlchemy ORM model class (expected to have an 'id' column
               for Organization, or 'organization_id' for child models).
        user: The current authenticated user.

    Returns:
        None if user is system_admin (no filter = sees all).
        A SQLAlchemy filter expression restricting to user's orgs otherwise.
        If user has no org, returns a false condition (empty result set).
    """
    if is_system_admin(user):
        return None

    # Collect all org IDs the user is scoped to
    org_ids = [
        ur.scope_id
        for ur in user.user_roles
        if ur.is_active and ur.scope_type == "organization" and ur.scope_id
    ]

    # Determine which column to filter on based on the model
    from ..models.organization import Organization

    if model is Organization:
        if not org_ids:
            # No org access — return always-false filter
            return Organization.id.in_([])
        return Organization.id.in_(org_ids)

    # For other models with organization_id foreign key
    if hasattr(model, "organization_id"):
        if not org_ids:
            return model.organization_id.in_([])
        return model.organization_id.in_(org_ids)

    # Fallback: no filter (caller must handle)
    logger.warning(
        "get_tenant_filter: model %s has no 'id' or 'organization_id' column; "
        "returning None (no filter applied).",
        model.__name__ if hasattr(model, "__name__") else model,
    )
    return None


# ── FastAPI Depends() factories ───────────────────────────────────────────────


def require_org_member(org_id_param: str = "org_id"):
    """FastAPI dependency factory: require user to be an org member.

    Args:
        org_id_param: Name of the path parameter containing the org ID.
                      Defaults to 'org_id'.

    Returns:
        A FastAPI Depends()-compatible async function.

    Example:
        @router.get("/organizations/{org_id}/data")
        def get_data(
            org_id: str,
            _=Depends(require_org_member()),
            current_user=Depends(get_current_user),
            db=Depends(get_db),
        ):
            ...
    """
    async def _dependency(
        org_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> None:
        _check_org_member(current_user, org_id, db)

    return Depends(_dependency)


def require_org_admin(org_id_param: str = "org_id"):
    """FastAPI dependency factory: require user to have org-admin access.

    Args:
        org_id_param: Name of the path parameter (for documentation).

    Returns:
        A FastAPI Depends()-compatible async function.
    """
    async def _dependency(
        org_id: str,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> None:
        _check_org_admin(current_user, org_id, db)

    return Depends(_dependency)


def require_classroom_access(classroom_id_param: str = "classroom_id"):
    """FastAPI dependency factory: require user to have classroom access.

    Injects the verified Classroom object into the route if access is granted.

    Args:
        classroom_id_param: Name of the path parameter (for documentation).

    Returns:
        A FastAPI Depends()-compatible async function that returns the Classroom.
    """
    async def _dependency(
        classroom_id: int,
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> Classroom:
        return _check_classroom_access(current_user, classroom_id, db)

    return Depends(_dependency)
