import logging
import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from ..auth.authz import can
from ..auth.dependencies import get_current_user, require_role
from ..auth.policies import is_system_admin
from ..database import get_db
from ..models.organization import Organization
from ..models.school import Classroom, School
from ..models.user import Role, User, UserRole
from ..schemas.school import (
    SchoolClassroomResponse,
    SchoolCreateRequest,
    SchoolListResponse,
    SchoolResponse,
    SchoolUpdateRequest,
)
from ..schemas.user_admin import SchoolMemberResponse
from ..services.input_sanitizer import sanitize_ai_input

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
        code = "".join(secrets.choice(_SCHOOL_JOIN_CODE_CHARS) for _ in range(_SCHOOL_JOIN_CODE_LENGTH))
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
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Create a new school.

    (#3804) school is now a system_admin-maintained reference directory, not
    something an org_admin creates "inside their org" — the org tenancy
    bypass is retired. organization_id is still accepted (Organization stays
    as a dormant billing concept, see PRD #3804 §1.2) and validated to exist
    if given, but it no longer participates in who may call this endpoint.
    """
    if payload.organization_id is not None:
        org = (
            db.query(Organization)
            .filter(Organization.id == payload.organization_id)
            .first()
        )
        if org is None:
            raise HTTPException(status_code=404, detail="Organization not found")

    # Sanitize admin-provided text fields
    safe_name, _ = sanitize_ai_input(payload.name, user_id=str(current_user.id))

    join_code = _generate_school_join_code(db)
    school = School(
        name=safe_name,
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
    """List schools.

    (#3804) system_admin sees the whole directory; everyone else sees only
    the schools they hold an active school-scoped role in. Opening the full
    directory to every authenticated caller (so e.g. registration can search
    it) is Phase 2 work gated on the MOE school-code import — see PRD #3804
    §4.2/§4.3. Until then this stays membership-scoped, which also avoids
    widening exposure of School.join_code to non-members.
    """
    query = db.query(School)
    if not is_system_admin(current_user.id, db):
        member_school_ids = {
            int(ur.scope_id)
            for ur in current_user.user_roles
            if ur.is_active and ur.scope_type == "school" and ur.scope_id and ur.scope_id.isdigit()
        }
        if not member_school_ids:
            return SchoolListResponse(items=[], total=0)
        query = query.filter(School.id.in_(member_school_ids))
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
    """Get school detail.

    (#3804) system_admin, or an active member of THIS school. The org_admin
    cross-tenant bypass from before #3800/#3802 is retired — org no longer
    grants reach into a school's data under the school-as-label model.
    """
    school = _get_school_or_404(school_id, db)
    if not can(current_user, "view", "school", school_id, db):
        raise HTTPException(status_code=403, detail="Not authorized for this school")
    return _school_to_response(school)


@router.patch("/schools/{school_id}", response_model=SchoolResponse)
def update_school(
    school_id: int,
    payload: SchoolUpdateRequest,
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Update school fields.

    (#3804) system_admin-only — the shared directory has no "owning org"
    anymore, so there is no org_admin to additionally authorize.
    """
    school = _get_school_or_404(school_id, db)

    update_data = payload.model_dump(exclude_unset=True)
    # Sanitize text fields in update payload
    for text_field in ("name", "address"):
        if text_field in update_data and update_data[text_field]:
            update_data[text_field], _ = sanitize_ai_input(
                update_data[text_field], user_id=str(current_user.id)
            )
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
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Regenerate the join code for a school. system_admin-only (#3804: the
    org_admin-of-the-school's-org bypass from #2470 NEW-5 is retired)."""
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


@router.get(
    "/schools/{school_id}/classrooms",
    response_model=list[SchoolClassroomResponse],
)
def list_school_classrooms(
    school_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all classrooms belonging to a school.

    (#3804) system_admin, or an active member of THIS school (any role — the
    old org_admin-of-the-school's-org bypass is retired, and the previous
    org-only check 403'd every ordinary teacher reading their OWN school,
    since get_user_org_ids() returns [] rather than None for them — see PRD
    #3804 §1.2.A).
    """
    _get_school_or_404(school_id, db)
    if not can(current_user, "view", "school_roster", school_id, db):
        raise HTTPException(status_code=403, detail="Not authorized for this school")

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
    """List all users who have a role scoped to this school.

    (#3804) system_admin, or an active member of THIS school. The old
    org_admin-of-the-school's-org bypass is retired; the previous org-only
    check also 403'd every ordinary teacher reading their OWN school's
    roster (see PRD #3804 §1.2.A — same get_user_org_ids() bug as #3800,
    just a different endpoint it was never backported to).
    """
    _get_school_or_404(school_id, db)
    if not can(current_user, "view", "school_roster", school_id, db):
        raise HTTPException(status_code=403, detail="Not authorized for this school")

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
