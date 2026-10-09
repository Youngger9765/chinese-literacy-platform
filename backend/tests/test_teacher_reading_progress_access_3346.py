"""Access/scoping tests for the teacher reading-progress routes (Issue #3346, batch 3).

Covers backend/app/routes/teacher/teacher_reading_progress.py:

    GET /api/teacher/students/{student_id}/reading-progress/{lesson_id}
    PUT /api/teacher/reading-targets/{lesson_id}

Before this file neither route had a test. The GET's only guard is
`_require_teacher_access_to_student` (teacher must own a classroom the student
is enrolled in); the PUT and the GET's target lookup are scoped by
`ReadingTarget.teacher_id == current_user.id`. Dropping any of those would not
have turned anything red.

Least-privilege discipline (rules/testing-strategy.md): rejections use real,
authenticated low-privilege users — a teacher of another class, the student
themself, the student's parent, a co-enrolled classmate — never admin. Each
is paired with the teacher who *does* own the class getting 200 with data.

Known bug NOT locked here (see PR description): the PUT has no role check, so
a student can create a ReadingTarget row. These tests deliberately do not
assert either way on that, so fixing it will not require editing this file.

Run with:
    cd backend
    python -m pytest tests/test_teacher_reading_progress_access_3346.py -v
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
from app.models.reading_history import ReadingHistory, ReadingTarget
from app.models.school import Classroom, ClassroomStudent, School
from app.models.user import User

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

PASSWORD = "Password1!"
LESSON = "L3346-TRP"
# Separate lessons so the PUT tests don't disturb the GET target assertions.
LESSON_PUT = "L3346-TRP-PUT"
LESSON_OTHER_TEACHER_TARGET = "L3346-TRP-B"

U: dict[str, int] = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(db, key: str) -> User:
    user = User(
        email=f"trp3346_{key}@example.com",
        username=f"trp3346_{key}",
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

    school = School(name="TRP 3346 School")
    db.add(school)
    db.flush()

    teacher_a = _user(db, "teacher_a")          # owns class A (student, classmate)
    teacher_b = _user(db, "teacher_b")          # owns class B (other_student)
    student = _user(db, "student")
    classmate = _user(db, "classmate")
    other_student = _user(db, "other_student")
    _user(db, "parent")

    class_a = Classroom(name="A", school_id=school.id, teacher_id=teacher_a.id, join_code="TRP3346A")
    class_b = Classroom(name="B", school_id=school.id, teacher_id=teacher_b.id, join_code="TRP3346B")
    db.add_all([class_a, class_b])
    db.flush()

    db.add_all([
        ClassroomStudent(classroom_id=class_a.id, student_id=student.id),
        ClassroomStudent(classroom_id=class_a.id, student_id=classmate.id),
        ClassroomStudent(classroom_id=class_b.id, student_id=other_student.id),
        ParentStudentLink(parent_id=U["parent"], student_id=student.id, is_active=True),
        ReadingHistory(student_id=student.id, lesson_id=LESSON, reading_type="full",
                       cpm=70.0, accuracy=95.0, duration_seconds=60.0),
        ReadingHistory(student_id=other_student.id, lesson_id=LESSON, reading_type="full",
                       cpm=33.0, accuracy=50.0, duration_seconds=60.0),
        # teacher_a's own target on LESSON; teacher_b's target on a different
        # lesson AND on LESSON (higher value) — teacher_a must only see 120.
        ReadingTarget(teacher_id=teacher_a.id, lesson_id=LESSON, target_cpm=120.0),
        ReadingTarget(teacher_id=teacher_b.id, lesson_id=LESSON, target_cpm=10.0),
        ReadingTarget(teacher_id=teacher_b.id, lesson_id=LESSON_OTHER_TEACHER_TARGET, target_cpm=10.0),
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
            json={"email": f"trp3346_{key}@example.com", "password": PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        _TOKENS[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return _TOKENS[key]


def _progress(client, as_key: str, of_key: str, lesson: str = LESSON):
    return client.get(
        f"/api/teacher/students/{U[of_key]}/reading-progress/{lesson}",
        headers=_auth(client, as_key),
    )


def _targets(lesson: str) -> list[tuple[int, float]]:
    db = TestingSessionLocal()
    try:
        rows = db.query(ReadingTarget).filter(ReadingTarget.lesson_id == lesson).order_by(ReadingTarget.id).all()
        return [(r.teacher_id, r.target_cpm) for r in rows]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# GET /teacher/students/{student_id}/reading-progress/{lesson_id}
# ---------------------------------------------------------------------------


class TestProgressAccess:
    def test_owning_teacher_gets_the_students_curve(self, client):
        r = _progress(client, "teacher_a", "student")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["student_id"] == U["student"]
        assert [a["cpm"] for a in body["attempts"]] == [70.0]

    def test_teacher_b_gets_own_student(self, client):
        # positive control for test_teacher_of_another_class_is_denied
        r = _progress(client, "teacher_b", "other_student")
        assert r.status_code == 200, r.text
        assert [a["cpm"] for a in r.json()["attempts"]] == [33.0]

    @pytest.mark.parametrize("as_key", ["teacher_b", "student", "classmate", "parent"])
    def test_user_who_does_not_own_the_class_is_denied(self, client, as_key):
        # teacher_b: a real teacher, just not this student's;
        # student/classmate/parent: no class ownership at all.
        r = _progress(client, as_key, "student")
        assert r.status_code == 403, r.text
        assert "attempts" not in r.json()

    def test_teacher_cannot_reach_student_outside_their_class(self, client):
        r = _progress(client, "teacher_a", "other_student")
        assert r.status_code == 403, r.text

    def test_unauthenticated_is_401(self, client):
        r = client.get(f"/api/teacher/students/{U['student']}/reading-progress/{LESSON}")
        assert r.status_code == 401


class TestProgressTargetIsTheCallersOwn:
    def test_teacher_sees_their_own_target(self, client):
        body = _progress(client, "teacher_a", "student").json()
        assert (body["target_cpm"], body["target_source"]) == (120.0, "teacher")
        assert body["target_reached"] is False  # 70 < 120

    def test_another_teachers_target_is_not_applied(self, client):
        # teacher_b set 10 cpm on a lesson teacher_a never targeted; teacher_a
        # must see the default, not teacher_b's number.
        body = _progress(client, "teacher_a", "student", LESSON_OTHER_TEACHER_TARGET).json()
        assert (body["target_cpm"], body["target_source"]) == (90.0, "default")


# ---------------------------------------------------------------------------
# PUT /teacher/reading-targets/{lesson_id}
# ---------------------------------------------------------------------------


class TestSetTargetScoping:
    """Each teacher's target row is theirs; a second teacher never overwrites it."""

    def test_put_creates_then_updates_the_callers_row(self, client):
        r1 = client.put(f"/api/teacher/reading-targets/{LESSON_PUT}",
                        headers=_auth(client, "teacher_a"), json={"target_cpm": 100})
        assert r1.status_code == 200, r1.text
        assert r1.json()["teacher_id"] == U["teacher_a"]
        r2 = client.put(f"/api/teacher/reading-targets/{LESSON_PUT}",
                        headers=_auth(client, "teacher_a"), json={"target_cpm": 110})
        assert r2.status_code == 200, r2.text
        assert _targets(LESSON_PUT) == [(U["teacher_a"], 110.0)]

    def test_other_teacher_put_does_not_overwrite(self, client):
        # depends on the previous test having created teacher_a's row
        r = client.put(f"/api/teacher/reading-targets/{LESSON_PUT}",
                       headers=_auth(client, "teacher_b"), json={"target_cpm": 5})
        assert r.status_code == 200, r.text
        assert r.json()["teacher_id"] == U["teacher_b"]
        assert _targets(LESSON_PUT) == [(U["teacher_a"], 110.0), (U["teacher_b"], 5.0)]

    def test_teacher_a_view_still_uses_own_target_after_b_writes(self, client):
        body = _progress(client, "teacher_a", "student", LESSON_PUT).json()
        assert body["target_cpm"] == 110.0

    @pytest.mark.parametrize("bad", [0, -1, 501])
    def test_out_of_range_target_is_422(self, client, bad):
        r = client.put(f"/api/teacher/reading-targets/{LESSON_PUT}",
                       headers=_auth(client, "teacher_a"), json={"target_cpm": bad})
        assert r.status_code == 422
        assert (U["teacher_a"], 110.0) in _targets(LESSON_PUT)

    def test_unauthenticated_put_is_401(self, client):
        r = client.put(f"/api/teacher/reading-targets/{LESSON_PUT}", json={"target_cpm": 1})
        assert r.status_code == 401
