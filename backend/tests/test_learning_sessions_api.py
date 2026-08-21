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
from app.models.text import Text
from app.models.user import Role

# Canonical slug used for all happy-path session creation tests (#1135).
# Must match a seeded Text row (lesson_number=VALID_LESSON_NUM).
VALID_LESSON_NUM = 1
VALID_SLUG = str(VALID_LESSON_NUM)  # "1"

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


def _seed_text(session):
    """Seed a single Text row so story_slug validation (#1135) passes in tests."""
    text = Text(
        title="Test Lesson",
        paragraphs=["Test paragraph."],
        char_count=14,
        grade=4,
        grade_code="G4-1",
        genre="記敘文",
        text_type="單",
        category="Fable",
        lesson_number=VALID_LESSON_NUM,
    )
    session.add(text)
    session.commit()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    """Create all tables once, seed roles + text, override get_db, and clean up at end."""
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _seed_text(session)
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

# #1182 made `step_progress.steps_completed` the single source of truth for how far a
# student has got; the integer `current_step` column is no longer synced and the value
# a session reports is derived. PATCHing `current_step` is still accepted — it is in
# the request schema — but it does not move the reported step, by design. These tests
# asserted the old round-trip and had been failing since that change.
_STEP_ORDER = ["intro", "live_tutor", "comprehension", "vocab", "full_reading", "report"]


