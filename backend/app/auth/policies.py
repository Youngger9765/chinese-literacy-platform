"""Centralized authorization policies for LingoLeap.

Single source of truth for classroom/student access control.
All route modules should import from here instead of implementing their own checks.
"""
import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models.school import Classroom, ClassroomStudent, ClassroomTeacher
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


def require_classroom_owner(classroom: Classroom, user: User, db: Session) -> None:
    """Allow classroom primary teacher OR system/org admin. Raise 403 otherwise.

    Use for write operations (update, delete, assign).
    Co-teachers (assistants) are NOT allowed for write ops.
    """
    if classroom.teacher_id == user.id:
        return
    if is_admin(user.id, db):
        return
    raise HTTPException(status_code=403, detail="Not your classroom")


def require_classroom_member(classroom: Classroom, user: User, db: Session) -> None:
    """Allow classroom owner, co-teachers, or system/org admins. Raise 403 otherwise.

    Use for read operations (view students, progress).
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
    if is_admin(user.id, db):
        return
    raise HTTPException(status_code=403, detail="Not your classroom")


def require_student_visible_to_teacher(student_id: int, user: User, db: Session) -> None:
    """Verify teacher (primary or co-teacher) has access to a student, OR user is admin.

    A student is visible to a teacher if:
    - The teacher owns a classroom containing the student (primary teacher), OR
    - The teacher is a co-teacher of a classroom containing the student, OR
    - The user is a system/org admin

    Raises 403 if none of the above.
    """
    if is_admin(user.id, db):
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
