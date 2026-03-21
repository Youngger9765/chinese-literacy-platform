"""
Tests for Issue #271 — Session Resume.

Covers:
- GET /api/learning/sessions/{id}/status — session status endpoint
  - Returns is_resumable=True for in_progress sessions
  - Returns is_completed=True for completed sessions
  - Returns 404 for non-existent sessions
  - Returns 403 when accessing another user's session
  - Requires authentication

Run with:
    cd backend
    python -m pytest tests/test_session_resume.py -v
"""

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
from app.models.user import Role


# ---------------------------------------------------------------------------
# Test database setup (SQLite in-memory)
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
        role = Role(
            name=role_data["name"],
            display_name=role_data["display_name"],
            scope_level=role_data["scope_level"],
        )
        session.add(role)
    session.commit()


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _register_user(client, suffix: str | None = None) -> dict:
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"resume_user_{unique}@example.com"
    password = "SecurePass123!"
    name = f"Resume User {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201, resp.text
    verification_token = resp.json()["verification_token"]
    client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    return {
        "email": email,
        "password": password,
        "name": name,
        "token": login_resp.json()["access_token"],
    }


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def user_a(client):
    return _register_user(client, "resume_a")


@pytest.fixture(scope="module")
def user_b(client):
    return _register_user(client, "resume_b")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_session(client, token: str, story_slug: str = "test-story") -> int:
    resp = client.post(
        "/api/learning/sessions",
        json={"story_slug": story_slug},
        headers=auth_header(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _complete_session(client, token: str, session_id: int):
    """Mark a session as completed (simulates reaching the report step)."""
    resp = client.patch(
        f"/api/learning/sessions/{session_id}",
        json={
            "status": "completed",
            "current_step": 6,
            "completed_at": "2026-03-09T10:00:00Z",
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text


# ===========================================================================
# GET /api/learning/sessions/{id}/status
# ===========================================================================


class TestGetSessionStatus:
    # --- 200 OK cases ---

    def test_status_returns_200_for_in_progress(self, client, user_a):
        session_id = _create_session(client, user_a["token"], "resume-inprogress")
        resp = client.get(
            f"/api/learning/sessions/{session_id}/status",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200

    def test_in_progress_session_is_resumable(self, client, user_a):
        """An in_progress session should have is_resumable=True and is_completed=False."""
        session_id = _create_session(client, user_a["token"], "resumable-story")
        resp = client.get(
            f"/api/learning/sessions/{session_id}/status",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert data["is_resumable"] is True
        assert data["is_completed"] is False

    def test_in_progress_status_fields(self, client, user_a):
        """Status response includes all expected fields."""
        session_id = _create_session(client, user_a["token"], "fields-story")
        resp = client.get(
            f"/api/learning/sessions/{session_id}/status",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        expected_fields = [
            "id", "story_slug", "current_step", "status",
            "is_resumable", "is_completed", "started_at", "completed_at",
        ]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"

    def test_in_progress_session_has_correct_step(self, client, user_a):
        """Default current_step for a new session is 1."""
        session_id = _create_session(client, user_a["token"], "step-check")
        resp = client.get(
            f"/api/learning/sessions/{session_id}/status",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert data["current_step"] == 1
        assert data["status"] == "in_progress"
        assert data["completed_at"] is None

    def test_step_advance_reflected_in_status(self, client, user_a):
        """After advancing to step 3, status should reflect current_step=3."""
        session_id = _create_session(client, user_a["token"], "step-advance")
        # Advance to step 3
        client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"current_step": 3},
            headers=auth_header(user_a["token"]),
        )
        resp = client.get(
            f"/api/learning/sessions/{session_id}/status",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert data["current_step"] == 3
        assert data["is_resumable"] is True
        assert data["is_completed"] is False

    # --- Completed session ---

    def test_completed_session_is_not_resumable(self, client, user_a):
        """A completed session should have is_resumable=False and is_completed=True."""
        session_id = _create_session(client, user_a["token"], "completed-story")
        _complete_session(client, user_a["token"], session_id)

        resp = client.get(
            f"/api/learning/sessions/{session_id}/status",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_resumable"] is False
        assert data["is_completed"] is True
        assert data["completed_at"] is not None

    def test_completed_session_step_is_6(self, client, user_a):
        """Completed session should show current_step=6."""
        session_id = _create_session(client, user_a["token"], "completed-step6")
        _complete_session(client, user_a["token"], session_id)

        resp = client.get(
            f"/api/learning/sessions/{session_id}/status",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert data["current_step"] == 6
        assert data["status"] == "completed"

    # --- Error cases ---

    def test_status_not_found_returns_404(self, client, user_a):
        resp = client.get(
            "/api/learning/sessions/999999/status",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Session not found"

    def test_status_other_users_session_returns_403(self, client, user_a, user_b):
        """User A cannot check the status of User B's session."""
        session_id = _create_session(client, user_b["token"], "b-private-story")

        resp = client.get(
            f"/api/learning/sessions/{session_id}/status",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Not your session"

    def test_status_requires_auth(self, client):
        resp = client.get("/api/learning/sessions/1/status")
        assert resp.status_code == 401

    def test_status_invalid_token_returns_401(self, client):
        resp = client.get(
            "/api/learning/sessions/1/status",
            headers=auth_header("invalid.jwt.token"),
        )
        assert resp.status_code == 401


# ===========================================================================
# End-to-end resume flow
# ===========================================================================


class TestResumeFlow:
    def test_full_resume_lifecycle(self, client):
        """
        BDD: Given an in_progress session at step 3,
             When I check its status,
             Then is_resumable=True and current_step=3.
             When I complete it,
             Then is_resumable=False and is_completed=True.
        """
        user = _register_user(client, "resume_lifecycle")
        headers = auth_header(user["token"])

        # Step 1: Create session and advance to step 3
        session_id = _create_session(client, user["token"], "lifecycle-story")
        client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"current_step": 3},
            headers=headers,
        )

        # Step 2: Check status — should be resumable at step 3
        status_resp = client.get(
            f"/api/learning/sessions/{session_id}/status",
            headers=headers,
        )
        assert status_resp.status_code == 200
        status = status_resp.json()
        assert status["is_resumable"] is True
        assert status["is_completed"] is False
        assert status["current_step"] == 3
        assert status["story_slug"] == "lifecycle-story"

        # Step 3: Complete the session
        _complete_session(client, user["token"], session_id)

        # Step 4: Check status again — should NOT be resumable
        status_resp2 = client.get(
            f"/api/learning/sessions/{session_id}/status",
            headers=headers,
        )
        assert status_resp2.status_code == 200
        status2 = status_resp2.json()
        assert status2["is_resumable"] is False
        assert status2["is_completed"] is True
        assert status2["completed_at"] is not None
