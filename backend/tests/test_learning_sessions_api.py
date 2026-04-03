"""
Tests for the learning session persistence API.

Covers:
- POST   /api/learning/sessions        (create)
- GET    /api/learning/sessions         (list own)
- GET    /api/learning/sessions/{id}    (detail)
- PATCH  /api/learning/sessions/{id}    (update)
- GET    /api/learning/sessions/{id}/report (report alias)

Uses SQLite in-memory DB to avoid any external dependency.
conftest.py patches JSONB -> JSON for SQLite compatibility.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-223/backend
    python -m pytest tests/test_learning_sessions_api.py -v
"""

import sys
import os
import uuid

# Allow running pytest from the repo root or from backend/
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
# Test database setup (SQLite in-memory with StaticPool)
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
    """Create all tables once, seed roles, override get_db, and clean up at end."""
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
    """Register a user and return {email, password, token, name}."""
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"sess_user_{unique}@example.com"
    password = "SecurePass123!"
    name = f"Session User {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201, resp.text
    verification_token = resp.json().get("verification_token")
    if verification_token:
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
    """First test user."""
    return _register_user(client, "user_a")


@pytest.fixture(scope="module")
def user_b(client):
    """Second test user (for ownership tests)."""
    return _register_user(client, "user_b")


# ===========================================================================
# POST /api/learning/sessions — Create session
# ===========================================================================


class TestCreateSession:
    def test_create_returns_201(self, client, user_a):
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "test-story-01"},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 201

    def test_create_returns_session_fields(self, client, user_a):
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "fields-test"},
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert "id" in data
        assert data["story_slug"] == "fields-test"
        assert data["status"] == "in_progress"
        assert data["current_step"] == 1
        assert data["started_at"] is not None
        assert data["completed_at"] is None
        assert data["accuracy"] is None
        assert data["overall_score"] is None
        assert data["reading_result"] is None
        assert data["comprehension_result"] is None
        assert data["vocab_result"] is None
        assert data["full_reading_result"] is None

    def test_create_with_story_title(self, client, user_a):
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "title-test", "story_title": "Test Title"},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 201

    def test_create_missing_story_slug_returns_422(self, client, user_a):
        resp = client.post(
            "/api/learning/sessions",
            json={},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422

    def test_create_empty_story_slug_returns_422(self, client, user_a):
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": ""},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422

    def test_create_requires_auth(self, client):
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "no-auth"},
        )
        assert resp.status_code == 401

    def test_create_invalid_token_returns_401(self, client):
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "bad-token"},
            headers=auth_header("invalid.jwt.token"),
        )
        assert resp.status_code == 401


# ===========================================================================
# GET /api/learning/sessions — List own sessions
# ===========================================================================


