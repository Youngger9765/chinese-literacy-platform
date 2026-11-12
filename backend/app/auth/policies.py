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

    DEPRECATED (#3804): kept only because app/routes/roles.py still calls it
    for ONE narrow, still-valid purpose — "did system_admin grant THIS
    specific admin role to THIS specific org" is unrelated to the retired
    classroom/student/school cross-tenant bypass. Do not add new callers for
    authorization bypass purposes; the school-as-label model (see PRD #3804)
    does not recognize org_admin/org_owner as granting reach into schools,
    classrooms, students, or other users' data.
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
    """DEPRECATED (#3804) — no longer called anywhere.

    Used to let org_admin/org_owner reach into a school via
    School.organization_id. Retired along with the org tenancy tier; kept
    only so existing characterization tests of this module don't need to
    change, and as a documented historical reference for what the old model
    did. Do not add new call sites.
    """
    if school_id is None:
        return False
    school = db.query(School).filter(School.id == school_id).first()
    if school is None or school.organization_id is None:
        return False
    return str(school.organization_id) in _org_admin_org_ids(user_id, db)


def require_classroom_owner(classroom: Classroom, user: User, db: Session) -> None:
    """Allow classroom primary teacher, or system_admin. Raise 403 otherwise.

    Use for OWNER-EXCLUSIVE write operations only: delete classroom, manage
    co-teachers (invite/role-change/remove). Co-teachers of ANY role
    (editor/viewer) are NOT allowed here -- for the broader set of day-to-day
    write operations editors ARE allowed to do, use ``require_classroom_editor``.

    (#3804) The org_admin/org_owner-of-the-classroom's-org bypass is retired
    — system_admin is the sole global exception under the school-as-label
    model; everything else is classroom ownership.
    """
    if classroom.teacher_id == user.id:
        return
    if is_system_admin(user.id, db):
        return
    raise HTTPException(status_code=403, detail="Not your classroom")


def require_classroom_member(classroom: Classroom, user: User, db: Session) -> None:
    """Allow classroom owner, ACCEPTED co-teachers (any role), or system_admin.
    Raise 403 otherwise.

    Use for read operations (view students, progress, assignments, reports).

    (#3804) The org_admin/org_owner-of-the-classroom's-org bypass is retired.
    (#3820) A co-teacher with status='pending' has not accepted the invitation
    yet and therefore is NOT a member -- this is the single invariant that
    keeps an un-accepted invite from leaking any read access anywhere.
    """
    if classroom.teacher_id == user.id:
        return
    ct = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom.id,
            ClassroomTeacher.teacher_id == user.id,
            ClassroomTeacher.status == "accepted",
        )
        .first()
    )
    if ct:
        return
    if is_system_admin(user.id, db):
        return
    raise HTTPException(status_code=403, detail="Not your classroom")


def require_classroom_editor(classroom: Classroom, user: User, db: Session) -> None:
    """Allow classroom owner, ACCEPTED 'editor'-role co-teachers, or system_admin.
    Raise 403 otherwise.

    Use for write operations that are NOT owner-exclusive: add/remove student,
    classroom settings, assign homework, reset password, etc. (#3820). A
    'viewer'-role or still-'pending' co-teacher is rejected.

    Owner-exclusive operations (delete classroom, manage co-teachers
    themselves) must keep using ``require_classroom_owner`` instead.
    """
    if classroom.teacher_id == user.id:
        return
    ct = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom.id,
            ClassroomTeacher.teacher_id == user.id,
            ClassroomTeacher.status == "accepted",
            ClassroomTeacher.role == "editor",
        )
        .first()
    )
    if ct:
        return
    if is_system_admin(user.id, db):
        return
    raise HTTPException(status_code=403, detail="Not your classroom")


def require_student_visible_to_teacher(student_id: int, user: User, db: Session) -> None:
    """Verify the user may access a student's data.

    Allowed:
    - system_admin (global), OR
    - the primary teacher or co-teacher of a classroom containing the student.

    (#3804) The org_admin/org_owner-of-the-student's-org bypass is retired —
    school/org no longer grants reach into a student's data under the
    school-as-label model. Raises 403 otherwise.
    """
    if is_system_admin(user.id, db):
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
                    ClassroomTeacher.status == "accepted",
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
