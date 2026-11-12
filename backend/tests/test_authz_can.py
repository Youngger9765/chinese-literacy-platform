"""Unit tests for app/auth/authz.py — the centralized can() permission table (#3804).

Pure unit tests against an in-memory SQLite DB (no HTTP layer) so the policy
table itself is locked independently of which routes call it.

Matrix: role x resource, each paired with a negative control (own resource
passes, someone else's resource / a different person is denied) so a
mutation that makes a check return True unconditionally gets caught.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.authz import can, is_school_member
from app.models import Base
from app.models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from app.models.user import Role, User, UserRole

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _fk(dbapi_connection, connection_record):
    cur = dbapi_connection.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


def _make_user(db, email: str) -> User:
    u = User(email=email, password_hash="x", name=email, is_active=True)
    db.add(u)
    db.flush()
    return u


def _assign_role(db, user: User, role_name: str, scope_type: str, scope_id: str | None) -> None:
    role = db.query(Role).filter(Role.name == role_name).first()
    if role is None:
        role = Role(name=role_name, display_name=role_name, scope_level=scope_type)
        db.add(role)
        db.flush()
    db.add(UserRole(user_id=user.id, role_id=role.id, scope_type=scope_type, scope_id=scope_id))
    db.flush()


@pytest.fixture
def world(db):
    """Two schools (A, B), one classroom each, a system_admin, and a
    leftover org_admin role holder scoped to an org that contains school A
    — to prove org_admin no longer grants anything under can()."""
    school_a = School(name="School A")
    school_b = School(name="School B")
    db.add_all([school_a, school_b])
    db.flush()

    teacher_a = _make_user(db, "teacher_a@test.example")
    _assign_role(db, teacher_a, "teacher", "school", str(school_a.id))

    teacher_b = _make_user(db, "teacher_b@test.example")
    _assign_role(db, teacher_b, "teacher", "school", str(school_b.id))

    co_teacher = _make_user(db, "co_teacher@test.example")
    _assign_role(db, co_teacher, "teacher", "school", str(school_a.id))

    student_a = _make_user(db, "student_a@test.example")
    _assign_role(db, student_a, "student", "school", str(school_a.id))

    stranger = _make_user(db, "stranger@test.example")

    sysadmin = _make_user(db, "sysadmin@test.example")
    _assign_role(db, sysadmin, "system_admin", "platform", None)

    # A user holding a legacy org_admin role scoped to an org — should grant
    # NOTHING under the new model, even though school_a used to belong to
    # that org under the old three-tier hierarchy.
    from app.models.organization import Organization

    org = Organization(name="Legacy Org")
    db.add(org)
    db.flush()
    school_a.organization_id = org.id
    org_admin = _make_user(db, "org_admin@test.example")
    _assign_role(db, org_admin, "org_admin", "organization", str(org.id))

    classroom_a = Classroom(school_id=school_a.id, teacher_id=teacher_a.id, name="班級 A", is_active=True)
    db.add(classroom_a)
    db.flush()
    db.add(ClassroomTeacher(classroom_id=classroom_a.id, teacher_id=co_teacher.id, role="editor"))
    db.add(ClassroomStudent(classroom_id=classroom_a.id, student_id=student_a.id))
    db.commit()

    return {
        "school_a": school_a,
        "school_b": school_b,
        "teacher_a": teacher_a,
        "teacher_b": teacher_b,
        "co_teacher": co_teacher,
        "student_a": student_a,
        "stranger": stranger,
        "sysadmin": sysadmin,
        "org_admin": org_admin,
        "classroom_a": classroom_a,
    }


# ---------------------------------------------------------------------------
# is_school_member
# ---------------------------------------------------------------------------


def test_is_school_member_true_for_own_school(world):
    assert is_school_member(world["teacher_a"], world["school_a"].id) is True


def test_is_school_member_false_for_other_school(world):
    assert is_school_member(world["teacher_a"], world["school_b"].id) is False


def test_is_school_member_false_for_stranger(world):
    assert is_school_member(world["stranger"], world["school_a"].id) is False


# ---------------------------------------------------------------------------
# classroom
# ---------------------------------------------------------------------------


def test_owner_can_view_and_manage_own_classroom(world, db):
    assert can(world["teacher_a"], "view", "classroom", world["classroom_a"].id, db) is True
    assert can(world["teacher_a"], "manage", "classroom", world["classroom_a"].id, db) is True


def test_co_teacher_can_view_but_not_manage(world, db):
    assert can(world["co_teacher"], "view", "classroom", world["classroom_a"].id, db) is True
    assert can(world["co_teacher"], "manage", "classroom", world["classroom_a"].id, db) is False


def test_stranger_cannot_view_or_manage_classroom(world, db):
    assert can(world["stranger"], "view", "classroom", world["classroom_a"].id, db) is False
    assert can(world["stranger"], "manage", "classroom", world["classroom_a"].id, db) is False


def test_other_school_teacher_cannot_view_classroom(world, db):
    """Negative control: teacher_b has no relationship to classroom_a at all."""
    assert can(world["teacher_b"], "view", "classroom", world["classroom_a"].id, db) is False


def test_org_admin_of_the_schools_org_cannot_view_or_manage_classroom(world, db):
    """Core assertion of #3804: org_admin's cross-tenant bypass is gone.

    org_admin here is scoped to the organization that owns school_a (the
    classroom's school), which under the OLD model granted view+manage via
    _is_org_admin_of_school(). Under the new model it must be denied exactly
    like any other stranger.
    """
    assert can(world["org_admin"], "view", "classroom", world["classroom_a"].id, db) is False
    assert can(world["org_admin"], "manage", "classroom", world["classroom_a"].id, db) is False


# ---------------------------------------------------------------------------
# school / school_roster
# ---------------------------------------------------------------------------


def test_stranger_cannot_view_school_detail_yet(world, db):
    """School "view" stays membership-gated until the Phase 2 open directory
    (PRD #3804 §4) ships a public-safe representation without join_code."""
    assert can(world["stranger"], "view", "school", world["school_a"].id, db) is False


def test_member_can_view_school_detail(world, db):
    assert can(world["teacher_a"], "view", "school", world["school_a"].id, db) is True


def test_non_admin_cannot_manage_school_directory(world, db):
    assert can(world["teacher_a"], "manage", "school", world["school_a"].id, db) is False


def test_classroom_owner_cannot_view_whole_school_roster(world, db):
    # #3804 (2026-11-02, staging repro): any account can self-activate into a
    # MOE directory school and create one classroom there, so "owns a
    # classroom at the school" is not a trust signal. Young 2026-11-01:
    # 「宣告了某所學校，不代表能看到那所學校的其他班」. Teachers see their own
    # classrooms via GET /classrooms; the school-wide roster is admin-only.
    assert can(world["teacher_a"], "view", "school_roster", world["school_a"].id, db) is False


def test_school_admin_user_can_view_roster(world, db):
    school = world["school_a"]
    school.admin_user_id = world["teacher_b"].id
    db.commit()
    assert can(world["teacher_b"], "view", "school_roster", school.id, db) is True


def test_non_member_cannot_view_roster(world, db):
    assert can(world["teacher_b"], "view", "school_roster", world["school_a"].id, db) is False


def test_org_admin_of_the_school_cannot_view_roster_without_membership(world, db):
    assert can(world["org_admin"], "view", "school_roster", world["school_a"].id, db) is False


# ---------------------------------------------------------------------------
# semester
# ---------------------------------------------------------------------------


def test_bare_school_member_cannot_manage_semester(world, db):
    """Was test_school_member_can_manage_semester, asserting True -- that
    WAS find_01DygBxNaTFMHa8cgm2yhHRm (medium, CWE-863), 2026-11-06:
    _can_manage_semester used to be bare is_school_member, and self-serve
    school membership is a trivial, zero-friction action (anyone can
    self-activate into an existing school by name/MOE code). A write this
    consequential (mass-expires every OTHER teacher's classroom texts at
    the school once activated) needs a verified management relationship,
    not just "has some role here" -- teacher_a has an ordinary teacher
    role at school_a but is NOT its designated admin (school_a.admin_user_id
    is unset), so this must now be False. See
    test_designated_school_admin_can_manage_semester for the positive case."""
    assert can(world["teacher_a"], "manage", "semester", world["school_a"].id, db) is False


def test_designated_school_admin_can_manage_semester(world, db):
    """Positive control for the tightened rule: a verified management
    relationship (school.admin_user_id == caller) still works."""
    world["school_a"].admin_user_id = world["teacher_a"].id
    db.commit()
    assert can(world["teacher_a"], "manage", "semester", world["school_a"].id, db) is True


def test_non_member_cannot_manage_semester(world, db):
    assert can(world["teacher_b"], "manage", "semester", world["school_a"].id, db) is False


# ---------------------------------------------------------------------------
# student
# ---------------------------------------------------------------------------


def test_self_can_view_own_student_record(world, db):
    assert can(world["student_a"], "view", "student", world["student_a"].id, db) is True


def test_owning_teacher_can_view_student(world, db):
    assert can(world["teacher_a"], "view", "student", world["student_a"].id, db) is True


def test_co_teacher_can_view_student(world, db):
    assert can(world["co_teacher"], "view", "student", world["student_a"].id, db) is True


def test_unrelated_teacher_cannot_view_student(world, db):
    assert can(world["teacher_b"], "view", "student", world["student_a"].id, db) is False


def test_org_admin_cannot_view_student_without_a_classroom_relationship(world, db):
    assert can(world["org_admin"], "view", "student", world["student_a"].id, db) is False


# ---------------------------------------------------------------------------
# system_admin global bypass
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "resource_type,resource_key,action",
    [
        ("classroom", "classroom_a", "view"),
        ("classroom", "classroom_a", "manage"),
        ("school", "school_a", "view"),
        ("school", "school_a", "manage"),
        ("school_roster", "school_a", "view"),
        ("semester", "school_a", "manage"),
    ],
)
def test_system_admin_bypasses_every_policy(world, db, resource_type, resource_key, action):
    resource = world[resource_key]
    resource_id = resource.id
    assert can(world["sysadmin"], action, resource_type, resource_id, db) is True


def test_system_admin_can_view_any_student(world, db):
    assert can(world["sysadmin"], "view", "student", world["student_a"].id, db) is True


def test_unknown_policy_raises(world, db):
    """can() must fail loudly, not silently allow, for an unregistered (type, action)."""
    with pytest.raises(ValueError):
        can(world["teacher_a"], "manage", "student", world["student_a"].id, db)