class TestListSessions:
    def test_list_returns_200(self, client, user_a):
        resp = client.get(
            "/api/learning/sessions",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200

    def test_list_returns_items_and_total(self, client, user_a):
        resp = client.get(
            "/api/learning/sessions",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
        assert isinstance(data["total"], int)

    def test_list_shows_own_sessions(self, client, user_a):
        """User A's sessions should include previously created ones."""
        resp = client.get(
            "/api/learning/sessions",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert data["total"] >= 1  # at least the ones created in TestCreateSession

    def test_list_does_not_show_other_users_sessions(self, client, user_a, user_b):
        # Create a session for user_b
        client.post(
            "/api/learning/sessions",
            json={"story_slug": "user-b-story"},
            headers=auth_header(user_b["token"]),
        )

        # user_a should not see user_b's sessions
        resp = client.get(
            "/api/learning/sessions",
            headers=auth_header(user_a["token"]),
        )
        slugs = [item["story_slug"] for item in resp.json()["items"]]
        assert "user-b-story" not in slugs

    def test_list_pagination_limit(self, client, user_a):
        resp = client.get(
            "/api/learning/sessions?limit=1",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert len(data["items"]) <= 1
        # total should still reflect the full count
        assert data["total"] >= 1

    def test_list_pagination_offset(self, client, user_a):
        # Get total first
        resp_all = client.get(
            "/api/learning/sessions",
            headers=auth_header(user_a["token"]),
        )
        total = resp_all.json()["total"]

        # Offset past all items
        resp = client.get(
            f"/api/learning/sessions?offset={total}",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert len(data["items"]) == 0
        assert data["total"] == total

    def test_list_empty_for_new_user(self, client):
        new_user = _register_user(client, "empty_list")
        resp = client.get(
            "/api/learning/sessions",
            headers=auth_header(new_user["token"]),
        )
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_requires_auth(self, client):
        resp = client.get("/api/learning/sessions")
        assert resp.status_code == 401


# ===========================================================================
# GET /api/learning/sessions/{id} — Session detail
# ===========================================================================


class TestGetSessionDetail:
    def test_get_detail_returns_200(self, client, user_a):
        # Create a session first
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "detail-test"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/learning/sessions/{session_id}",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200

    def test_get_detail_returns_full_fields(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "detail-fields"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/learning/sessions/{session_id}",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        expected_fields = [
            "id", "story_slug", "status", "current_step",
            "accuracy", "overall_score", "started_at", "completed_at",
            "reading_result", "comprehension_result",
            "vocab_result", "full_reading_result",
        ]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"

    def test_get_detail_not_found_returns_404(self, client, user_a):
        resp = client.get(
            "/api/learning/sessions/999999",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Session not found"

    def test_get_detail_other_users_session_returns_403(self, client, user_a, user_b):
        # Create session as user_b
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "owned-by-b"},
            headers=auth_header(user_b["token"]),
        )
        session_id = create_resp.json()["id"]

        # user_a tries to access it
        resp = client.get(
            f"/api/learning/sessions/{session_id}",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Not your session"

    def test_get_detail_requires_auth(self, client):
        resp = client.get("/api/learning/sessions/1")
        assert resp.status_code == 401


# ===========================================================================
# PATCH /api/learning/sessions/{id} — Update session
# ===========================================================================


class TestUpdateSession:
    def test_update_step(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "update-step"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"current_step": 3},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["current_step"] == 3

    def test_update_status(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "update-status"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"status": "completed"},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"

    def test_update_accuracy_and_score(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "update-score"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"accuracy": 85.5, "overall_score": 90.0},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["accuracy"] == 85.5
        assert resp.json()["overall_score"] == 90.0

    def test_update_reading_result(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "update-reading"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        reading_data = {"wpm": 120, "accuracy": 92.5, "errors": ["the", "quick"]}
        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"reading_result": reading_data},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["reading_result"] == reading_data

    def test_update_comprehension_result(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "update-comp"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        comp_data = {"understood_count": 4, "required_count": 5, "score": 80}
        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"comprehension_result": comp_data},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["comprehension_result"] == comp_data

    def test_update_vocab_result(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "update-vocab"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        vocab_data = {"total": 10, "correct": 8, "wrong": ["cat", "dog"]}
        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"vocab_result": vocab_data},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["vocab_result"] == vocab_data

    def test_update_full_reading_result(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "update-full-read"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        full_data = {"wpm": 150, "fluency_score": 88, "recording_url": "gs://bucket/audio.wav"}
        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"full_reading_result": full_data},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["full_reading_result"] == full_data

    def test_update_mark_completed(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "mark-complete"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={
                "status": "completed",
                "current_step": 6,
                "overall_score": 95.0,
                "completed_at": "2026-03-05T12:00:00Z",
            },
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "completed"
        assert data["current_step"] == 6
        assert data["overall_score"] == 95.0
        assert data["completed_at"] is not None

    def test_update_not_found_returns_404(self, client, user_a):
        resp = client.patch(
            "/api/learning/sessions/999999",
            json={"current_step": 2},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 404

    def test_update_other_users_session_returns_403(self, client, user_a, user_b):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "b-session-update"},
            headers=auth_header(user_b["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"current_step": 2},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 403

    def test_update_requires_auth(self, client):
        resp = client.patch(
            "/api/learning/sessions/1",
            json={"current_step": 2},
        )
        assert resp.status_code == 401

    def test_update_invalid_step_too_high_returns_422(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "invalid-step"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"current_step": 99},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422

    def test_update_invalid_step_zero_returns_422(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "step-zero"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"current_step": 0},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422

    def test_update_invalid_status_returns_422(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "bad-status"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"status": "invalid_status"},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422

    def test_update_empty_body_is_noop(self, client, user_a):
        """PATCH with empty body should succeed without changing anything."""
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "noop-update"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["current_step"] == 1
        assert resp.json()["status"] == "in_progress"

    def test_update_multiple_fields_at_once(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "multi-update"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={
                "current_step": 4,
                "accuracy": 78.3,
                "comprehension_result": {"q1": True, "q2": False},
            },
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["current_step"] == 4
        assert data["accuracy"] == 78.3
        assert data["comprehension_result"] == {"q1": True, "q2": False}


# ===========================================================================
# GET /api/learning/sessions/{id}/report — Report alias
# ===========================================================================


class TestGetSessionReport:
    def test_report_returns_200(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "report-test"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/learning/sessions/{session_id}/report",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200

    def test_report_matches_detail(self, client, user_a):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "report-match"},
            headers=auth_header(user_a["token"]),
        )
        session_id = create_resp.json()["id"]

        detail_resp = client.get(
            f"/api/learning/sessions/{session_id}",
            headers=auth_header(user_a["token"]),
        )
        report_resp = client.get(
            f"/api/learning/sessions/{session_id}/report",
            headers=auth_header(user_a["token"]),
        )
        assert detail_resp.json() == report_resp.json()

    def test_report_not_found_returns_404(self, client, user_a):
        resp = client.get(
            "/api/learning/sessions/999999/report",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 404

    def test_report_other_users_session_returns_403(self, client, user_a, user_b):
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "b-report"},
            headers=auth_header(user_b["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/learning/sessions/{session_id}/report",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 403

    def test_report_requires_auth(self, client):
        resp = client.get("/api/learning/sessions/1/report")
        assert resp.status_code == 401


# ===========================================================================
# End-to-end flow
# ===========================================================================


class TestSessionFlow:
    def test_full_session_lifecycle(self, client):
        """Create -> update step by step -> complete -> verify in list and report."""
        user = _register_user(client, "lifecycle")
        headers = auth_header(user["token"])

        # 1. Create session
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "lifecycle-story"},
            headers=headers,
        )
        assert create_resp.status_code == 201
        session_id = create_resp.json()["id"]

        # 2. Progress through steps
        for step in range(2, 7):
            resp = client.patch(
                f"/api/learning/sessions/{session_id}",
                json={"current_step": step},
                headers=headers,
            )
            assert resp.status_code == 200
            assert resp.json()["current_step"] == step

        # 3. Add results
        client.patch(
            f"/api/learning/sessions/{session_id}",
            json={
                "reading_result": {"wpm": 100},
                "comprehension_result": {"score": 85},
                "vocab_result": {"correct": 9, "total": 10},
                "full_reading_result": {"fluency": 90},
                "accuracy": 88.0,
                "overall_score": 87.5,
                "status": "completed",
                "completed_at": "2026-03-05T15:30:00Z",
            },
            headers=headers,
        )

        # 4. Verify in list
        list_resp = client.get("/api/learning/sessions", headers=headers)
        items = list_resp.json()["items"]
        found = [i for i in items if i["id"] == session_id]
        assert len(found) == 1
        assert found[0]["status"] == "completed"
        assert found[0]["overall_score"] == 87.5

        # 5. Verify report
        report_resp = client.get(
            f"/api/learning/sessions/{session_id}/report",
            headers=headers,
        )
        report = report_resp.json()
        assert report["reading_result"] == {"wpm": 100}
        assert report["comprehension_result"] == {"score": 85}
        assert report["vocab_result"] == {"correct": 9, "total": 10}
        assert report["full_reading_result"] == {"fluency": 90}
        assert report["status"] == "completed"
