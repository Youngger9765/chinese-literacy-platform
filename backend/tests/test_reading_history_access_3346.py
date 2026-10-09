"""Access/isolation tests for the repeated-reading history routes (Issue #3346, batch 2).

Covers backend/app/routes/learning/learning_reading_history.py:

    POST /api/reading-history                               — write own attempt
    GET  /api/reading-history/{student_id}/{lesson_id}         — list attempts
    GET  /api/reading-history/{student_id}/{lesson_id}/summary — stats

Before this file the two GET routes had no test at all, so removing the
`verify_student_access` call (or the `student_id` filter in the query) would
not turn anything red: any logged-in user could read any child's reading
speed / accuracy history by guessing an integer id.

Least-privilege discipline (rules/testing-strategy.md):
- every "must be rejected" case uses a real, authenticated user with as few
  privileges as possible — a classmate, a teacher of another class, a revoked
  parent — never anonymous or admin;
- every rejection is paired with a positive control (owner / own teacher /
  active parent gets 200 *with the expected rows*), so a green 403 cannot
  simply mean "the route is broken for everyone".

Run with:
    cd backend
    python -m pytest tests/test_reading_history_access_3346.py -v
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
from app.models.parent_link import ParentStudentLink
from app.models.reading_history import ReadingHistory
from app.models.school import Classroom, ClassroomStudent, School
from app.models.user import User

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password1!"
LESSON = "L3346-RH"

U: dict[str, int] = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(db, key: str) -> User:
    user = User(
        email=f"rh3346_{key}@example.com",
        username=f"rh3346_{key}",
        password_hash=hash_password(PASSWORD),
        name=key,
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()
    U[key] = user.id
    return user


def _attempt(student_id: int, cpm: float, accuracy: float = 90.0) -> ReadingHistory:
    return ReadingHistory(
        student_id=student_id,
        lesson_id=LESSON,
        reading_type="full",
        cpm=cpm,
        accuracy=accuracy,
        duration_seconds=60.0,
    )


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    school = School(name="RH 3346 School")
    db.add(school)
    db.flush()

    teacher_a = _user(db, "teacher_a")          # teaches the target student
    teacher_b = _user(db, "teacher_b")          # teaches another class
    student = _user(db, "student")              # the target
    classmate = _user(db, "classmate")          # same class, no special role
    other_student = _user(db, "other_student")  # class B
    _user(db, "parent")                         # active link to student
    _user(db, "revoked_parent")                 # is_active=False link to student
    _user(db, "writer")                         # only used by the POST tests

    class_a = Classroom(name="A", school_id=school.id, teacher_id=teacher_a.id, join_code="RH3346AA")
    class_b = Classroom(name="B", school_id=school.id, teacher_id=teacher_b.id, join_code="RH3346BB")
    db.add_all([class_a, class_b])
    db.flush()

    db.add_all([
        ClassroomStudent(classroom_id=class_a.id, student_id=student.id),
        ClassroomStudent(classroom_id=class_a.id, student_id=classmate.id),
        ClassroomStudent(classroom_id=class_b.id, student_id=other_student.id),
        ParentStudentLink(parent_id=U["parent"], student_id=student.id, is_active=True),
        ParentStudentLink(parent_id=U["revoked_parent"], student_id=student.id, is_active=False),
        # Target student: 2 attempts. Classmate: 1 attempt on the SAME lesson
        # with distinctive numbers, so a dropped student_id filter is visible.
        _attempt(student.id, cpm=50.0),
        _attempt(student.id, cpm=60.0),
        _attempt(classmate.id, cpm=999.0, accuracy=11.0),
    ])
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
            json={"email": f"rh3346_{key}@example.com", "password": PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        _TOKENS[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return _TOKENS[key]


def _history(client, as_key: str, of_key: str):
    return client.get(f"/api/reading-history/{U[of_key]}/{LESSON}", headers=_auth(client, as_key))


def _summary(client, as_key: str, of_key: str):
    return client.get(f"/api/reading-history/{U[of_key]}/{LESSON}/summary", headers=_auth(client, as_key))


ALLOWED = ["student", "teacher_a", "parent"]
DENIED = ["classmate", "other_student", "teacher_b", "revoked_parent"]


# ---------------------------------------------------------------------------
# GET /reading-history/{student_id}/{lesson_id}
# ---------------------------------------------------------------------------


class TestHistoryAccess:
    @pytest.mark.parametrize("as_key", ALLOWED)
    def test_related_user_gets_the_students_rows(self, client, as_key):
        r = _history(client, as_key, "student")
        assert r.status_code == 200, r.text
        cpms = [row["cpm"] for row in r.json()["history"]]
        assert cpms == [50.0, 60.0]

    @pytest.mark.parametrize("as_key", DENIED)
    def test_unrelated_user_is_denied(self, client, as_key):
        r = _history(client, as_key, "student")
        assert r.status_code == 403, r.text
        assert "history" not in r.json()

    def test_unauthenticated_is_401(self, client):
        r = client.get(f"/api/reading-history/{U['student']}/{LESSON}")
        assert r.status_code == 401

    def test_own_history_does_not_include_classmates_rows(self, client):
        # The classmate read the same lesson; their 999 cpm must not leak in.
        rows = _history(client, "student", "student").json()["history"]
        assert {row["student_id"] for row in rows} == {U["student"]}

    def test_classmate_sees_only_their_own_row(self, client):
        # positive control for the isolation test above
        rows = _history(client, "classmate", "classmate").json()["history"]
        assert [row["cpm"] for row in rows] == [999.0]


# ---------------------------------------------------------------------------
# GET /reading-history/{student_id}/{lesson_id}/summary
# ---------------------------------------------------------------------------


class TestSummaryAccess:
    @pytest.mark.parametrize("as_key", ALLOWED)
    def test_related_user_gets_the_students_summary(self, client, as_key):
        r = _summary(client, as_key, "student")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_attempts"] == 2
        assert body["best_cpm"] == 60.0

    @pytest.mark.parametrize("as_key", DENIED)
    def test_unrelated_user_is_denied(self, client, as_key):
        r = _summary(client, as_key, "student")
        assert r.status_code == 403, r.text
        assert "best_cpm" not in r.json()

    def test_unauthenticated_is_401(self, client):
        r = client.get(f"/api/reading-history/{U['student']}/{LESSON}/summary")
        assert r.status_code == 401

    def test_summary_is_not_polluted_by_classmates_attempt(self, client):
        body = _summary(client, "student", "student").json()
        assert body["best_cpm"] != 999.0
        assert body["best_accuracy"] == 90.0


# ---------------------------------------------------------------------------
# POST /reading-history — always writes as the caller
# ---------------------------------------------------------------------------


class TestSaveWritesAsCaller:
    def test_body_student_id_is_ignored(self, client):
        # A student cannot plant an attempt in someone else's history by
        # sending student_id in the body.
        r = client.post(
            "/api/reading-history",
            headers=_auth(client, "writer"),
            json={
                "student_id": U["student"],
                "lesson_id": LESSON + "-W",
                "cpm": 77.0,
                "accuracy": 80.0,
                "duration_seconds": 30.0,
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["student_id"] == U["writer"]

        db = TestingSessionLocal()
        try:
            rows = db.query(ReadingHistory).filter(ReadingHistory.lesson_id == LESSON + "-W").all()
            assert [(row.student_id, row.cpm) for row in rows] == [(U["writer"], 77.0)]
        finally:
            db.close()

    def test_unauthenticated_post_is_401(self, client):
        r = client.post(
            "/api/reading-history",
            json={"lesson_id": LESSON, "cpm": 1.0, "accuracy": 1.0, "duration_seconds": 1.0},
        )
        assert r.status_code == 401
