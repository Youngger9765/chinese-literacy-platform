"""#3356: only teachers set reading targets; a student only gets their own teacher target."""
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
LESSON = "L3356"
LESSON_PUT = "L3356-PUT"

U: dict[str, int] = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user(db, key: str) -> User:
    user = User(
        email=f"rt3356_{key}@example.com",
        username=f"rt3356_{key}",
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

    school = School(name="RT 3356 School")
    db.add(school)
    db.flush()

    teacher_a = _user(db, "teacher_a")          # owns class A (student, classmate)
    teacher_b = _user(db, "teacher_b")          # owns class B (other_student)
    student = _user(db, "student")
    classmate = _user(db, "classmate")
    other_student = _user(db, "other_student")
    _user(db, "parent")

    class_a = Classroom(name="A", school_id=school.id, teacher_id=teacher_a.id, join_code="RT3356A")
    class_b = Classroom(name="B", school_id=school.id, teacher_id=teacher_b.id, join_code="RT3356B")
    db.add_all([class_a, class_b])
    db.flush()

    db.add_all([
        ClassroomStudent(classroom_id=class_a.id, student_id=student.id),
        ClassroomStudent(classroom_id=class_a.id, student_id=classmate.id),
        ClassroomStudent(classroom_id=class_b.id, student_id=other_student.id),
        ParentStudentLink(parent_id=U["parent"], student_id=student.id, is_active=True),
        # teacher_b teaches a different class; their target on LESSON must never
        # reach student (class A). teacher_a has set nothing on LESSON yet.
        ReadingTarget(teacher_id=teacher_b.id, lesson_id=LESSON, target_cpm=7.0),
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
            json={"email": f"rt3356_{key}@example.com", "password": PASSWORD},
        )
        assert resp.status_code == 200, resp.text
        _TOKENS[key] = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    return _TOKENS[key]




def _put(client, as_key: str, cpm: float, lesson: str = LESSON_PUT):
    return client.put(f"/api/teacher/reading-targets/{lesson}", headers=_auth(client, as_key),
                      json={"target_cpm": cpm})


def _student_target(client, lesson: str) -> tuple[float, str]:
    body = client.get(f"/api/reading-history/{U['student']}/{lesson}",
                      headers=_auth(client, "student")).json()
    return body["target_cpm"], body["target_source"]


def _rows(lesson: str) -> list[tuple[int, float]]:
    db = TestingSessionLocal()
    try:
        rows = db.query(ReadingTarget).filter(ReadingTarget.lesson_id == lesson).order_by(ReadingTarget.id).all()
        return [(r.teacher_id, r.target_cpm) for r in rows]
    finally:
        db.close()


class TestOnlyTeachersCanSetTargets:
    @pytest.mark.parametrize("as_key", ["student", "classmate", "parent"])
    def test_non_teacher_put_is_403_and_writes_nothing(self, client, as_key):
        r = _put(client, as_key, 7)
        assert r.status_code == 403, r.text
        assert _rows(LESSON_PUT) == []

    def test_class_owner_can_set_target(self, client):
        # positive control: the 403 above is the role check, not a broken route
        r = _put(client, "teacher_a", 100)
        assert r.status_code == 200, r.text
        assert _rows(LESSON_PUT) == [(U["teacher_a"], 100.0)]


class TestStudentOnlySeesTheirOwnTeachersTarget:
    def test_other_class_teacher_target_is_not_applied(self, client):
        assert _student_target(client, LESSON) == (90.0, "default")

    def test_own_teacher_target_is_applied(self, client):
        assert _put(client, "teacher_a", 120, LESSON).status_code == 200
        assert _student_target(client, LESSON) == (120.0, "teacher")
