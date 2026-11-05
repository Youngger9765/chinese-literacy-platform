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
from ..models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from ..models.user import Role, User, UserRole

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


def is_school_teacher(user: User, school_id, db: Session) -> bool:
    """True if the user holds an active, school-scoped `teacher` role here.

    Claude Security find_01RzZ2bXyjs6SrNmD7KkKy91 (high), recommendation
    part 3: create_classroom used to gate on bare `is_school_member`, which
    counts ANY school-scoped role — including `student` (granted
    automatically on classroom join-by-code, or via self-activation of a
    student row). Classroom creation specifically needs this narrower
    check; `is_school_member` stays as-is for the places that genuinely
    only care about "any standing at this school".
    """
    if school_id is None:
        return False
    return (
        db.query(UserRole.id)
        .join(Role, UserRole.role_id == Role.id)
        .filter(
            UserRole.user_id == user.id,
            UserRole.is_active == True,  # noqa: E712
            Role.name == "teacher",
            UserRole.scope_type == "school",
            UserRole.scope_id == str(school_id),
        )
        .first()
        is not None
    )


def _is_classroom_owner(user: User, classroom: Classroom) -> bool:
    return classroom.teacher_id == user.id


def _is_classroom_co_teacher(user: User, classroom_id: int, db: Session) -> bool:
    """True for an ACCEPTED co-teacher (either role). A still-'pending'
    invitation grants no access (#3820)."""
    return (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom_id,
            ClassroomTeacher.teacher_id == user.id,
            ClassroomTeacher.status == "accepted",
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


def _owns_or_co_teaches_a_classroom_at_school(user: User, school_id, db: Session) -> bool:
    """True if the user owns, or co-teaches, AT LEAST ONE classroom at this school.

    (#3804 security review, 2026-11-01) Declaring a school via self-serve
    activation is now a trivial, zero-friction action — ANYONE can type an
    existing school's exact name and become an `is_school_member`. Before
    this fix, `_can_view_school_roster` used `is_school_member` alone, which
    meant that single step also handed over the full member roster (names +
    emails) and the full classroom list of every teacher at that school.
    That was tolerable when "becoming a member" required an admin's action;
    it is not once anyone can self-activate into it. This is also more
    consistent with this module's own stated model ("permission now only
    looks at classroom ownership/membership" — see module docstring): a
    bare school-scoped role with zero classrooms is a label, not ownership.
    """
    owns = (
        db.query(Classroom)
        .filter(Classroom.school_id == school_id, Classroom.teacher_id == user.id)
        .first()
        is not None
    )
    if owns:
        return True
    return (
        db.query(ClassroomTeacher)
        .join(Classroom, ClassroomTeacher.classroom_id == Classroom.id)
        .filter(
            Classroom.school_id == school_id,
            ClassroomTeacher.teacher_id == user.id,
            # #3820: a still-'pending' invitation does not count as co-teaching.
            ClassroomTeacher.status == "accepted",
        )
        .first()
        is not None
    )


def _is_self_activated_school(school_id, db: Session) -> bool:
    """True if this School was created by #3804 self-serve activation
    (POST /users/me/activate-teacher creating a brand-new school on the fly)
    rather than by an admin/import. See School.settings["created_via"]."""
    school = db.get(School, school_id)
    return bool(school and school.settings and school.settings.get("created_via") == "self_activation")


def _can_view_school_roster(user: User, resource_id, db: Session) -> bool:
    """Members/classrooms rosters for a school are visible only to teachers
    who own or co-teach a classroom there — NOT to every school-scoped
    member (see _owns_or_co_teaches_a_classroom_at_school).

    (#3804 security review finding #5, 2026-11-01) That alone is still not
    enough for a SELF-ACTIVATED school: "own a classroom there" is itself a
    trivial, zero-friction action (anyone can type the same school name and
    POST /classrooms), so gating the roster/classroom-LIST endpoints on it
    just moves the exploit one step later rather than closing it — a
    stranger who self-activates into "台北市立大安國小" and creates one dummy
    classroom would otherwise unlock the full classroom list (names +
    teacher + student counts) of everyone else who self-activated into that
    same string. Young's point 4 (verbatim, 2026-11-01): "自助開通的老師一樣
    只看得到自己開的班、自己班上的學生。宣告了某所學校，不代表能看到那所學校的
    其他班。" For a self-activated school there is no institutional
    relationship to justify a shared roster view at all, so this returns
    False unconditionally (system_admin already bypasses in can() before
    this runs). The ordinary "my classrooms" page is unaffected — it is
    served by GET /classrooms, which already scopes to
    owns-or-co-teaches regardless of school (classroom_crud.py
    list_my_classrooms). A REAL (non-self-activated, e.g. admin-imported or
    MOE-directory) school keeps the existing "own/co-teach at least one
    classroom there" gate, since its members have an actual institutional
    relationship."""
    # (#3804, 2026-11-02 staging repro) The "own/co-teach a classroom there"
    # gate is not enough for MOE directory schools either: anyone can pick
    # 大安國小 from the directory, self-activate, create one dummy classroom
    # and then read every other teacher's classrooms and members at that
    # school. Teachers already see their own classrooms via GET /classrooms,
    # and no page calls these school-wide endpoints, so the roster is now
    # visible only to the school's designated admin (system_admin already
    # bypasses in can()). Self-activation never sets admin_user_id.
    # Self-activation DOES set admin_user_id for the first person to type a new
    # school name, so that admin is not trustworthy either: a self-activated
    # school keeps no shared roster at all (finding #5).
    if _is_self_activated_school(resource_id, db):
        return False
    school = db.query(School).filter(School.id == resource_id).first()
    return bool(school and school.admin_user_id and school.admin_user_id == user.id)


def _can_manage_semester(user: User, resource_id, db: Session) -> bool:
    """Any active member of the school may create/update/activate its semesters.

    There is no dedicated "school admin" role in active use (principal/director
    are defined but never checked anywhere) — under the school-as-label model,
    any teacher tagged to the school may manage its shared term calendar.
    """
    return is_school_member(user, resource_id)


def _can_view_student(user: User, resource_id, db: Session) -> bool:
    """Self, or a teacher (owner/ACCEPTED co-teacher) of a classroom containing
    the student. A still-'pending' invitation grants no access (#3820)."""
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
                    ClassroomTeacher.status == "accepted",
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
