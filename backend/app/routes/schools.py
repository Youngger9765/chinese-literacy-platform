import logging
import random
import string
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..auth.dependencies import get_current_user, require_role
from ..database import get_db
from ..models.organization import Organization
from ..models.school import Classroom, School
from ..models.user import Role, User, UserRole
from ..schemas.school import (
    SchoolCreateRequest,
    SchoolListResponse,
    SchoolResponse,
    SchoolUpdateRequest,
)
from ..schemas.user_admin import SchoolMemberResponse

router = APIRouter(tags=["schools"])
logger = logging.getLogger(__name__)


# -- Helpers ------------------------------------------------------------------


def _get_school_or_404(school_id: int, db: Session) -> School:
    """Fetch a school by ID or raise 404."""
    school = db.query(School).filter(School.id == school_id).first()
    if school is None:
        raise HTTPException(status_code=404, detail="School not found")
    return school


_SCHOOL_JOIN_CODE_LENGTH = 8
_SCHOOL_JOIN_CODE_CHARS = string.ascii_uppercase + string.digits
_SCHOOL_JOIN_CODE_MAX_RETRIES = 10


def _generate_school_join_code(db: Session) -> str:
    """Generate a unique random join code for a school."""
    for _ in range(_SCHOOL_JOIN_CODE_MAX_RETRIES):
        code = "".join(random.choices(_SCHOOL_JOIN_CODE_CHARS, k=_SCHOOL_JOIN_CODE_LENGTH))
        existing = db.query(School).filter(School.join_code == code).first()
        if existing is None:
            return code
    raise HTTPException(
        status_code=500,
        detail="Failed to generate unique school join code after multiple retries",
    )


def _school_to_response(school: School) -> SchoolResponse:
    """Convert a School ORM object to a SchoolResponse."""
    return SchoolResponse(
        id=school.id,
        name=school.name,
        display_name=school.display_name,
        organization_id=school.organization_id,
        address=school.address,
        phone=school.phone,
        join_code=school.join_code,
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

    join_code = _generate_school_join_code(db)
    school = School(
        name=payload.name,
        organization_id=payload.organization_id,
        address=payload.address,
        phone=payload.phone,
        join_code=join_code,
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


# -- School Join Code ---------------------------------------------------------


@router.post("/schools/{school_id}/regenerate-code", response_model=SchoolResponse)
def regenerate_school_code(
    school_id: int,
    current_user: User = require_role("system_admin", "org_admin"),
    db: Session = Depends(get_db),
):
    """Regenerate the join code for a school. Requires admin."""
    school = _get_school_or_404(school_id, db)
    school.join_code = _generate_school_join_code(db)
    db.commit()
    db.refresh(school)
    logger.info(
        "Regenerated join code for school %d (by user %d)",
        school_id, current_user.id,
    )
    return _school_to_response(school)


# -- School Classrooms --------------------------------------------------------


class SchoolClassroomResponse(BaseModel):
    """Classroom summary for school detail view (includes teacher name)."""

    id: int
    name: str
    grade: int | None
    is_active: bool
    teacher_id: int
    teacher_name: str
    student_count: int
    created_at: datetime


@router.get(
    "/schools/{school_id}/classrooms",
    response_model=list[SchoolClassroomResponse],
)
def list_school_classrooms(
    school_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all classrooms belonging to a school (admin view)."""
    _get_school_or_404(school_id, db)

    classrooms = (
        db.query(Classroom)
        .filter(Classroom.school_id == school_id)
        .options(joinedload(Classroom.teacher), joinedload(Classroom.classroom_students))
        .order_by(Classroom.created_at.desc())
        .all()
    )

    return [
        SchoolClassroomResponse(
            id=c.id,
            name=c.name,
            grade=c.grade,
            is_active=c.is_active,
            teacher_id=c.teacher_id,
            teacher_name=c.teacher.name,
            student_count=len(c.classroom_students),
            created_at=c.created_at,
        )
        for c in classrooms
    ]


# -- School Members -----------------------------------------------------------


@router.get(
    "/schools/{school_id}/members",
    response_model=list[SchoolMemberResponse],
)
def list_school_members(
    school_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all users who have a role scoped to this school."""
    _get_school_or_404(school_id, db)

    rows = (
        db.query(User, Role, UserRole)
        .join(UserRole, User.id == UserRole.user_id)
        .join(Role, UserRole.role_id == Role.id)
        .filter(
            UserRole.scope_type == "school",
            UserRole.scope_id == str(school_id),
            UserRole.is_active == True,
        )
        .order_by(Role.name, User.name)
        .all()
    )

    return [
        SchoolMemberResponse(
            user_id=user.id,
            name=user.name,
            email=user.email,
            role_name=role.name,
            role_display_name=role.display_name,
        )
        for user, role, _ in rows
    ]
