"""
Regression lock for #3074 ①: the promise printed in the teacher UI.

The 課文管理 list tells teachers, verbatim:

    「我來試做」會以你自己的帳號進入該課，作答不會寫進學生的學習紀錄，
    也不會出現在班級統計。

The frontend test only checks that sentence is *displayed*. This file checks it
is *true*: a teacher who works through a lesson themselves produces a real
LearningSession, and that session must not surface in any class-level view.

Each test carries a positive control (an enrolled student's session that MUST
appear). Without it, "the teacher is absent" would also pass when the endpoint
returns nothing at all.

Run with:
    cd backend && python -m pytest tests/test_teacher_tryout_not_in_class_stats_3074.py -v
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models import Base
from app.models.school import Classroom, ClassroomStudent, School
from app.models.session import LearningSession
from app.models.user import Role

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]

_test_school_id: int = 0


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()
    school = School(name="Tryout Isolation School")
    session.add(school)
    session.commit()
    session.refresh(school)
    _test_school_id = school.id
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "demo1234"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"{suffix} {unique}"},
    )
    assert resp.status_code == 201, resp.text
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    return {"token": token, "user_id": me.json()["id"]}


def _seed_session(student_id: int, classroom_id: int, story_slug: str, score):
    db = TestingSessionLocal()
    db.add(
        LearningSession(
            student_id=student_id,
            classroom_id=classroom_id,
            story_slug=story_slug,
            overall_score=score,
            status="completed",
        )
    )
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "tryout_teacher")


@pytest.fixture(scope="module")
def student(client):
    return _register_user(client, "tryout_student")


@pytest.fixture(scope="module")
def struggling_student(client):
    """An enrolled student whose average is low enough to raise an alert.
    Without them the alerts list is empty, and "the teacher is not in it"
    would pass no matter what the endpoint did."""
    return _register_user(client, "tryout_struggler")


@pytest.fixture(scope="module")
def classroom(teacher, student, struggling_student):
    """A class where the teacher has tried the lesson themselves ("我來試做")
    and one enrolled student has also done it."""
    db = TestingSessionLocal()
    c = Classroom(
        name="Tryout Isolation Class",
        teacher_id=teacher["user_id"],
        school_id=_test_school_id,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    cid = c.id
    db.add(ClassroomStudent(classroom_id=cid, student_id=student["user_id"]))
    db.add(ClassroomStudent(classroom_id=cid, student_id=struggling_student["user_id"]))
    db.commit()
    db.close()

    # The enrolled student: the positive control.
    _seed_session(student["user_id"], cid, "20011", 88.0)
    # The teacher trying it themselves — a real session, deliberately a score
    # that would stand out if it ever leaked into a class average.
    _seed_session(teacher["user_id"], cid, "20011", 12.0)
    # A genuinely struggling enrolled student, so the alerts list is non-empty.
    _seed_session(struggling_student["user_id"], cid, "20011", 30.0)
    return cid


class TestTeacherTryoutStaysOutOfClassViews:
    def test_teacher_is_not_on_the_roster(self, client, teacher, student, classroom):
        """The whole promise rests on this: a teacher is not a student of their
        own class. If that ever changes, every assertion below turns hollow."""
        resp = client.get(
            f"/api/classrooms/{classroom}/students", headers=auth_header(teacher["token"])
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        rows = body if isinstance(body, list) else body.get("students", body.get("items", []))
        ids = {r.get("id") or r.get("user_id") for r in rows}
        assert student["user_id"] in ids, (
            "正向對照失敗：連真學生都不在名冊裡，代表這個查法什麼都證明不了"
        )
        assert teacher["user_id"] not in ids, (
            "老師被列為自己班上的學生 —— UI 上「不會出現在班級統計」那句承諾就不成立了"
        )

    def test_heatmap_scores_exclude_the_teachers_own_attempt(
        self, client, teacher, student, classroom
    ):
        """Assert on `scores`, not on `students`.

        `students` is built from the enrolment rows, so it can never contain the
        teacher no matter what the session query does — asserting there restates
        the roster test above and catches nothing. The teacher's 12.0 leaks
        through `scores`, which is built from the session query.
        """
        resp = client.get(
            f"/api/teacher/classrooms/{classroom}/heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        scores = resp.json()["scores"]
        scored_ids = {row["student_id"] for row in scores}
        assert student["user_id"] in scored_ids, (
            "正向對照失敗：熱圖分數裡連有作答的學生都沒有，這條測試抓不到任何東西"
        )
        assert teacher["user_id"] not in scored_ids, (
            f"老師自己試做的成績跑進班級熱圖分數：{scores} —— "
            "UI 上「不會出現在班級統計」那句話就是假的"
        )

    def test_alerts_do_not_flag_the_teacher(
        self, client, teacher, struggling_student, classroom
    ):
        resp = client.get(
            f"/api/teacher/classrooms/{classroom}/alerts",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        rows = body if isinstance(body, list) else body.get("alerts", body.get("items", []))
        flagged = {r.get("student_id") for r in rows}
        assert struggling_student["user_id"] in flagged, (
            "正向對照失敗：連平均 30 分的學生都沒被列出來，"
            "那「老師不在名單裡」只是因為名單本來就空的"
        )
        assert teacher["user_id"] not in flagged, (
            "老師拿 12 分試做，系統把老師本人列成需要關懷的學生"
        )
