"""
organizations_crud.py — Organization CRUD endpoints.

Part of the organizations.py split (Issue #1890).
Covers: POST /organizations, GET /organizations, GET /organizations/{id},
        PATCH /organizations/{id}, DELETE /organizations/{id}.

Shared helpers (_get_org_or_404, _org_to_response, _get_school_count) live here
because CRUD is the primary consumer; other modules import them from here.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, get_user_org_ids, require_role
from ..database import get_db
from ..dependencies.tenant import _check_org_member
from ..models.organization import Organization
from ..models.school import School
from ..models.user import User, UserRole
from ..schemas.organization import (
    OrganizationCreateRequest,
    OrganizationDetailResponse,
    OrganizationListResponse,
    OrganizationResponse,
    OrganizationUpdateRequest,
)
from ..schemas.school import SchoolResponse
from ..services.input_sanitizer import sanitize_ai_input

router = APIRouter(tags=["organizations"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared helpers (imported by other sub-modules)
# ---------------------------------------------------------------------------


def _get_org_or_404(org_id: str, db: Session) -> Organization:
    """Fetch an organization by ID or raise 404."""
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


def _org_to_response(org: Organization, school_count: int) -> OrganizationResponse:
    """Convert an Organization ORM object to an OrganizationResponse."""
    return OrganizationResponse(
        id=org.id,
        name=org.name,
        display_name=org.display_name,
        teacher_limit=org.teacher_limit,
        is_active=org.is_active,
        created_at=org.created_at,
        school_count=school_count,
        description=org.description,
        tax_id=org.tax_id,
        contact_email=org.contact_email,
        contact_phone=org.contact_phone,
        address=org.address,
        settings=org.settings,
        total_points=org.total_points,
        used_points=org.used_points,
        subscription_start_date=org.subscription_start_date,
        subscription_end_date=org.subscription_end_date,
    )


def _get_school_count(org: Organization, db: Session) -> int:
    """Fetch the school count for a single org (used outside list context)."""
    return (
        db.query(func.count(School.id))
        .filter(School.organization_id == org.id)
        .scalar()
    )


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------


@router.post("/organizations", status_code=201, response_model=OrganizationResponse)
def create_organization(
    payload: OrganizationCreateRequest,
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Create a new organization."""
    safe_name, _ = sanitize_ai_input(payload.name, user_id=str(current_user.id))
    safe_display_name = payload.display_name
    if safe_display_name:
        safe_display_name, _ = sanitize_ai_input(safe_display_name, user_id=str(current_user.id))
    safe_description = payload.description
    if safe_description:
        safe_description, _ = sanitize_ai_input(safe_description, user_id=str(current_user.id))

    if payload.tax_id:
        existing = db.query(Organization).filter(
            Organization.tax_id == payload.tax_id,
            Organization.is_active.is_(True),
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="統一編號已被其他機構使用")
    org = Organization(
        name=safe_name,
        display_name=safe_display_name,
        teacher_limit=payload.teacher_limit,
        description=safe_description,
        tax_id=payload.tax_id,
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
        address=payload.address,
        settings=payload.settings,
        total_points=payload.total_points,
        subscription_start_date=payload.subscription_start_date,
        subscription_end_date=payload.subscription_end_date,
    )
    db.add(org)
    db.commit()
    db.refresh(org)
    logger.info(
        "Created organization '%s' (id=%s) by user %d",
        org.name, org.id, current_user.id,
    )
    return _org_to_response(org, _get_school_count(org, db))


@router.get("/organizations", response_model=OrganizationListResponse)
def list_organizations(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all organizations (scoped to the caller's org if not system_admin)."""
    query = db.query(Organization)
    org_ids = get_user_org_ids(current_user)
    if org_ids is not None:  # None = system_admin, sees all
        query = query.filter(Organization.id.in_(org_ids))
    total = query.count()
    items = (
        query.order_by(Organization.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    # Single grouped COUNT query for all orgs in this page — avoids N+1
    count_map = dict(
        db.query(School.organization_id, func.count(School.id))
        .filter(School.organization_id.in_([o.id for o in items]))
        .group_by(School.organization_id)
        .all()
    )
    return OrganizationListResponse(
        items=[_org_to_response(o, count_map.get(o.id, 0)) for o in items],
        total=total,
    )


@router.get("/organizations/{org_id}", response_model=OrganizationDetailResponse)
def get_organization(
    org_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get organization detail with schools list."""
    org = _get_org_or_404(org_id, db)
    _check_org_member(current_user, org_id, db)
    base = _org_to_response(org, _get_school_count(org, db))

    schools = (
        db.query(School)
        .filter(School.organization_id == org.id)
        .order_by(School.created_at.desc())
        .all()
    )
    school_dicts = [
        SchoolResponse(
            id=s.id,
            name=s.name,
            display_name=s.display_name,
            organization_id=s.organization_id,
            address=s.address,
            phone=s.phone,
            is_active=s.is_active,
            created_at=s.created_at,
        ).model_dump()
        for s in schools
    ]

    return OrganizationDetailResponse(
        **base.model_dump(),
        schools=school_dicts,
    )


@router.patch("/organizations/{org_id}", response_model=OrganizationResponse)
def update_organization(
    org_id: str,
    payload: OrganizationUpdateRequest,
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Update organization fields."""
    org = _get_org_or_404(org_id, db)
    org_ids = get_user_org_ids(current_user)
    if org_ids is not None and org.id not in org_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this organization")

    if payload.tax_id is not None:
        existing = db.query(Organization).filter(
            Organization.tax_id == payload.tax_id,
            Organization.is_active.is_(True),
            Organization.id != org_id,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="統一編號已被其他機構使用")

    update_data = payload.model_dump(exclude_unset=True)
    for text_field in ("name", "display_name", "description", "address"):
        if text_field in update_data and update_data[text_field]:
            update_data[text_field], _ = sanitize_ai_input(
                update_data[text_field], user_id=str(current_user.id)
            )
    for field, value in update_data.items():
        setattr(org, field, value)

    db.commit()
    db.refresh(org)
    logger.info("Updated organization %s: %s", org_id, list(update_data.keys()))
    return _org_to_response(org, _get_school_count(org, db))


@router.delete("/organizations/{org_id}", status_code=204)
def delete_organization(
    org_id: str,
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Hard-delete an organization (system_admin only). Fails if schools exist."""
    org = _get_org_or_404(org_id, db)
    school_count = _get_school_count(org, db)
    if school_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: organization has {school_count} school(s). Remove schools first.",
        )
    user_role_count = (
        db.query(UserRole)
        .filter(UserRole.scope_type == "organization", UserRole.scope_id == str(org.id))
        .count()
    )
    if user_role_count > 0:
        db.query(UserRole).filter(
            UserRole.scope_type == "organization", UserRole.scope_id == str(org.id)
        ).delete()
    db.delete(org)
    db.commit()
    logger.info("Deleted organization %s (%s) by user %s", org_id, org.name, current_user.id)
