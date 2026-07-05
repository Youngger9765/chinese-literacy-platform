"""
organization_points.py — Organization points log endpoints.

Part of the organizations.py split (Issue #1890).
Covers: GET /organizations/{org_id}/points/logs
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.policies import is_system_admin
from ..database import get_db
from ..models.points_log import OrganizationPointsLog
from ..models.user import Role, User, UserRole
from ..routes.organizations_crud import _get_org_or_404
from ..schemas.organization import PointsLogListResponse, PointsLogResponse

router = APIRouter(tags=["organizations"])
logger = logging.getLogger(__name__)


@router.get("/organizations/{org_id}/points/logs", response_model=PointsLogListResponse)
def get_points_logs(
    org_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List points usage logs for an organization."""
    org = _get_org_or_404(org_id, db)

    # Permission: system_admin (global bypass), or org_owner/org_admin scoped to
    # THIS org. Use is_system_admin (not is_admin) so an org_admin of another org
    # can't bypass org scoping; the fallback below re-admits org_admin/org_owner of
    # this specific org (regression guard — previously only org_owner was allowed).
    if not is_system_admin(current_user.id, db):
        has_org_role = (
            db.query(UserRole)
            .join(Role, UserRole.role_id == Role.id)
            .filter(
                UserRole.user_id == current_user.id,
                UserRole.is_active == True,  # noqa: E712
                Role.name.in_(["org_owner", "org_admin"]),
                UserRole.scope_type == "organization",
                UserRole.scope_id == str(org.id),
            )
            .first()
        )
        if not has_org_role:
            raise HTTPException(status_code=403, detail="Not authorized for this organization")

    base_query = db.query(OrganizationPointsLog).filter(
        OrganizationPointsLog.organization_id == org_id
    )
    total = base_query.count()
    logs = (
        base_query.order_by(OrganizationPointsLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Fetch user display names for log entries
    user_ids = {log.user_id for log in logs if log.user_id is not None}
    user_name_map: dict[int, str] = {}
    if user_ids:
        from ..models.user import User as UserModel
        users = db.query(UserModel.id, UserModel.name).filter(UserModel.id.in_(user_ids)).all()
        user_name_map = {u.id: u.name for u in users}

    items = [
        PointsLogResponse(
            id=log.id,
            organization_id=log.organization_id,
            user_id=log.user_id,
            user_name=user_name_map.get(log.user_id) if log.user_id else None,
            points_used=log.points_used,
            feature_type=log.feature_type,
            description=log.description,
            created_at=log.created_at,
        )
        for log in logs
    ]

    return PointsLogListResponse(items=items, total=total)
