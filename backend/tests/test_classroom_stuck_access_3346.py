"""Access + scoping tests for the classroom stuck-point overview (Issue #3346, batch 5).

Covers backend/app/routes/teacher/teacher_classroom_stuck.py:

    GET /api/teacher/classrooms/{classroom_id}/stuck-overview

It lists, by name, which students in a class are struggling and on which
characters. Before this file the route had no test: dropping its
`_check_classroom_access` call, or the `classroom_id` filter on enrollments,
would not turn anything red.

Least-privilege discipline (rules/testing-strategy.md): rejections use real,
authenticated low-privilege users (a teacher of another class, a co-teacher of
another class, a student enrolled in the class) — never admin. Each is paired
with a positive control (owner / co-teacher of this class / other teacher on
their own class get 200 with their own students).

Run with:
    cd backend
    python -m pytest tests/test_classroom_stuck_access_3346.py -v
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth.password import hash_password
from app.database import get_db
from app.main import app
from app.models import Base
from app.models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from app.models.session import CharacterError, LearningSession
from app.models.user import User

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password1!"

U: dict[str, int] = {}
C: dict[str, int] = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(db, key: str) -> User:
    user = User(
        email=f"stk3346_{key}@example.com",
        username=f"stk3346_{key}",
        password_hash=hash_password(PASSWORD),
        name=key,
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    U[key] = user.id
    return user


def _stuck_on(db, student_id: int, char: str) -> None:
    """One session with CHARACTER_ERROR_THRESHOLD (3) errors on the same char."""
    s = LearningSession(student_id=student_id, story_slug="stk-text", status="completed")
    db.add(s)
    db.flush()
    db.add_all([CharacterError(session_id=s.id, character=char, error_type="misread") for _ in range(3)])


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    school = School(name="STK 3346 School")
    db.add(school)
    db.flush()

    owner = _user(db, "owner")
    co_teacher = _user(db, "co_teacher")
    other_teacher = _user(db, "other_teacher")
    other_co_teacher = _user(db, "other_co_teacher")
    stuck_student = _user(db, "stuck_student")      # class A, stuck on 「蘋」
    fine_student = _user(db, "fine_student")        # class A, no stuck signal
    other_student = _user(db, "other_student")      # class B, stuck on 「鑫」

    class_a = Classroom(name="STK-A", school_id=school.id, teacher_id=owner.id, join_code="STK3346A")
    class_b = Classroom(name="STK-B", school_id=school.id, teacher_id=other_teacher.id, join_code="STK3346B")
    db.add_all([class_a, class_b])
    db.flush()
    C["a"], C["b"] = class_a.id, class_b.id

    db.add_all([
        ClassroomTeacher(classroom_id=class_a.id, teacher_id=co_teacher.id, role="assistant"),
        ClassroomTeacher(classroom_id=class_b.id, teacher_id=other_co_teacher.id, role="assistant"),
        ClassroomStudent(classroom_id=class_a.id, student_id=stuck_student.id),
        ClassroomStudent(classroom_id=class_a.id, student_id=fine_student.id),
        ClassroomStudent(classroom_id=class_b.id, student_id=other_student.id),
    ])
    _stuck_on(db, stuck_student.id, "蘋")
    _stuck_on(db, other_student.id, "鑫")
    db.commit()
    db.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


_TOKENS: dict[str, dict] = {}


def _auth(client, key: str) -> dict:
    if key not in _TOKENS:
        resp = client.post(
            "/api/auth/login",
            json={"email": f"stk3346_{key}@example.com", "password": PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        _TOKENS[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return _TOKENS[key]


def _overview(client, as_key: str, cls: str = "a"):
    return client.get(
        f"/api/teacher/classrooms/{C[cls]}/stuck-overview",
        headers=_auth(client, as_key),
    )


class TestStuckOverviewAccess:
    @pytest.mark.parametrize("as_key", ["owner", "co_teacher"])
    def test_staff_of_this_class_gets_200(self, client, as_key):
        r = _overview(client, as_key)
        assert r.status_code == 200, r.text
        assert [s["student_id"] for s in r.json()["students"]] == [U["stuck_student"]]

    def test_other_teacher_gets_200_on_own_class(self, client):
        # positive control for the other_teacher / other_co_teacher denials
        r = _overview(client, "other_teacher", "b")
        assert r.status_code == 200, r.text
        assert [s["student_id"] for s in r.json()["students"]] == [U["other_student"]]

    @pytest.mark.parametrize("as_key", ["other_teacher", "other_co_teacher", "stuck_student", "fine_student"])
    def test_user_without_access_to_this_class_gets_403(self, client, as_key):
        r = _overview(client, as_key)
        assert r.status_code == 403, r.text
        assert "students" not in r.json()

    def test_unauthenticated_gets_401(self, client):
        assert client.get(f"/api/teacher/classrooms/{C['a']}/stuck-overview").status_code == 401

    def test_missing_classroom_gets_404(self, client):
        r = client.get("/api/teacher/classrooms/999999/stuck-overview", headers=_auth(client, "owner"))
        assert r.status_code == 404


class TestStuckOverviewScoping:
    def test_only_this_class_and_only_stuck_students(self, client):
        body = _overview(client, "owner").json()
        assert body["total_stuck"] == 1
        (only,) = body["students"]
        assert only["student_name"] == "stuck_student"
        assert only["top_stuck_characters"] == ["蘋"]
        assert only["character_stuck_count"] == 1

    def test_other_class_stuck_character_does_not_leak(self, client):
        chars = {c for s in _overview(client, "owner").json()["students"] for c in s["top_stuck_characters"]}
        assert "鑫" not in chars
