"""Membership-gated rate-limit exemption for /api/team-arena/*/state and
/answer — v2, same shape and reasoning as test_live_quiz_rate_limit.py,
PRD §7 "限流" row (unchanged by v2). Through the REAL ASGI middleware
stack, not a unit test of the helper function in isolation.
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
from app.database import get_db
from app.models import Base
from app.models.school import Classroom, ClassroomStudent, School

engine_db = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine_db, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine_db)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine_db)

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


def _enroll_with_grade(user_id: int, grade: int = 4) -> None:
    db = TestingSessionLocal()
    try:
        school = School(name=f"RL School {uuid.uuid4().hex[:6]}")
        db.add(school)
        db.flush()
        room = Classroom(school_id=school.id, teacher_id=user_id, name="RL room", grade=grade)
        db.add(room)
        db.flush()
        db.add(ClassroomStudent(classroom_id=room.id, student_id=user_id))
        db.commit()
    finally:
        db.close()


class TestTeamArenaRateLimitExemption:
    def test_member_polling_state_is_exempt_while_a_non_exempt_read_still_429s(self, client, monkeypatch):
        """Positive control first (PRD overclaim-bias doctrine: a "no 429"
        result only means something if the limit was actually tight enough
        to bite something): with READ_LIMIT patched down to 3, hammering a
        NON-exempt read endpoint from the same client 429s well before 10
        calls. A host polling THEIR OWN session's /state, under the exact
        same tight limit, never does — because
        is_authenticated_session_member() exempts it (PRD §7 "限流" row)."""
        monkeypatch.setattr(GlobalRateLimitMiddleware, "READ_LIMIT", 3)

        host = _register_user(client, "ta_rl_host")
        _enroll_with_grade(host["user_id"])

        # Positive control: /api/users/me is an ordinary, non-exempt read.
        control_statuses = [
            client.get("/api/users/me", headers=auth_header(host["token"])).status_code for _ in range(10)
        ]
        assert 429 in control_statuses, (
            f"positive control never hit 429 -- READ_LIMIT patch didn't take effect: {control_statuses}"
        )

        created = client.post("/api/team-arena/sessions", json={"team_size": 2}, headers=auth_header(host["token"]))
        assert created.status_code == 201, created.text
        code = created.json()["code"]

        statuses = [
            client.get(f"/api/team-arena/sessions/{code}/state", headers=auth_header(host["token"])).status_code
            for _ in range(10)
        ]
        assert 429 not in statuses, statuses

    def test_unknown_code_does_not_crash_the_membership_check(self, client):
        host = _register_user(client, "ta_rl_bad_code")
        resp = client.get("/api/team-arena/sessions/ZZZZZZ/state", headers=auth_header(host["token"]))
        # 404 from the real route (not a member of anything, code doesn't
        # exist) -- the middleware's membership lookup itself must not 500.
        assert resp.status_code == 404
