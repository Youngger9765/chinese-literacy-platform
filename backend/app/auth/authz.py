"""authz.py — centralized authorization: can(user, action, resource_type, resource_id, db).

Issue #3804: LingoLeap used to be a three-tier multi-tenant model
(Organization -> School -> Classroom), where an org_admin/org_owner role
scoped to an Organization could reach into every School/Classroom/User/
Feedback/Gamification record that happened to belong to that org. That
cross-tenant bypass is retired (Young's 2026-11-01 decision): permission
now only looks at classroom ownership/membership (+ system_admin as the
sole global exception). School becomes a reference label a teacher is
tagged with, not a permission boundary.

This module is the single source of truth for that decision. It is
deliberately NOT a rewrite of every one of the 140+ existing endpoints —
only the resource types below are centralized here; routes whose checks
were already a flat role whitelist unrelated to org/school tenancy
(e.g. testset recordings, worksheet downloads) are untouched because
they were never part of the three-tier model this refactor simplifies.

Usage:
    from app.auth.authz import can

    if not can(current_user, "view", "classroom", classroom_id, db):
        raise HTTPException(status_code=403, detail="...")
"""
from __future__ import annotations

from typing import Callable, Literal

from sqlalchemy.orm import Session

from .policies import is_system_admin
from ..models.school import Classroom, ClassroomStudent, ClassroomTeacher
from ..models.user import User

Action = Literal["view", "manage"]
ResourceType = Literal["classroom", "school", "school_roster", "student", "semester"]

_PolicyFn = Callable[[User, object, Session], bool]


def is_school_member(user: User, school_id, db: Session | None = None) -> bool:
    """True if the user holds ANY active UserRole scoped to this school.

    This is the one and only "does this person belong to this school" check
    — it replaces the old org->school hierarchy walk. Any role (teacher,
    student, principal, director, staff) scoped to the school counts; this
    function does not distinguish role *kind*, only membership.
    """
    if school_id is None:
        return False
    school_id_str = str(school_id)
    return any(
        ur.is_active and ur.scope_type == "school" and ur.scope_id == school_id_str
        for ur in user.user_roles
    )


def _is_classroom_owner(user: User, classroom: Classroom) -> bool:
    return classroom.teacher_id == user.id


def _is_classroom_co_teacher(user: User, classroom_id: int, db: Session) -> bool:
    return (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom_id,
            ClassroomTeacher.teacher_id == user.id,
        )
        .first()
        is not None
    )


def _get_classroom(resource_id, db: Session) -> Classroom | None:
    if isinstance(resource_id, Classroom):
        return resource_id
    return db.query(Classroom).filter(Classroom.id == resource_id).first()


def _can_view_classroom(user: User, resource_id, db: Session) -> bool:
    """Owner, or a co-teacher, may view a classroom. Unknown classroom = deny."""
    classroom = _get_classroom(resource_id, db)
    if classroom is None:
        return False
    if _is_classroom_owner(user, classroom):
        return True
    return _is_classroom_co_teacher(user, classroom.id, db)


def _can_manage_classroom(user: User, resource_id, db: Session) -> bool:
    """Only the primary teacher (owner) may manage (write) a classroom.

    Co-teachers are read-only by design (mirrors policies.require_classroom_owner).
    """
    classroom = _get_classroom(resource_id, db)
    if classroom is None:
        return False
    return _is_classroom_owner(user, classroom)


def _can_view_school(user: User, resource_id, db: Session) -> bool:
    """School is becoming a reference directory, but for now stays membership-gated.

    The target end-state (PRD #3804 §2 point 3) is "any authenticated caller
    can read the directory" — but SchoolResponse still returns join_code on
    every read, and the Phase 2 work that would give schools a public-safe
    representation (MOE school code import, registration search) hasn't
    landed. Until then, "view" is scoped the same as school_roster: system
    admin (handled by can() before this runs) or an active member of this
    school. Widening this is tracked in PRD #3804 §4.
    """
    return is_school_member(user, resource_id)


def _can_manage_school(user: User, resource_id, db: Session) -> bool:
    """Only system_admin may edit the shared school directory.

    can() already lets system_admin through before this function runs, so a
    non-admin caller always gets False here — the directory has no "owner"
    teacher under the new model.
    """
    return False


def _can_view_school_roster(user: User, resource_id, db: Session) -> bool:
    """Members/classrooms rosters for a school are visible to its own members only."""
    return is_school_member(user, resource_id)


def _can_manage_semester(user: User, resource_id, db: Session) -> bool:
    """Any active member of the school may create/update/activate its semesters.

    There is no dedicated "school admin" role in active use (principal/director
    are defined but never checked anywhere) — under the school-as-label model,
    any teacher tagged to the school may manage its shared term calendar.
    """
    return is_school_member(user, resource_id)


def _can_view_student(user: User, resource_id, db: Session) -> bool:
    """Self, or a teacher (owner/co-teacher) of a classroom containing the student."""
    student_id = resource_id
    if user.id == student_id:
        return True
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
    return enrollment is not None


_POLICY_TABLE: dict[tuple[ResourceType, Action], _PolicyFn] = {
    ("classroom", "view"): _can_view_classroom,
    ("classroom", "manage"): _can_manage_classroom,
    ("school", "view"): _can_view_school,
    ("school", "manage"): _can_manage_school,
    ("school_roster", "view"): _can_view_school_roster,
    ("semester", "manage"): _can_manage_semester,
    ("student", "view"): _can_view_student,
}


def can(user: User, action: Action, resource_type: ResourceType, resource_id, db: Session) -> bool:
    """Single source of truth for authorization decisions (#3804).

    system_admin is the one global exception and always returns True.
    Everything else is dispatched through _POLICY_TABLE — every entry there
    is "classroom ownership", "school membership", or "self" — never org
    membership, never organization_id, never an org_admin/org_owner role.
    """
    if is_system_admin(user.id, db):
        return True
    policy = _POLICY_TABLE.get((resource_type, action))
    if policy is None:
        raise ValueError(f"authz.can(): no policy registered for ({resource_type!r}, {action!r})")
    return policy(user, resource_id, db)
