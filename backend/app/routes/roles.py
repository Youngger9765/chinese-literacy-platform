import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, require_role
from ..auth.policies import is_system_admin, resolve_user_org_ids
from ..database import get_db
from ..models.user import Role, User, UserRole
from ..schemas.role import (
    RoleResponse,
    UserRoleAssignRequest,
    UserRoleDetailResponse,
)

router = APIRouter(tags=["roles"])
logger = logging.getLogger(__name__)


# -- Helpers ------------------------------------------------------------------


def _user_role_to_response(ur: UserRole, role: Role) -> UserRoleDetailResponse:
    """Convert a UserRole + Role pair to a UserRoleDetailResponse."""
    return UserRoleDetailResponse(
        id=ur.id,
        user_id=ur.user_id,
        role_id=ur.role_id,
        role_name=role.name,
        role_display_name=role.display_name,
        scope_type=ur.scope_type,
        scope_id=ur.scope_id,
        is_active=ur.is_active,
        created_at=ur.created_at,
    )


# -- Role Endpoints -----------------------------------------------------------


@router.get("/roles", response_model=list[RoleResponse])
def list_roles(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all available roles."""
    roles = db.query(Role).filter(Role.is_active == True).order_by(Role.id).all()
    return [
        RoleResponse(
            id=r.id,
            name=r.name,
            display_name=r.display_name,
            scope_level=r.scope_level,
        )
        for r in roles
    ]


@router.post("/roles/assign", status_code=201, response_model=UserRoleDetailResponse)
def assign_role(
    payload: UserRoleAssignRequest,
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Assign a role to a user."""
    # Verify target user exists
    target_user = db.query(User).filter(User.id == payload.user_id).first()
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    # Verify role exists
    role = db.query(Role).filter(Role.name == payload.role_name, Role.is_active == True).first()
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")

    # Validate scope_type
    valid_scope_types = ("platform", "organization", "school")
    if payload.scope_type not in valid_scope_types:
        raise HTTPException(
            status_code=422,
            detail=f"scope_type must be one of: {', '.join(valid_scope_types)}",
        )

    # Check for duplicate assignment
    existing = (
        db.query(UserRole)
        .filter(
            UserRole.user_id == payload.user_id,
            UserRole.role_id == role.id,
            UserRole.scope_type == payload.scope_type,
            UserRole.scope_id == payload.scope_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Role already assigned to user")

    # Check teacher_limit if assigning a teacher role to an organization
    if role.name == "teacher" and payload.scope_type == "organization" and payload.scope_id:
        from ..models.organization import Organization
        org = db.query(Organization).filter(Organization.id == payload.scope_id).first()
        if org and org.teacher_limit is not None:
            current_teacher_count = (
                db.query(func.count(UserRole.id))
                .join(Role, UserRole.role_id == Role.id)
                .filter(
                    Role.name == "teacher",
                    UserRole.scope_type == "organization",
                    UserRole.scope_id == payload.scope_id,
                    UserRole.is_active == True,
                )
                .scalar()
            )
            if current_teacher_count >= org.teacher_limit:
                raise HTTPException(
                    status_code=403,
                    detail=f"已達教師授權上限 ({org.teacher_limit})",
                )

    user_role = UserRole(
        user_id=payload.user_id,
        role_id=role.id,
        scope_type=payload.scope_type,
        scope_id=payload.scope_id,
        granted_by=current_user.id,
    )
    db.add(user_role)
    db.commit()
    db.refresh(user_role)
    logger.info(
        "Assigned role '%s' to user %d (scope=%s/%s) by user %d",
        payload.role_name, payload.user_id, payload.scope_type,
        payload.scope_id, current_user.id,
    )
    return _user_role_to_response(user_role, role)


@router.delete("/roles/assignments/{assignment_id}", status_code=204, response_model=None)
def revoke_role(
    assignment_id: int,
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Revoke a role assignment (soft delete by setting is_active=False)."""
    user_role = db.query(UserRole).filter(UserRole.id == assignment_id).first()
    if user_role is None:
        raise HTTPException(status_code=404, detail="Role assignment not found")

    user_role.is_active = False
    db.commit()
    logger.info(
        "Revoked role assignment %d by user %d",
        assignment_id, current_user.id,
    )
    return None


@router.get("/users/{user_id}/roles", response_model=list[UserRoleDetailResponse])
def list_user_roles(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all active roles for a specific user."""
    if current_user.id != user_id:
        # system_admin may read any user's roles; org_admin only for a user who
        # shares one of their orgs (#2470: was any org_admin → any user, cross-org).
        if not is_system_admin(current_user.id, db):
            caller_orgs = resolve_user_org_ids(current_user.id, db)
            target_orgs = resolve_user_org_ids(user_id, db)
            if not (caller_orgs & target_orgs):
                raise HTTPException(status_code=403, detail="Not authorized")

    # Verify target user exists
    target_user = db.query(User).filter(User.id == user_id).first()
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user_roles = (
        db.query(UserRole, Role)
        .join(Role, UserRole.role_id == Role.id)
        .filter(UserRole.user_id == user_id, UserRole.is_active == True)
        .all()
    )
    return [_user_role_to_response(ur, role) for ur, role in user_roles]
