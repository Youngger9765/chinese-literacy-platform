"""Route-level wiring + authz tests for /api/team-arena/* — Issue #3632.

Deep game logic (team formation math, towers, scoring, turn resolution) is
already covered exhaustively in test_team_arena_engine_*.py — this file
only proves the HTTP layer is wired correctly and binds every id to the
caller, same scope/shape as test_pk_routes.py.
"""
from __future__ import annotations

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole
from app.models.school import Classroom, ClassroomStudent, School

LESSON_A = "L0125"

engine_db = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine_db, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_db)

SEED_ROLES = [
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]

_school_id = 0
_room_enabled_id = 0
_room_disabled_id = 0
_room_other_teacher_id = 0
_teacher_owner = None
_teacher_other = None


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _bootstrap_user(session, name):
    from app.models.user import User

    unique = uuid.uuid4().hex[:8]
    u = User(email=f"{name}_{unique}@example.com", password_hash="x", name=name)
    session.add(u)
    session.commit()
    return u


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _school_id, _room_enabled_id, _room_disabled_id, _room_other_teacher_id
    global _teacher_owner, _teacher_other
    Base.metadata.create_all(bind=engine_db)
    session = TestingSessionLocal()
    for r in SEED_ROLES:
        session.add(Role(**r))
    school = School(name="Team Arena Route Test School")
    session.add(school)
    session.commit()
    _school_id = school.id

    _teacher_owner = _bootstrap_user(session, "ta_route_owner_teacher")
    _teacher_other = _bootstrap_user(session, "ta_route_other_teacher")

    room_enabled = Classroom(
        school_id=_school_id, teacher_id=_teacher_owner.id, name="room enabled", grade=4,
        feature_settings={"team_arena": True},
    )
    room_disabled = Classroom(
        school_id=_school_id, teacher_id=_teacher_owner.id, name="room disabled", grade=4,
    )
    room_other = Classroom(
        school_id=_school_id, teacher_id=_teacher_other.id, name="room other teacher", grade=4,
        feature_settings={"team_arena": True},
    )
    session.add_all([room_enabled, room_disabled, room_other])
    session.commit()
    _room_enabled_id = room_enabled.id
    _room_disabled_id = room_disabled.id
    _room_other_teacher_id = room_other.id
    session.close()

    app.dependency_overrides[get_db] = _override_get_db

    import app.database as app_database
    original_session_local = app_database.SessionLocal
    app_database.SessionLocal = TestingSessionLocal

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

    yield

    app_database.SessionLocal = original_session_local
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine_db)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_student(client) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"ta_stu_{unique}@example.com"
    password = "SecurePass123!"
    name = f"TA Student {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201, resp.text
    token_v = resp.json().get("verification_token")
    if token_v:
        v = client.get(f"/api/auth/verify-email?token={token_v}")
        assert v.status_code == 200
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    user_id = me.json()["id"]

    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "student").first()
        db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="school", scope_id=str(_school_id)))
        db.commit()
    finally:
        db.close()
    return {"token": token, "user_id": user_id}


def _register_and_promote_teacher(client, classroom_id: int) -> dict:
    from app.models.school import ClassroomTeacher

    unique = uuid.uuid4().hex[:8]
    email = f"ta_teach_{unique}@example.com"
    password = "SecurePass123!"
    name = f"TA Teacher {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201, resp.text
    token_v = resp.json().get("verification_token")
    if token_v:
        v = client.get(f"/api/auth/verify-email?token={token_v}")
        assert v.status_code == 200
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    user_id = me.json()["id"]

    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "teacher").first()
        db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="school", scope_id=str(_school_id)))
        db.add(ClassroomTeacher(classroom_id=classroom_id, teacher_id=user_id, role="co-teacher"))
        db.commit()
    finally:
        db.close()
    return {"token": token, "user_id": user_id}


def _enroll(student_user_id: int, classroom_id: int) -> None:
    db = TestingSessionLocal()
    try:
        db.add(ClassroomStudent(classroom_id=classroom_id, student_id=student_user_id))
        db.commit()
    finally:
        db.close()


@pytest.fixture()
def owner_teacher(client):
    return _register_and_promote_teacher(client, _room_enabled_id)


@pytest.fixture()
def disabled_room_teacher(client):
    return _register_and_promote_teacher(client, _room_disabled_id)


@pytest.fixture()
def other_room_teacher(client):
    return _register_and_promote_teacher(client, _room_other_teacher_id)


@pytest.fixture()
def student_in_room(client):
    s = _register_student(client)
    _enroll(s["user_id"], _room_enabled_id)
    return s


@pytest.fixture()
def unenrolled_student(client):
    return _register_student(client)


