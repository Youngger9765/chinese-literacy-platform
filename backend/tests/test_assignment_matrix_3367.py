"""Assignment matrix + per-item class stats (#3367)."""

import sys
import os
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession
from app.models.assignment import Assignment, AssignmentSubmission


# ---------------------------------------------------------------------------
# Test database setup
# ---------------------------------------------------------------------------

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


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Matrix Test School")
    session.add(school)
    session.commit()
    session.refresh(school)
    return school.id


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_test_school_id: int = 0


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _test_school_id = _seed_school(session)
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def school_id():
    return _test_school_id


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    return {
        "token": token,
        "user_id": me_resp.json()["id"],
        "email": email,
        "name": name,
    }


def _seed_classroom(teacher_id: int, school_id: int) -> int:
    db = TestingSessionLocal()
    classroom = Classroom(
        name="Matrix Class",
        teacher_id=teacher_id,
        school_id=school_id,
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    cid = classroom.id
    db.close()
    return cid


def _enroll_student(classroom_id: int, student_id: int):
    db = TestingSessionLocal()
    enrollment = ClassroomStudent(classroom_id=classroom_id, student_id=student_id)
    db.add(enrollment)
    db.commit()
    db.close()



def _seed_assignment(classroom_id: int, teacher_id: int, title: str) -> int:
    db = TestingSessionLocal()
    a = Assignment(classroom_id=classroom_id, teacher_id=teacher_id, story_id="1", title=title)
    db.add(a)
    db.commit()
    aid = a.id
    db.close()
    return aid


def _seed_submission(assignment_id: int, student_id: int, status: str, *, score=None,
                     session_kwargs: dict | None = None, attempt: int = 1) -> None:
    db = TestingSessionLocal()
    session_id = None
    if session_kwargs is not None:
        sess = LearningSession(student_id=student_id, story_slug="1", session_mode="assignment",
                               **session_kwargs)
        db.add(sess)
        db.flush()
        session_id = sess.id
    db.add(AssignmentSubmission(assignment_id=assignment_id, student_id=student_id, status=status,
                                score=score, session_id=session_id, attempt_number=attempt))
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "mx_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "mx_other")


@pytest.fixture(scope="module")
def students(client):
    return [_register_user(client, f"mx_student_{i}") for i in range(4)]


@pytest.fixture(scope="module")
def seeded(teacher, students, school_id):
    cid = _seed_classroom(teacher["user_id"], school_id)
    for s in students:
        _enroll_student(cid, s["user_id"])
    a1 = _seed_assignment(cid, teacher["user_id"], "贏得喝采的輸家")
    a2 = _seed_assignment(cid, teacher["user_id"], "古詩兩首")
    s0, s1, s2, s3 = (s["user_id"] for s in students)
    # a1: s0 done with full breakdown, s1 in progress, s2 never started, s3 joined later (no row)
    _seed_submission(a1, s0, "submitted", score=88.0, session_kwargs=dict(
        status="completed", accuracy=96.0, literal_score=100.0, inferential_score=60.0,
        evaluative_score=100.0, vocab_result={"accuracy": 0.8}, overall_score=88.0,
        step_progress={"current_step": "report", "steps_completed": []}))
    _seed_submission(a1, s1, "in_progress", session_kwargs=dict(
        status="in_progress", step_progress={"current_step": "comprehension", "steps_completed": ["intro"]}))
    _seed_submission(a1, s2, "pending")
    # a2: s0 retried — the latest attempt is the one that counts
    _seed_submission(a2, s0, "submitted", score=40.0, attempt=1, session_kwargs=dict(
        status="completed", accuracy=50.0, literal_score=40.0, inferential_score=40.0,
        evaluative_score=40.0, overall_score=40.0))
    _seed_submission(a2, s0, "graded", score=91.0, attempt=2, session_kwargs=dict(
        status="completed", accuracy=90.0, literal_score=100.0, inferential_score=80.0,
        evaluative_score=90.0, overall_score=91.0))
    _seed_submission(a2, s1, "submitted", score=70.0, session_kwargs=dict(
        status="completed", accuracy=80.0, literal_score=100.0, inferential_score=20.0,
        evaluative_score=50.0, vocab_result={"accuracy": 60}, overall_score=70.0))
    return {"cid": cid, "a1": a1, "a2": a2, "ids": (s0, s1, s2, s3)}


class TestAssignmentMatrix:
    def _get(self, client, token, cid):
        return client.get(f"/api/teacher/classrooms/{cid}/assignment-matrix", headers=auth_header(token))

    def test_every_cell_has_one_of_four_states(self, client, teacher, seeded):
        resp = self._get(client, teacher["token"], seeded["cid"])
        assert resp.status_code == 200
        body = resp.json()
        assert [a["title"] for a in body["assignments"]] == ["贏得喝采的輸家", "古詩兩首"]
        assert len(body["students"]) == 4
        cells = {(c["student_id"], c["assignment_id"]): c for c in body["cells"]}
        s0, s1, s2, s3 = seeded["ids"]
        a1, a2 = seeded["a1"], seeded["a2"]
        assert cells[(s0, a1)]["state"] == "completed" and cells[(s0, a1)]["score"] == 88.0
        assert cells[(s1, a1)]["state"] == "in_progress" and cells[(s1, a1)]["current_step"] == "comprehension"
        assert cells[(s1, a1)]["score"] is None
        assert cells[(s2, a1)]["state"] == "not_started" and cells[(s2, a1)]["score"] is None
        # A student with no submission row was never assigned — not the same as "not started".
        assert cells[(s3, a1)]["state"] == "not_assigned"
        assert cells[(s3, a2)]["state"] == "not_assigned"

    def test_latest_attempt_wins(self, client, teacher, seeded):
        body = self._get(client, teacher["token"], seeded["cid"]).json()
        cell = next(c for c in body["cells"]
                    if c["student_id"] == seeded["ids"][0] and c["assignment_id"] == seeded["a2"])
        assert cell["state"] == "completed" and cell["score"] == 91.0

    def test_student_cannot_read_matrix(self, client, students, seeded):
        assert self._get(client, students[0]["token"], seeded["cid"]).status_code == 403

    def test_other_teacher_cannot_read_matrix(self, client, other_teacher, seeded):
        assert self._get(client, other_teacher["token"], seeded["cid"]).status_code == 403

    def test_unauthenticated(self, client, seeded):
        assert client.get(f"/api/teacher/classrooms/{seeded['cid']}/assignment-matrix").status_code == 401


class TestAssignmentItemStats:
    def _get(self, client, token, aid):
        return client.get(f"/api/teacher/assignments/{aid}/item-stats", headers=auth_header(token))

    def test_items_sorted_by_correct_rate_ascending(self, client, teacher, seeded):
        resp = self._get(client, teacher["token"], seeded["a2"])
        assert resp.status_code == 200
        body = resp.json()
        assert body["submitted_count"] == 2  # latest attempt per student only
        items = {i["key"]: i for i in body["items"]}
        # inferential: latest attempts 80 and 20 → 50
        assert items["inferential"]["correct_rate"] == 50.0
        assert items["inferential"]["error_rate"] == 50.0
        assert items["inferential"]["completed"] == 2
        # vocab: only s1 has a vocab result (60 on a 0-100 scale)
        assert items["vocab"]["completed"] == 1
        assert items["vocab"]["completion_rate"] == 50.0
        assert items["vocab"]["correct_rate"] == 60.0
        rates = [i["correct_rate"] for i in body["items"] if i["correct_rate"] is not None]
        assert rates == sorted(rates)
        assert body["items"][0]["key"] == "inferential"

    def test_unsubmitted_students_are_not_counted(self, client, teacher, seeded):
        body = self._get(client, teacher["token"], seeded["a1"]).json()
        assert body["submitted_count"] == 1
        items = {i["key"]: i for i in body["items"]}
        assert items["reading"]["correct_rate"] == 96.0
        assert items["vocab"]["correct_rate"] == 80.0  # 0-1 scale normalised to percent

    def test_student_and_other_teacher_get_the_same_404_as_a_missing_id(self, client, students, other_teacher, seeded):
        # Same answer as a non-existent id, so assignment ids can't be enumerated.
        assert self._get(client, students[0]["token"], seeded["a1"]).status_code == 404
        assert self._get(client, other_teacher["token"], seeded["a1"]).status_code == 404
        assert self._get(client, other_teacher["token"], 999_999).status_code == 404

    def test_over_the_row_limit_is_refused(self, client, teacher, seeded, monkeypatch):
        from app.routes.teacher import teacher_assignment_matrix as m
        monkeypatch.setattr(m, "_MATRIX_ROW_LIMIT", 1)
        assert self._get(client, teacher["token"], seeded["a2"]).status_code == 400
        resp = client.get(f"/api/teacher/classrooms/{seeded['cid']}/assignment-matrix",
                          headers=auth_header(teacher["token"]))
        assert resp.status_code == 400
