"""Regression tests for the student-data access guard (Issue #3346, batch 1).

`verify_student_access` (backend/app/routes/learning/_helpers.py) is the ONE
check standing in front of 11 endpoints that return a student's learning data
(dashboard, error book, reading history, recommendations, progress). Before
this file it had no direct test: its "deny" branches were only exercised
incidentally, so dropping a filter clause (e.g. the parent link's `is_active`)
would not turn anything red.

Least-privilege discipline (rules/testing-strategy.md):
- every "must be rejected" case uses a real, authenticated user with as few
  privileges as possible — a classmate student, a teacher of a *different*
  class, a parent whose link was revoked — never an anonymous caller or an
  admin (admin would short-circuit the check and prove nothing);
- every rejection is paired with a positive control showing the same kind of
  user IS allowed when the relationship actually exists, so a green "403"
  cannot simply mean "the feature is broken for everyone".

`get_owned_session` (same file) guards single-session routes and is covered
the same way.

Run with:
    cd backend
    python -m pytest tests/test_verify_student_access_3346.py -v
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.password import hash_password
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.parent_link import ParentStudentLink
from app.models.school import Classroom, ClassroomStudent, School
from app.models.session import LearningSession
from app.models.user import User
from app.routes.learning._helpers import get_owned_session, verify_student_access

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password1!"

# name -> user id, filled by setup_db
U: dict[str, int] = {}
S: dict[str, int] = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(db, key: str) -> User:
    user = User(
        email=f"vsa3346_{key}@example.com",
        username=f"vsa3346_{key}",
        password_hash=hash_password(PASSWORD),
        name=key,
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    U[key] = user.id
    return user


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    school = School(name="VSA 3346 School")
    db.add(school)
    db.flush()

    teacher_a = _user(db, "teacher_a")          # teaches class A (student + classmate)
    teacher_b = _user(db, "teacher_b")          # teaches class B (other_student only)
    student = _user(db, "student")              # the target
    classmate = _user(db, "classmate")          # same class as target, no special role
    other_student = _user(db, "other_student")  # in class B
    parent = _user(db, "parent")                # active link to target
    revoked_parent = _user(db, "revoked_parent")  # link to target, is_active=False
    other_parent = _user(db, "other_parent")    # active link to other_student only

    class_a = Classroom(name="A", school_id=school.id, teacher_id=teacher_a.id, join_code="VSA3346A")
    class_b = Classroom(name="B", school_id=school.id, teacher_id=teacher_b.id, join_code="VSA3346B")
    db.add_all([class_a, class_b])
    db.flush()

    db.add_all([
        ClassroomStudent(classroom_id=class_a.id, student_id=student.id),
        ClassroomStudent(classroom_id=class_a.id, student_id=classmate.id),
        ClassroomStudent(classroom_id=class_b.id, student_id=other_student.id),
        ParentStudentLink(parent_id=parent.id, student_id=student.id, is_active=True),
        ParentStudentLink(parent_id=revoked_parent.id, student_id=student.id, is_active=False),
        ParentStudentLink(parent_id=other_parent.id, student_id=other_student.id, is_active=True),
    ])

    session = LearningSession(student_id=student.id, status="in_progress")
    db.add(session)
    db.commit()
    S["student_session"] = session.id
    db.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def _get(db, key: str) -> User:
    return db.get(User, U[key])


def _assert_denied(fn, *args, status: int = 403):
    with pytest.raises(HTTPException) as exc:
        fn(*args)
    assert exc.value.status_code == status, exc.value.detail


# ---------------------------------------------------------------------------
# verify_student_access — unit level
# ---------------------------------------------------------------------------


class TestVerifyStudentAccessAllowed:
    """Positive controls: each legitimate relationship is let through."""

    def test_student_can_access_own_data(self, db):
        verify_student_access(U["student"], _get(db, "student"), db)

    def test_teacher_of_students_class_can_access(self, db):
        verify_student_access(U["student"], _get(db, "teacher_a"), db)

    def test_actively_linked_parent_can_access(self, db):
        verify_student_access(U["student"], _get(db, "parent"), db)

    def test_other_parent_can_access_own_child(self, db):
        # control for test_parent_cannot_access_a_child_they_are_not_linked_to
        verify_student_access(U["other_student"], _get(db, "other_parent"), db)

    def test_teacher_b_can_access_own_student(self, db):
        # control for test_teacher_of_another_class_is_denied
        verify_student_access(U["other_student"], _get(db, "teacher_b"), db)


class TestVerifyStudentAccessDenied:
    """Least-privilege rejections — real, authenticated, unrelated users."""

    def test_classmate_student_is_denied(self, db):
        # Same classroom is NOT a reason to see someone else's data.
        _assert_denied(verify_student_access, U["student"], _get(db, "classmate"), db)

    def test_student_in_another_class_is_denied(self, db):
        _assert_denied(verify_student_access, U["student"], _get(db, "other_student"), db)

    def test_teacher_of_another_class_is_denied(self, db):
        _assert_denied(verify_student_access, U["student"], _get(db, "teacher_b"), db)

    def test_teacher_cannot_reach_student_outside_their_class(self, db):
        # teacher_a teaches *a* class — just not the one other_student is in.
        _assert_denied(verify_student_access, U["other_student"], _get(db, "teacher_a"), db)

    def test_revoked_parent_link_is_denied(self, db):
        # is_active=False must close access; the row still exists.
        _assert_denied(verify_student_access, U["student"], _get(db, "revoked_parent"), db)

    def test_parent_cannot_access_a_child_they_are_not_linked_to(self, db):
        _assert_denied(verify_student_access, U["student"], _get(db, "other_parent"), db)

    def test_target_student_cannot_access_their_parent_or_teacher(self, db):
        # Relationships are one-directional: the student is not the teacher.
        _assert_denied(verify_student_access, U["teacher_a"], _get(db, "student"), db)
        _assert_denied(verify_student_access, U["parent"], _get(db, "student"), db)


# ---------------------------------------------------------------------------
# get_owned_session — unit level
# ---------------------------------------------------------------------------


class TestGetOwnedSession:
    def test_owner_gets_the_session(self, db):
        session = get_owned_session(S["student_session"], _get(db, "student"), db)
        assert session.id == S["student_session"]

    def test_classmate_cannot_get_someone_elses_session(self, db):
        _assert_denied(get_owned_session, S["student_session"], _get(db, "classmate"), db)

    def test_even_the_students_teacher_cannot_use_owned_session(self, db):
        # "owned" means owned — this helper is stricter than verify_student_access.
        _assert_denied(get_owned_session, S["student_session"], _get(db, "teacher_a"), db)

    def test_missing_session_is_404(self, db):
        _assert_denied(get_owned_session, 999_999, _get(db, "student"), db, status=404)


# ---------------------------------------------------------------------------
# Wiring: the guard is actually on a real endpoint
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _token(client, key: str) -> dict:
    resp = client.post(
        "/api/auth/login",
        json={"email": f"vsa3346_{key}@example.com", "password": PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


class TestDashboardEndpointWiring:
    """GET /api/learning/students/{id}/dashboard goes through the guard."""

    def _dashboard(self, client, as_key: str, of_key: str):
        return client.get(
            f"/api/learning/students/{U[of_key]}/dashboard",
            headers=_token(client, as_key),
        )

    def test_self_gets_200(self, client):
        r = self._dashboard(client, "student", "student")
        assert r.status_code == 200, r.text
        assert "total_sessions" in r.json()

    def test_revoked_parent_gets_403(self, client):
        assert self._dashboard(client, "revoked_parent", "student").status_code == 403

    def test_active_parent_gets_200(self, client):
        assert self._dashboard(client, "parent", "student").status_code == 200

    def test_classmate_gets_403(self, client):
        assert self._dashboard(client, "classmate", "student").status_code == 403

    def test_unauthenticated_gets_401(self, client):
        r = client.get(f"/api/learning/students/{U['student']}/dashboard")
        assert r.status_code == 401