class TestCreateSessionWiring:
    def test_unauthenticated_is_401(self, client):
        resp = client.post(
            "/api/team-arena/sessions",
            json={"classroom_id": _room_enabled_id, "scope_type": "grade_pool", "scope_ref": "4"},
        )
        assert resp.status_code == 401

    def test_feature_disabled_classroom_is_403(self, client, disabled_room_teacher):
        resp = client.post(
            "/api/team-arena/sessions",
            json={"classroom_id": _room_disabled_id, "scope_type": "grade_pool", "scope_ref": "4"},
            headers=auth_header(disabled_room_teacher["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_owner_teacher_can_create(self, client, owner_teacher):
        resp = client.post(
            "/api/team-arena/sessions",
            json={"classroom_id": _room_enabled_id, "scope_type": "lesson", "scope_ref": LESSON_A},
            headers=auth_header(owner_teacher["token"]),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "lobby"
        assert len(resp.json()["code"]) == 6

    def test_a_teacher_of_a_different_classroom_cannot_create_here(self, client, other_room_teacher):
        resp = client.post(
            "/api/team-arena/sessions",
            json={"classroom_id": _room_enabled_id, "scope_type": "grade_pool", "scope_ref": "4"},
            headers=auth_header(other_room_teacher["token"]),
        )
        assert resp.status_code == 403, resp.text


class TestJoinSessionWiring:
    def test_member_can_join(self, client, owner_teacher, student_in_room):
        create = client.post(
            "/api/team-arena/sessions",
            json={"classroom_id": _room_enabled_id, "scope_type": "lesson", "scope_ref": LESSON_A},
            headers=auth_header(owner_teacher["token"]),
        )
        code = create.json()["code"]
        resp = client.post(
            f"/api/team-arena/sessions/{code}/join", headers=auth_header(student_in_room["token"])
        )
        assert resp.status_code == 201, resp.text

    def test_non_member_cannot_join(self, client, owner_teacher, unenrolled_student):
        create = client.post(
            "/api/team-arena/sessions",
            json={"classroom_id": _room_enabled_id, "scope_type": "lesson", "scope_ref": LESSON_A},
            headers=auth_header(owner_teacher["token"]),
        )
        code = create.json()["code"]
        resp = client.post(
            f"/api/team-arena/sessions/{code}/join", headers=auth_header(unenrolled_student["token"])
        )
        assert resp.status_code == 403, resp.text

    def test_unknown_code_is_404(self, client, student_in_room):
        resp = client.post(
            "/api/team-arena/sessions/ZZZZZZ/join", headers=auth_header(student_in_room["token"])
        )
        assert resp.status_code == 404


class TestFullHappyPathThroughHttp:
    """End-to-end wiring smoke test: create -> join x4 -> auto teams ->
    start -> state (teacher + student) -> answer -> end -> result. Deep
    correctness of each step is covered by the engine test suite; this
    just proves the FastAPI layer actually calls through correctly."""

    def test_create_join_teams_start_state_answer_end_result(self, client, owner_teacher):
        create = client.post(
            "/api/team-arena/sessions",
            json={
                "classroom_id": _room_enabled_id, "scope_type": "lesson", "scope_ref": LESSON_A,
                "turns_per_player": 1, "answer_seconds": 45,
            },
            headers=auth_header(owner_teacher["token"]),
        )
        assert create.status_code == 201, create.text
        code = create.json()["code"]

        students = []
        for _ in range(4):
            s = _register_student(client)
            _enroll(s["user_id"], _room_enabled_id)
            students.append(s)
            resp = client.post(f"/api/team-arena/sessions/{code}/join", headers=auth_header(s["token"]))
            assert resp.status_code == 201, resp.text

        teams = client.post(
            f"/api/team-arena/sessions/{code}/teams",
            json={"action": "auto"},
            headers=auth_header(owner_teacher["token"]),
        )
        assert teams.status_code == 200, teams.text

        start = client.post(
            f"/api/team-arena/sessions/{code}/control",
            json={"action": "start"},
            headers=auth_header(owner_teacher["token"]),
        )
        assert start.status_code == 200, start.text
        assert start.json()["status"] == "playing"

        teacher_state = client.get(
            f"/api/team-arena/sessions/{code}/state", headers=auth_header(owner_teacher["token"])
        )
        assert teacher_state.status_code == 200, teacher_state.text
        assert "matches" in teacher_state.json()

        student_state = client.get(
            f"/api/team-arena/sessions/{code}/state", headers=auth_header(students[0]["token"])
        )
        assert student_state.status_code == 200, student_state.text
        assert "own_match" in student_state.json()

        answer = client.post(
            f"/api/team-arena/sessions/{code}/answer",
            json={"choice_key": "A"},
            headers=auth_header(students[0]["token"]),
        )
        # 45s answer window + real lesson stem reading phase — immediate
        # submission may land during the reading phase (409) OR the answer
        # window (200), both are legitimate server-authoritative outcomes.
        assert answer.status_code in (200, 409), answer.text

        end = client.post(
            f"/api/team-arena/sessions/{code}/control",
            json={"action": "end"},
            headers=auth_header(owner_teacher["token"]),
        )
        assert end.status_code == 200, end.text
        assert end.json()["status"] == "ended"

        result = client.get(
            f"/api/team-arena/sessions/{code}/result", headers=auth_header(students[0]["token"])
        )
        assert result.status_code == 200, result.text
        assert "me" in result.json()


class TestCodeLookupSurvivesEnding:
    """Regression lock: get_session_by_code must NOT filter out `ended`
    sessions — the first version of this route did, and every poll/result
    call made right after the teacher ended the session 404'd (caught by
    TestFullHappyPathThroughHttp before this fix)."""

    def test_state_poll_after_ended_still_200s(self, client, owner_teacher, student_in_room):
        create = client.post(
            "/api/team-arena/sessions",
            json={"classroom_id": _room_enabled_id, "scope_type": "lesson", "scope_ref": LESSON_A},
            headers=auth_header(owner_teacher["token"]),
        )
        code = create.json()["code"]
        client.post(f"/api/team-arena/sessions/{code}/join", headers=auth_header(student_in_room["token"]))
        client.post(
            f"/api/team-arena/sessions/{code}/control", json={"action": "end"},
            headers=auth_header(owner_teacher["token"]),
        )
        resp = client.get(
            f"/api/team-arena/sessions/{code}/state", headers=auth_header(student_in_room["token"])
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "ended"