def _advance_to_step(client, token: str, session_id: int, step_num: int) -> None:
    """Complete steps 1..step_num-1 so the session reports `step_num` as current."""
    resp = client.put(
        f"/api/learning/sessions/{session_id}/progress",
        json={"current_step": _STEP_ORDER[step_num - 1],
              "steps_completed": _STEP_ORDER[: step_num - 1],
              "step_data": {}},
        headers=auth_header(token),
    )
    assert resp.status_code in (200, 201), resp.text




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
            json={"story_slug": VALID_SLUG},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 201

    def test_create_returns_session_fields(self, client, user_a):
        # Use a new user so there's no existing in_progress session for this slug
        new_user = _register_user(client, "fields_test")
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(new_user["token"]),
        )
        data = resp.json()
        assert "id" in data
        assert data["story_slug"] == VALID_SLUG
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
            json={"story_slug": VALID_SLUG, "story_title": "Test Title"},
            headers=auth_header(user_a["token"]),
        )
        # get-or-create: returns existing in_progress session — 201 either way
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
            json={"story_slug": VALID_SLUG},
        )
        assert resp.status_code == 401

    def test_create_invalid_token_returns_401(self, client):
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header("invalid.jwt.token"),
        )
        assert resp.status_code == 401

    # ------------------------------------------------------------------
    # slug validation tests (#1135)
    # ------------------------------------------------------------------

    def test_create_unknown_numeric_slug_returns_422(self, client, user_a):
        """A numeric slug with no matching lesson_number must be rejected."""
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "9999"},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422
        assert "unknown story_slug" in resp.json()["detail"]

    def test_create_bogus_nonnumeric_slug_returns_422(self, client, user_a):
        """Typo slug like 'esson-1' (non-numeric, non-existent) must be rejected."""
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "esson-1"},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422
        assert "unknown story_slug" in resp.json()["detail"]

    def test_create_l_prefix_valid_slug_returns_201(self, client):
        """L01 normalizes to '1', which exists in texts — must be accepted."""
        new_user = _register_user(client, "l01_test")
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "L01"},
            headers=auth_header(new_user["token"]),
        )
        assert resp.status_code == 201

    def test_create_zero_padded_valid_slug_returns_201(self, client):
        """'01' normalizes to '1', which exists — must be accepted."""
        new_user = _register_user(client, "pad01_test")
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": "01"},
            headers=auth_header(new_user["token"]),
        )
        assert resp.status_code == 201


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
        # Create a session for user_b (uses valid slug)
        client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(user_b["token"]),
        )

        # user_a should only see their own sessions, not user_b's
        resp_a = client.get(
            "/api/learning/sessions",
            headers=auth_header(user_a["token"]),
        )
        resp_b = client.get(
            "/api/learning/sessions",
            headers=auth_header(user_b["token"]),
        )
        ids_a = {item["id"] for item in resp_a.json()["items"]}
        ids_b = {item["id"] for item in resp_b.json()["items"]}
        assert not ids_a.intersection(ids_b), "Users must not share session IDs"

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
        # Create a session first (get-or-create returns existing one — that's fine)
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
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
            json={"story_slug": VALID_SLUG},
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
        # Create session as user_b (get-or-create returns existing or new)
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
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
    def test_update_step(self, client):
        u = _register_user(client, "upd_step")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"current_step": 3},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200

        # The reported step follows completed progress, not the PATCH body (#1182).
        _advance_to_step(client, u["token"], session_id, 3)
        again = client.get(f"/api/learning/sessions/{session_id}",
                           headers=auth_header(u["token"]))
        assert again.json()["current_step"] == 3

    def test_update_status(self, client):
        u = _register_user(client, "upd_status")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"status": "completed"},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "completed"

    def test_update_accuracy_and_score(self, client):
        u = _register_user(client, "upd_score")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"accuracy": 85.5, "overall_score": 90.0},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["accuracy"] == 85.5
        assert resp.json()["overall_score"] == 90.0

    def test_update_reading_result(self, client):
        u = _register_user(client, "upd_reading")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        reading_data = {"wpm": 120, "accuracy": 92.5, "errors": ["the", "quick"]}
        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"reading_result": reading_data},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["reading_result"] == reading_data

    def test_update_comprehension_result(self, client):
        u = _register_user(client, "upd_comp")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        comp_data = {"understood_count": 4, "required_count": 5, "score": 80}
        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"comprehension_result": comp_data},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["comprehension_result"] == comp_data

    def test_update_vocab_result(self, client):
        u = _register_user(client, "upd_vocab")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        vocab_data = {"total": 10, "correct": 8, "wrong": ["cat", "dog"]}
        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"vocab_result": vocab_data},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["vocab_result"] == vocab_data

    def test_update_full_reading_result(self, client):
        u = _register_user(client, "upd_fullrd")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        full_data = {"wpm": 150, "fluency_score": 88, "recording_url": "gs://bucket/audio.wav"}
        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"full_reading_result": full_data},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["full_reading_result"] == full_data

    def test_update_mark_completed(self, client):
        u = _register_user(client, "upd_mkcomp")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
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
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "completed"
        assert data["overall_score"] == 95.0
        # The step a completed session reports comes from what was completed (#1182),
        # so it is 6 once the five preceding steps are marked done — not because the
        # PATCH body said so.
        _advance_to_step(client, u["token"], session_id, 6)
        again = client.get(f"/api/learning/sessions/{session_id}",
                           headers=auth_header(u["token"]))
        assert again.json()["current_step"] == 6
        assert data["completed_at"] is not None

    def test_update_not_found_returns_404(self, client, user_a):
        resp = client.patch(
            "/api/learning/sessions/999999",
            json={"current_step": 2},
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 404

    def test_update_other_users_session_returns_403(self, client, user_a, user_b):
        u_c = _register_user(client, "upd403_c")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u_c["token"]),
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

    def test_update_invalid_step_too_high_returns_422(self, client):
        u = _register_user(client, "upd_hi_step")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"current_step": 99},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 422

    def test_update_invalid_step_zero_returns_422(self, client):
        u = _register_user(client, "upd_zero_step")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"current_step": 0},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 422

    def test_update_invalid_status_returns_422(self, client):
        u = _register_user(client, "upd_bad_stat")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={"status": "invalid_status"},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 422

    def test_update_empty_body_is_noop(self, client):
        """PATCH with empty body should succeed without changing anything."""
        u = _register_user(client, "upd_noop")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={},
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["current_step"] == 1
        assert resp.json()["status"] == "in_progress"

    def test_update_multiple_fields_at_once(self, client):
        u = _register_user(client, "upd_multi")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/learning/sessions/{session_id}",
            json={
                "current_step": 4,
                "accuracy": 78.3,
                "comprehension_result": {"q1": True, "q2": False},
            },
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        _advance_to_step(client, u["token"], session_id, 4)
        data = client.get(f"/api/learning/sessions/{session_id}",
                          headers=auth_header(u["token"])).json()
        assert data["current_step"] == 4
        assert data["accuracy"] == 78.3
        assert data["comprehension_result"] == {"q1": True, "q2": False}


# ===========================================================================
# GET /api/learning/sessions/{id}/report — Report alias
# ===========================================================================


