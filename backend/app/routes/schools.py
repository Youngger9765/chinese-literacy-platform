import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, require_role
from ..database import get_db
from ..models.organization import Organization
from ..models.school import School
from ..models.user import User
from ..schemas.school import (
    SchoolCreateRequest,
    SchoolListResponse,
    SchoolResponse,
    SchoolUpdateRequest,
)

router = APIRouter(tags=["schools"])
logger = logging.getLogger(__name__)


# -- Helpers ------------------------------------------------------------------


def _get_school_or_404(school_id: int, db: Session) -> School:
    """Fetch a school by ID or raise 404."""
    school = db.query(School).filter(School.id == school_id).first()
    if school is None:
        raise HTTPException(status_code=404, detail="School not found")
    return school


def _school_to_response(school: School) -> SchoolResponse:
    """Convert a School ORM object to a SchoolResponse."""
    return SchoolResponse(
        id=school.id,
        name=school.name,
        display_name=school.display_name,
        organization_id=school.organization_id,
        address=school.address,
        phone=school.phone,
        is_active=school.is_active,
        created_at=school.created_at,
    )


# -- School CRUD --------------------------------------------------------------


@router.post("/schools", status_code=201, response_model=SchoolResponse)
def create_school(
    payload: SchoolCreateRequest,
    current_user: User = require_role("system_admin", "org_admin"),
    db: Session = Depends(get_db),
):
    """Create a new school."""
    # Verify organization exists if provided
    if payload.organization_id is not None:
        org = (
            db.query(Organization)
            .filter(Organization.id == payload.organization_id)
            .first()
        )
        if org is None:
            raise HTTPException(status_code=404, detail="Organization not found")

    school = School(
        name=payload.name,
        organization_id=payload.organization_id,
        address=payload.address,
        phone=payload.phone,
    )
    db.add(school)
    db.commit()
    db.refresh(school)
    logger.info(
        "Created school %d '%s' by user %d",
        school.id, school.name, current_user.id,
    )
    return _school_to_response(school)


@router.get("/schools", response_model=SchoolListResponse)
def list_schools(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all schools."""
    query = db.query(School)
    total = query.count()
    items = query.order_by(School.created_at.desc()).offset(offset).limit(limit).all()
    return SchoolListResponse(
        items=[_school_to_response(s) for s in items],
        total=total,
    )


@router.get("/schools/{school_id}", response_model=SchoolResponse)
def get_school(
    school_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get school detail."""
    school = _get_school_or_404(school_id, db)
    return _school_to_response(school)


@router.patch("/schools/{school_id}", response_model=SchoolResponse)
def update_school(
    school_id: int,
    payload: SchoolUpdateRequest,
    current_user: User = require_role("system_admin", "org_admin"),
    db: Session = Depends(get_db),
):
    """Update school fields."""
    school = _get_school_or_404(school_id, db)

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(school, field, value)

    db.commit()
    db.refresh(school)
    logger.info("Updated school %d: %s", school_id, list(update_data.keys()))
    return _school_to_response(school)
