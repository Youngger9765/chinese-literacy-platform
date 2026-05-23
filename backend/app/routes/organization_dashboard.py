"""
organization_dashboard.py — Organization dashboard aggregate endpoint.

Part of the organizations.py split (Issue #1890).
Covers: GET /organizations/{org_id}/dashboard
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.policies import is_admin
from ..database import get_db
from ..models.school import Classroom, ClassroomStudent, School
from ..models.session import LearningSession
from ..models.user import Role, User, UserRole
from ..routes.organizations_crud import _get_org_or_404
from ..schemas.organization import OrgDashboardResponse, SchoolStatItem

router = APIRouter(tags=["organizations"])
logger = logging.getLogger(__name__)


@router.get("/organizations/{org_id}/dashboard", response_model=OrgDashboardResponse)
def get_organization_dashboard(
    org_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return aggregate statistics for an organization."""
    org = _get_org_or_404(org_id, db)

    # Permission check: system_admin, org_owner, or org_admin only
    if not is_admin(current_user.id, db):
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

    # --- Teacher counts per school ---
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

    # --- Session counts per school ---
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
