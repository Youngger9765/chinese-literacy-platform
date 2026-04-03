"""
Tests for the step progress persistence API (Issue #660).

Covers:
- PUT  /api/learning/sessions/{id}/progress  (save)
- GET  /api/learning/sessions/{id}/progress  (load)

Verifies:
- Owner can save and load progress
- Non-owner gets 403
- Missing session gets 404
- Returns null step_progress when nothing saved yet
- Saves overwrite previous data correctly

Uses SQLite in-memory DB (conftest patches JSONB -> JSON).

Run with:
    cd backend && JWT_SECRET_KEY=test-secret python -m pytest tests/test_step_progress_api.py -v
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
# In-memory SQLite test database
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


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    with TestingSessionLocal() as db:
        for role_data in SEED_ROLES:
            if not db.query(Role).filter_by(name=role_data["name"]).first():
                db.add(Role(**role_data))
        db.commit()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _register_and_login(client, suffix: str | None = None) -> dict:
    """Register a user, verify email, log in; return {token, ...}."""
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"sp660_{unique}@example.com"
    password = "SecurePass660!"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"SP660 {unique}"},
    )
    assert resp.status_code == 201, resp.text
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    return {"email": email, "token": login_resp.json()["access_token"]}


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def student(client):
    return _register_and_login(client, "student")


@pytest.fixture(scope="module")
def other(client):
    return _register_and_login(client, "other")


@pytest.fixture(scope="module")
def session_id(client, student):
    """Create a learning session owned by student; return its DB id."""
    resp = client.post(
        "/api/learning/sessions",
        json={"story_slug": "L06"},
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# Tests: GET before any save — step_progress should be null
# ---------------------------------------------------------------------------


def test_get_progress_no_data_returns_null(client, student, session_id):
    """Freshly created session returns step_progress: null."""
    resp = client.get(
        f"/api/learning/sessions/{session_id}/progress",
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["session_id"] == session_id
    assert body["step_progress"] is None


def test_get_progress_unauthenticated(client, session_id):
    """No token -> 401."""
    resp = client.get(f"/api/learning/sessions/{session_id}/progress")
    assert resp.status_code == 401


def test_get_progress_wrong_owner(client, other, session_id):
    """Another user GET -> 403."""
    resp = client.get(
        f"/api/learning/sessions/{session_id}/progress",
        headers=auth_header(other["token"]),
    )
    assert resp.status_code == 403


def test_get_progress_nonexistent_session(client, student):
    """Non-existent session id -> 404."""
    resp = client.get(
        "/api/learning/sessions/999999/progress",
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Tests: PUT (save) step progress
# ---------------------------------------------------------------------------

SAMPLE_PROGRESS = {
    "current_step": "tutor",
    "steps_completed": ["reading-annotation"],
    "step_data": {
        "reading-annotation": {"annotations": [], "totalMarks": 3},
        "tutor": {"lineResults": [], "paragraphSummaries": {}},
    },
}


def test_save_progress_success(client, student, session_id):
    """Owner can save step progress; response mirrors saved data."""
    resp = client.put(
        f"/api/learning/sessions/{session_id}/progress",
        json=SAMPLE_PROGRESS,
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["session_id"] == session_id
    sp = body["step_progress"]
    assert sp is not None
    assert sp["current_step"] == "tutor"
    assert sp["steps_completed"] == ["reading-annotation"]
    assert "reading-annotation" in sp["step_data"]


def test_get_progress_after_save(client, student, session_id):
    """GET returns previously saved progress."""
    resp = client.get(
        f"/api/learning/sessions/{session_id}/progress",
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    sp = resp.json()["step_progress"]
    assert sp is not None
    assert sp["current_step"] == "tutor"
    assert sp["steps_completed"] == ["reading-annotation"]


def test_save_progress_overwrites(client, student, session_id):
    """Second PUT overwrites the first."""
    updated = {
        "current_step": "comprehension",
        "steps_completed": ["reading-annotation", "tutor"],
        "step_data": {"reading-annotation": {"annotations": [], "totalMarks": 3}},
    }
    resp = client.put(
        f"/api/learning/sessions/{session_id}/progress",
        json=updated,
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    sp = resp.json()["step_progress"]
    assert sp["current_step"] == "comprehension"
    assert sp["steps_completed"] == ["reading-annotation", "tutor"]


def test_save_progress_wrong_owner(client, other, session_id):
    """Other user PUT -> 403."""
    resp = client.put(
        f"/api/learning/sessions/{session_id}/progress",
        json=SAMPLE_PROGRESS,
        headers=auth_header(other["token"]),
    )
    assert resp.status_code == 403


def test_save_progress_nonexistent_session(client, student):
    """Non-existent session PUT -> 404."""
    resp = client.put(
        "/api/learning/sessions/999999/progress",
        json=SAMPLE_PROGRESS,
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 404


def test_save_progress_empty_payload(client, student, session_id):
    """Empty progress payload is valid (resets to empty state)."""
    empty = {"current_step": None, "steps_completed": [], "step_data": {}}
    resp = client.put(
        f"/api/learning/sessions/{session_id}/progress",
        json=empty,
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200
    sp = resp.json()["step_progress"]
    assert sp["current_step"] is None
    assert sp["steps_completed"] == []
    assert sp["step_data"] == {}
