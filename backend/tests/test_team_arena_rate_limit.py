"""Membership-gated rate-limit exemption for /api/team-arena/*/state and
/answer — same shape and reasoning as test_live_quiz_rate_limit.py, PRD §7
"限流" row. Through the REAL ASGI middleware stack, not a unit test of the
helper function in isolation (that lives in
test_team_arena_engine_rate_limit_membership.py).
"""
from __future__ import annotations

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app, GlobalRateLimitMiddleware
from app.auth.rate_limiter import general_rate_limiter
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole
from app.models.school import Classroom, School

LESSON_A = "L0125"

engine_db = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine_db, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_db)

_school_id = 0


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _school_id
    Base.metadata.create_all(bind=engine_db)
    session = TestingSessionLocal()
    session.add(Role(name="teacher", display_name="Teacher", scope_level="school"))
    session.add(Role(name="student", display_name="Student", scope_level="school"))
    school = School(name="Team Arena Rate Limit School")
    session.add(school)
    session.commit()
    _school_id = school.id
    session.close()

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

    app.dependency_overrides[get_db] = _override_get_db

    import app.database as app_database
    original_session_local = app_database.SessionLocal
    app_database.SessionLocal = TestingSessionLocal

    yield

    app_database.SessionLocal = original_session_local
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine_db)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201, resp.text
    token_v = resp.json().get("verification_token")
    if token_v:
        client.get(f"/api/auth/verify-email?token={token_v}")
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    return {"email": email, "token": token, "user_id": me.json()["id"]}


def _make_classroom_as(client, teacher_token: str, teacher_user_id: int) -> int:
    from app.models.school import ClassroomTeacher

    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "teacher").first()
        db.add(UserRole(user_id=teacher_user_id, role_id=role.id, scope_type="school", scope_id=str(_school_id)))
        room = Classroom(
            school_id=_school_id, teacher_id=teacher_user_id, name="rl room", grade=4,
            feature_settings={"team_arena": True},
        )
        db.add(room)
        db.commit()
        return room.id
    finally:
        db.close()


def _enroll(student_user_id: int, classroom_id: int) -> None:
    from app.models.school import ClassroomStudent

    db = TestingSessionLocal()
    try:
        db.add(ClassroomStudent(classroom_id=classroom_id, student_id=student_user_id))
        db.commit()
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _tiny_read_limit(monkeypatch):
    monkeypatch.setattr(GlobalRateLimitMiddleware, "READ_LIMIT", 5)
    general_rate_limiter.reset()
    yield
    general_rate_limiter.reset()


def test_joined_member_state_polling_is_exempt_from_per_ip_limit(client):
    teacher = _register_user(client, "ta_rl_teacher")
    student = _register_user(client, "ta_rl_student")
    room_id = _make_classroom_as(client, teacher["token"], teacher["user_id"])
    _enroll(student["user_id"], room_id)

    created = client.post(
        "/api/team-arena/sessions",
        json={"classroom_id": room_id, "scope_type": "lesson", "scope_ref": LESSON_A},
        headers=auth_header(teacher["token"]),
    ).json()
    code = created["code"]
    client.post(f"/api/team-arena/sessions/{code}/join", headers=auth_header(student["token"]))

    # 3x the tiny limit — would 429 immediately if this traffic were being
    # counted against the per-IP bucket at all.
    statuses = [
        client.get(f"/api/team-arena/sessions/{code}/state", headers=auth_header(student["token"])).status_code
        for _ in range(15)
    ]
    assert all(s == 200 for s in statuses), statuses


def test_non_member_state_polling_still_counts_against_per_ip_limit(client):
    teacher = _register_user(client, "ta_rl_teacher2")
    outsider = _register_user(client, "ta_rl_outsider")
    room_id = _make_classroom_as(client, teacher["token"], teacher["user_id"])

    created = client.post(
        "/api/team-arena/sessions",
        json={"classroom_id": room_id, "scope_type": "lesson", "scope_ref": LESSON_A},
        headers=auth_header(teacher["token"]),
    ).json()
    code = created["code"]

    statuses = [
        client.get(f"/api/team-arena/sessions/{code}/state", headers=auth_header(outsider["token"])).status_code
        for _ in range(15)
    ]
    assert 403 in statuses, "sanity: route-level membership check should still fire at least once"
    assert 429 in statuses, f"non-member traffic should eventually hit the per-IP limit, got {statuses}"


def test_other_endpoints_unaffected_by_the_team_arena_exemption(client):
    user = _register_user(client, "ta_rl_other_endpoint")
    statuses = [
        client.get("/api/users/me", headers=auth_header(user["token"])).status_code for _ in range(15)
    ]
    assert 429 in statuses, statuses
