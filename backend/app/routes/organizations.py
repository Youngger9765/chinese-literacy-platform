import csv
import io
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, get_user_org_ids, require_role
from ..dependencies.tenant import _check_org_member
from ..models.user import UserRole, Role
from ..database import get_db
from ..models.organization import Organization
from ..models.points_log import OrganizationPointsLog
from ..models.school import Classroom, ClassroomStudent, School
from ..models.session import LearningSession
from ..models.user import Role, User, UserRole
from ..schemas.organization import (
    OrgDashboardResponse,
    OrganizationCreateRequest,
    OrganizationDetailResponse,
    OrganizationListResponse,
    OrganizationResponse,
    OrganizationUpdateRequest,
    PointsLogListResponse,
    PointsLogResponse,
    SchoolStatItem,
)
from ..schemas.school import SchoolResponse
from ..services.input_sanitizer import sanitize_ai_input

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


# -- Organization CRUD --------------------------------------------------------


@router.post("/organizations", status_code=201, response_model=OrganizationResponse)
def create_organization(
    payload: OrganizationCreateRequest,
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Create a new organization."""
    # Sanitize admin-provided text fields
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
    _check_org_member(current_user, org_id, db)
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
    # Sanitize text fields in update payload
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


# -- Admin Report Export -------------------------------------------------------

_ADMIN_EXPORT_ROW_LIMIT = 10_000


def _sanitize_csv_cell(value: str) -> str:
    """Prevent CSV formula injection by prefixing dangerous leading characters."""
    if isinstance(value, str) and value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


@router.get("/admin/reports/export")
def export_platform_report(
    school_id: int | None = Query(None),
    classroom_id: int | None = Query(None),
    current_user: User = require_role("system_admin"),
    db: Session = Depends(get_db),
):
    """Export platform-wide student progress as a UTF-8 BOM CSV (system_admin only).

    Optional filters: school_id, classroom_id.
    Columns: 學校名稱, 班級名稱, 學生姓名, 已完成課文數, 平均正確率, 總學習次數, 最近學習日期
    Raises 400 if result set exceeds the row limit (use filters to narrow).
    """
    query = db.query(ClassroomStudent).join(
        Classroom, ClassroomStudent.classroom_id == Classroom.id
    ).join(School, Classroom.school_id == School.id)

    if classroom_id is not None:
        query = query.filter(ClassroomStudent.classroom_id == classroom_id)
    elif school_id is not None:
        query = query.filter(Classroom.school_id == school_id)

    # Apply row limit to prevent OOM on large datasets
    enrollments = query.limit(_ADMIN_EXPORT_ROW_LIMIT + 1).all()
    if len(enrollments) > _ADMIN_EXPORT_ROW_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"匯出資料量過大，請加上 school_id 或 classroom_id 篩選條件（上限 {_ADMIN_EXPORT_ROW_LIMIT:,} 筆）",
        )

    # Batch-load all sessions for these students in one query to avoid N+1
    student_ids = [e.student_id for e in enrollments]
    all_sessions = (
        db.query(LearningSession)
        .filter(LearningSession.student_id.in_(student_ids))
        .all()
        if student_ids
        else []
    )
    sessions_by_student: dict[int, list] = {}
    for s in all_sessions:
        sessions_by_student.setdefault(s.student_id, []).append(s)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "學校名稱", "班級名稱", "學生姓名",
        "已完成課文數", "平均正確率", "總學習次數", "最近學習日期",
    ])

    for enrollment in enrollments:
        student = enrollment.student
        classroom = enrollment.classroom
        school = classroom.school
        sessions = sessions_by_student.get(student.id, [])

        total_sessions = len(sessions)
        completed_sessions = [s for s in sessions if s.status == "completed"]
        completed_texts = len({s.story_slug for s in completed_sessions if s.story_slug})

        scores = [s.accuracy for s in sessions if s.accuracy is not None]
        avg_accuracy = f"{sum(scores) / len(scores):.1f}%" if scores else ""

        latest = max(sessions, key=lambda s: s.started_at, default=None)
        last_date = latest.started_at.strftime("%Y-%m-%d") if latest else ""

        writer.writerow([
            _sanitize_csv_cell(school.name),
            _sanitize_csv_cell(classroom.name),
            _sanitize_csv_cell(student.name),
            completed_texts,
            avg_accuracy,
            total_sessions,
            last_date,
        ])

    csv_content = output.getvalue()
    output.close()

    filename = f"platform-report-{datetime.now().strftime('%Y%m%d')}.csv"
    # utf-8-sig encoding adds the UTF-8 BOM (EF BB BF) — do NOT write \ufeff manually
    return StreamingResponse(
        iter([csv_content.encode("utf-8-sig")]),
        media_type="text/csv; charset=UTF-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
# -- Points Logs --------------------------------------------------------------


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

    # Permission: system_admin (sees all) or org_owner/org_admin for this org specifically
    _ADMIN_ROLES = ("system_admin", "org_owner", "org_admin")
    has_permission = (
        db.query(UserRole)
        .join(Role, UserRole.role_id == Role.id)
        .filter(
            UserRole.user_id == current_user.id,
            UserRole.is_active == True,
            Role.name.in_(_ADMIN_ROLES),
        )
        .filter(
            (Role.name == "system_admin") |
            ((UserRole.scope_type == "organization") & (UserRole.scope_id == org.id))
        )
        .first()
    )
    if not has_permission:
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
        users = db.query(User.id, User.name).filter(User.id.in_(user_ids)).all()
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