class TestGetSessionReport:
    def test_report_returns_200(self, client):
        u = _register_user(client, "rpt_200")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/learning/sessions/{session_id}/report",
            headers=auth_header(u["token"]),
        )
        assert resp.status_code == 200

    def test_report_matches_detail(self, client):
        u = _register_user(client, "rpt_match")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u["token"]),
        )
        session_id = create_resp.json()["id"]

        detail_resp = client.get(
            f"/api/learning/sessions/{session_id}",
            headers=auth_header(u["token"]),
        )
        report_resp = client.get(
            f"/api/learning/sessions/{session_id}/report",
            headers=auth_header(u["token"]),
        )
        assert detail_resp.json() == report_resp.json()

    def test_report_not_found_returns_404(self, client, user_a):
        resp = client.get(
            "/api/learning/sessions/999999/report",
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 404

    def test_report_other_users_session_returns_403(self, client, user_a):
        u_d = _register_user(client, "rpt403_d")
        create_resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=auth_header(u_d["token"]),
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
            json={"story_slug": VALID_SLUG},
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
            _advance_to_step(client, user["token"], session_id, step)
            seen = client.get(f"/api/learning/sessions/{session_id}", headers=headers)
            assert seen.json()["current_step"] == step

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


# ===========================================================================
# Issue #1184 — Self-study sessions must NOT be attributed to any classroom
# ===========================================================================


class TestSelfStudyClassroomIdNull:
    """Regression tests for Issue #1184.

    A self-study session (no assignment, no classroom context in the request)
    must have classroom_id = None.  Previously the code used .first() on the
    student's ClassroomStudent enrollments, which arbitrarily picked a classroom
    and misattributed the session when the student was in multiple classrooms.
    """

    def test_self_study_session_has_null_classroom_id(self, client):
        """Self-study session created without assignment context → classroom_id NULL."""
        from app.models.session import LearningSession

        user = _register_user(client, "1184_single")
        headers = auth_header(user["token"])

        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=headers,
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

        # Verify directly in the DB that classroom_id is NULL
        db = TestingSessionLocal()
        try:
            row = db.query(LearningSession).filter(LearningSession.id == session_id).first()
            assert row is not None
            assert row.classroom_id is None, (
                f"Expected classroom_id=None for self-study session, got {row.classroom_id}"
            )
        finally:
            db.close()

    def test_self_study_session_null_even_when_enrolled_in_classroom(self, client):
        """Student enrolled in a classroom creates self-study → classroom_id stays NULL.

        This is the core regression case from Issue #1184: a student in Class A
        and Class B should NOT have their self-study session attributed to either.
        """
        from app.models.session import LearningSession
        from app.models.school import ClassroomStudent, Classroom, School
        from app.models.user import User

        user = _register_user(client, "1184_enrolled")
        headers = auth_header(user["token"])

        # Seed school → classroom → enrollment directly in the DB
        db = TestingSessionLocal()
        try:
            db_user = db.query(User).filter(User.email == user["email"]).first()
            assert db_user is not None

            school = School(name="Test School 1184")
            db.add(school)
            db.flush()

            # Use the same user as teacher (valid FK; role doesn't matter for this test)
            classroom = Classroom(
                name="Test Class 1184",
                grade=4,
                teacher_id=db_user.id,
                school_id=school.id,
            )
            db.add(classroom)
            db.flush()

            enrollment = ClassroomStudent(
                student_id=db_user.id,
                classroom_id=classroom.id,
            )
            db.add(enrollment)
            db.commit()
            classroom_id_seeded = classroom.id
        finally:
            db.close()

        # Create a self-study session (no assignment reference in request)
        resp = client.post(
            "/api/learning/sessions",
            json={"story_slug": VALID_SLUG},
            headers=headers,
        )
        assert resp.status_code == 201
        session_id = resp.json()["id"]

        # classroom_id must be NULL — not the enrolled classroom
        db = TestingSessionLocal()
        try:
            row = db.query(LearningSession).filter(LearningSession.id == session_id).first()
            assert row is not None
            assert row.classroom_id is None, (
                f"Self-study session was misattributed to classroom {row.classroom_id} "
                f"(expected None). Issue #1184 regression."
            )
            # Confirm the enrollment itself still exists (we didn't break enrollment data)
            enroll = (
                db.query(ClassroomStudent)
                .filter(
                    ClassroomStudent.student_id == row.student_id,
                    ClassroomStudent.classroom_id == classroom_id_seeded,
                )
                .first()
            )
            assert enroll is not None, "Enrollment should not have been deleted"
        finally:
            db.close()
