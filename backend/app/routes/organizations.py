import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, get_user_org_ids, require_role
from ..database import get_db
from ..models.organization import Organization
from ..models.school import School, Classroom, ClassroomStudent
from ..models.session import LearningSession
from ..models.user import User, UserRole, Role
from ..schemas.organization import (
    OrgDashboardResponse,
    OrganizationCreateRequest,
    OrganizationDetailResponse,
    OrganizationListResponse,
    OrganizationResponse,
    OrganizationUpdateRequest,
    SchoolStatItem,
)
from ..schemas.school import SchoolResponse

router = APIRouter(tags=["organizations"])
logger = logging.getLogger(__name__)


# -- Helpers ------------------------------------------------------------------


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
        is_active=org.is_active,
        created_at=org.created_at,
        school_count=school_count,
        teacher_limit=org.teacher_limit,
        description=org.description,
        tax_id=org.tax_id,
        contact_email=org.contact_email,
        contact_phone=org.contact_phone,
        address=org.address,
        settings=org.settings,
    )


def _get_school_count(org: Organization, db: Session) -> int:
    """Fetch the school count for a single org (used outside list context)."""
    return (
        db.query(func.count(School.id))
        .filter(School.organization_id == org.id)
        .scalar()
    )


# -- Organization CRUD --------------------------------------------------------


@router.post("/organizations", status_code=201, response_model=OrganizationResponse)
def create_organization(
    payload: OrganizationCreateRequest,
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Create a new organization."""
    if payload.tax_id:
        existing = db.query(Organization).filter(
            Organization.tax_id == payload.tax_id,
            Organization.is_active.is_(True),
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="統一編號已被其他機構使用")
    org = Organization(
        name=payload.name,
        display_name=payload.display_name,
        teacher_limit=payload.teacher_limit,
        description=payload.description,
        tax_id=payload.tax_id,
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
        address=payload.address,
        settings=payload.settings,
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
    """List all organizations."""
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
    org_ids = get_user_org_ids(current_user)
    if org_ids is not None and org.id not in org_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this organization")
    base = _org_to_response(org, _get_school_count(org, db))

    # Include the list of schools under this org
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
    for field, value in update_data.items():
        setattr(org, field, value)

    db.commit()
    db.refresh(org)
    logger.info("Updated organization %s: %s", org_id, list(update_data.keys()))
    return _org_to_response(org, _get_school_count(org, db))


# -- Dashboard ----------------------------------------------------------------


@router.get("/organizations/{org_id}/dashboard", response_model=OrgDashboardResponse)
def get_organization_dashboard(
    org_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return aggregate statistics for an organization."""
    org = _get_org_or_404(org_id, db)

    # Permission check: system_admin, org_owner, or org_admin only
    is_system_admin = any(
        ur.is_active and ur.role and ur.role.name == "system_admin"
        for ur in current_user.user_roles
    )
    if not is_system_admin:
        has_org_role = any(
            ur.is_active
            and ur.scope_type == "organization"
            and ur.scope_id == str(org.id)
            and ur.role
            and ur.role.name in ("org_owner", "org_admin")
            for ur in current_user.user_roles
        )
        if not has_org_role:
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    schools = (
        db.query(School)
        .filter(School.organization_id == org_id)
        .order_by(School.name)
        .all()
    )

    school_ids = [s.id for s in schools]

    # --- Teacher counts per school (UserRole scope_type='school', role=teacher) ---
    teacher_role = db.query(Role).filter(Role.name == "teacher").first()
    teacher_role_id = teacher_role.id if teacher_role else None

    if school_ids and teacher_role_id is not None:
        teacher_rows = (
            db.query(UserRole.scope_id, func.count(UserRole.user_id.distinct()))
            .filter(
                UserRole.scope_type == "school",
                UserRole.scope_id.in_([str(sid) for sid in school_ids]),
                UserRole.role_id == teacher_role_id,
                UserRole.is_active.is_(True),
            )
            .group_by(UserRole.scope_id)
            .all()
        )
        teacher_map = {int(scope_id): cnt for scope_id, cnt in teacher_rows}
    else:
        teacher_map = {}

    # --- Student counts per school (via classroom_students → classrooms) ---
    if school_ids:
        student_rows = (
            db.query(Classroom.school_id, func.count(ClassroomStudent.student_id.distinct()))
            .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
            .filter(Classroom.school_id.in_(school_ids))
            .group_by(Classroom.school_id)
            .all()
        )
        student_map = {school_id: cnt for school_id, cnt in student_rows}
    else:
        student_map = {}

    # --- Session counts per school (LearningSession → classrooms) ---
    if school_ids:
        session_rows = (
            db.query(Classroom.school_id, func.count(LearningSession.id))
            .join(LearningSession, LearningSession.classroom_id == Classroom.id)
            .filter(Classroom.school_id.in_(school_ids))
            .group_by(Classroom.school_id)
            .all()
        )
        session_map = {school_id: cnt for school_id, cnt in session_rows}

        completed_sessions = (
            db.query(func.count(LearningSession.id))
            .join(Classroom, LearningSession.classroom_id == Classroom.id)
            .filter(
                Classroom.school_id.in_(school_ids),
                LearningSession.status == "completed",
            )
            .scalar()
        ) or 0
    else:
        session_map = {}
        completed_sessions = 0

    # Build per-school stats
    school_stats = [
        SchoolStatItem(
            school_id=s.id,
            school_name=s.display_name or s.name,
            teacher_count=teacher_map.get(s.id, 0),
            student_count=student_map.get(s.id, 0),
            session_count=session_map.get(s.id, 0),
        )
        for s in schools
    ]

    return OrgDashboardResponse(
        total_schools=len(schools),
        total_teachers=sum(item.teacher_count for item in school_stats),
        total_students=sum(item.student_count for item in school_stats),
        total_sessions=sum(item.session_count for item in school_stats),
        completed_sessions=completed_sessions,
        school_stats=school_stats,
    )
