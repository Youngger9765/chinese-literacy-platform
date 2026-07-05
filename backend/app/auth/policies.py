"""Centralized authorization policies for LingoLeap.

Single source of truth for classroom/student access control.
All route modules should import from here instead of implementing their own checks.
"""
import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from ..models.user import Role, User, UserRole

logger = logging.getLogger(__name__)


def is_admin(user_id: int, db: Session) -> bool:
    """Return True if user has system_admin or org_admin role.

    NOTE: this includes org_admin, so it must NOT be used as a *global* bypass in
    contexts that require organization-scope isolation (cross-org reads). Using it
    that way lets an org_admin skip org-scoping and read other orgs' data (個資法
    §20 violation). For a global bypass, use ``is_system_admin`` and let org_admin
    fall through to the org-scope check.
    """
    return (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,
            Role.name.in_(["system_admin", "org_admin"]),
        )
        .first()
    ) is not None


def is_system_admin(user_id: int, db: Session) -> bool:
    """Return True only if the user has an active system_admin role.

    Use this (not ``is_admin``) for the global bypass in org-scope-sensitive
    checks: system_admin sees everything, org_admin must stay within its org.
    """
    return (
        db.query(UserRole)
        .join(Role)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,
            Role.name == "system_admin",
        )
        .first()
    ) is not None


def resolve_user_org_ids(user_id: int, db: Session) -> set[str]:
    """Resolve ALL organization ids a user belongs to (as a set of str org ids).

    Handles the production scoping model: students/teachers carry a SCHOOL-scoped
    UserRole (scope_type="school", scope_id=str(school.id)), NOT a direct org role,
    so their org is derived via School.organization_id. org_admin/org_owner carry
    org-scoped roles (scope_type="organization"), resolved directly. Returns the
    union of both.

    Using only org-scoped roles (the old approach) wrongly returned an empty set
    for a real school-scoped student, which over-restricted org_admins out of
    their OWN org's data. Always resolve through school→org for correctness.
    """
    org_ids: set[str] = set()
    school_ids: set[int] = set()
    rows = (
        db.query(UserRole.scope_type, UserRole.scope_id)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,
            UserRole.scope_id.isnot(None),
        )
        .all()
    )
    for scope_type, scope_id in rows:
        if scope_type == "organization":
            org_ids.add(str(scope_id))
        elif scope_type == "school":
            try:
                school_ids.add(int(scope_id))
            except (TypeError, ValueError):
                continue
    if school_ids:
        schools = (
            db.query(School.organization_id)
            .filter(School.id.in_(school_ids), School.organization_id.isnot(None))
            .all()
        )
        for (org_id,) in schools:
            org_ids.add(str(org_id))
    return org_ids


def _org_admin_org_ids(user_id: int, db: Session) -> set[str]:
    """Org ids where the user holds an active org_admin/org_owner role (org-scoped).

    This is "which orgs the user *administers*", NOT mere membership. Used to scope
    the org-level bypass so an org_admin of org A cannot reach org B's resources.
    """
    rows = (
        db.query(UserRole.scope_id)
        .join(Role, UserRole.role_id == Role.id)
        .filter(
            UserRole.user_id == user_id,
            UserRole.is_active == True,
            UserRole.scope_type == "organization",
            Role.name.in_(["org_admin", "org_owner"]),
            UserRole.scope_id.isnot(None),
        )
        .all()
    )
    return {str(r[0]) for r in rows}


def _is_org_admin_of_school(user_id: int, school_id, db: Session) -> bool:
    """True if user is org_admin/org_owner of the org that owns ``school_id``.

    Orphan schools (organization_id IS NULL) return False on purpose — an org_admin
    cannot claim an unscoped school via org; such access must come from ownership /
    membership, not the org bypass.
    """
    if school_id is None:
        return False
    school = db.query(School).filter(School.id == school_id).first()
    if school is None or school.organization_id is None:
        return False
    return str(school.organization_id) in _org_admin_org_ids(user_id, db)


def require_classroom_owner(classroom: Classroom, user: User, db: Session) -> None:
    """Allow classroom primary teacher, system_admin, or org_admin/org_owner OF THE
    CLASSROOM'S ORG. Raise 403 otherwise.

    Use for write operations (update, delete, assign).
    Co-teachers (assistants) are NOT allowed for write ops.

    NOTE: global bypass is system_admin only; org admins are scoped to their own
    org (via school→org) so a cross-org org_admin cannot write another org's class.
    """
    if classroom.teacher_id == user.id:
        return
    if is_system_admin(user.id, db):
        return
    if _is_org_admin_of_school(user.id, classroom.school_id, db):
        return
    raise HTTPException(status_code=403, detail="Not your classroom")


def require_classroom_member(classroom: Classroom, user: User, db: Session) -> None:
    """Allow classroom owner, co-teachers, system_admin, or org_admin/org_owner OF
    THE CLASSROOM'S ORG. Raise 403 otherwise.

    Use for read operations (view students, progress).
    Org admins are scoped to their own org (via school→org), not a global bypass.
    """
    if classroom.teacher_id == user.id:
        return
    ct = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom.id,
            ClassroomTeacher.teacher_id == user.id,
        )
        .first()
    )
    if ct:
        return
    if is_system_admin(user.id, db):
        return
    if _is_org_admin_of_school(user.id, classroom.school_id, db):
        return
    raise HTTPException(status_code=403, detail="Not your classroom")


def require_student_visible_to_teacher(student_id: int, user: User, db: Session) -> None:
    """Verify the user may access a student's data.

    Allowed:
    - system_admin (global), OR
    - org_admin/org_owner of the student's org (via enrolled classroom's school→org), OR
    - the primary teacher or co-teacher of a classroom containing the student.

    Org admins are scoped to their own org (not a global bypass). Raises 403 otherwise.
    """
    if is_system_admin(user.id, db):
        return

    # org_admin/org_owner scoped to the student's org (resolved via school→org).
    caller_org_admin = _org_admin_org_ids(user.id, db)
    if caller_org_admin:
        student_orgs = {
            str(org_id)
            for (org_id,) in (
                db.query(School.organization_id)
                .join(Classroom, Classroom.school_id == School.id)
                .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
                .filter(
                    ClassroomStudent.student_id == student_id,
                    School.organization_id.isnot(None),
                )
                .all()
            )
        }
        if caller_org_admin & student_orgs:
            return

    # Check if student is in any classroom where user is primary teacher or co-teacher
    enrollment = (
        db.query(ClassroomStudent)
        .join(Classroom, ClassroomStudent.classroom_id == Classroom.id)
        .filter(ClassroomStudent.student_id == student_id)
        .filter(
            (Classroom.teacher_id == user.id)
            | (
                db.query(ClassroomTeacher.classroom_id)
                .filter(
                    ClassroomTeacher.classroom_id == ClassroomStudent.classroom_id,
                    ClassroomTeacher.teacher_id == user.id,
                )
                .correlate(ClassroomStudent)
                .exists()
            )
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to access this student's data",
        )
