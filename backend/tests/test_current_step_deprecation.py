"""
Regression tests for Issue #1182 — deprecate current_step integer column.

Verifies:
- LearningSession.current_step_derived returns correct step from step_progress
- current_step_derived returns 1 for sessions with no step_progress
- Saving step progress via PUT does NOT write to current_step integer column
- Session creation does NOT set current_step to a non-default value
- GET /learning/sessions/{id}/status returns derived step (not stale integer)
- PATCH /learning/sessions/{id} with current_step payload does NOT write the column

Run with:
    cd backend && JWT_SECRET_KEY=test-secret python -m pytest tests/test_current_step_deprecation.py -v
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
from app.models.session import LearningSession
from app.models.text import Text
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

# Use lesson_number=98 (unlikely to collide with other test modules)
VALID_LESSON_NUM = 98
VALID_SLUG = str(VALID_LESSON_NUM)


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
        # Seed a Text row for story_slug validation (#1135)
        if not db.query(Text).filter_by(lesson_number=VALID_LESSON_NUM).first():
            db.add(Text(
                title="Test Lesson 1182",
                paragraphs=["Test paragraph."],
                char_count=14,
                grade=4,
                grade_code="G4-1",
                genre="記敘文",
                text_type="單",
                category="Fable",
                lesson_number=VALID_LESSON_NUM,
            ))
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
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"cs1182_{unique}@example.com"
    password = "DeprecatePass1!"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"CS1182 {unique}"},
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


# ---------------------------------------------------------------------------
# Unit tests: current_step_derived property (without ORM overhead)
#
# We test the property logic directly by creating minimal stand-in objects
# that mimic the shape the property reads from (just step_progress).
# ---------------------------------------------------------------------------


class _FakeSession:
    """Minimal stand-in for LearningSession that carries the property logic.

    The property is defined on LearningSession and reads self.step_progress,
    self._FRONTEND_STEP_ALIAS, self._STEP_KEY_TO_NUM, and self._STEP_NUM_TO_KEY.
    Rather than fighting SQLAlchemy's ORM machinery in a unit test, we borrow
    the exact same property method and bind it to a plain Python object.
    """
    _STEP_KEY_TO_NUM = LearningSession._STEP_KEY_TO_NUM
    _FRONTEND_STEP_ALIAS = LearningSession._FRONTEND_STEP_ALIAS
    _STEP_NUM_TO_KEY = LearningSession._STEP_NUM_TO_KEY
    # Bind the same property method
    current_step_derived = LearningSession.current_step_derived

    def __init__(self, step_progress):
        self.step_progress = step_progress


class TestCurrentStepDerivedProperty:
    """Test the derived property logic independently."""

    def test_no_step_progress_returns_1(self):
        s = _FakeSession(None)
        assert s.current_step_derived == 1

    def test_empty_steps_completed_returns_1(self):
        s = _FakeSession({"current_step": "intro", "steps_completed": []})
        assert s.current_step_derived == 1

    def test_one_step_completed_returns_next(self):
        # completed intro (step 1) → derived = 2
        s = _FakeSession({"steps_completed": ["intro"]})
        assert s.current_step_derived == 2

    def test_two_steps_completed(self):
        # completed intro + live_tutor (steps 1, 2) → derived = 3
        s = _FakeSession({"steps_completed": ["intro", "live_tutor"]})
        assert s.current_step_derived == 3

    def test_frontend_alias_tutor(self):
        # frontend sends "tutor" (alias for live_tutor = step 2)
        # reading-annotation→intro(1), tutor→live_tutor(2) → max=2 → derived=3
        s = _FakeSession({"steps_completed": ["reading-annotation", "tutor"]})
        assert s.current_step_derived == 3

    def test_frontend_alias_full_reading(self):
        # full-reading → full_reading = step 5 → max=5 → derived=6
        s = _FakeSession({"steps_completed": ["intro", "live_tutor", "comprehension", "vocab", "full-reading"]})
        assert s.current_step_derived == 6

    def test_caps_at_max_step(self):
        # all 6 steps completed → max=6 → min(7, 6) = 6
        s = _FakeSession({
            "steps_completed": ["intro", "live_tutor", "comprehension", "vocab", "full_reading", "report"]
        })
        assert s.current_step_derived == 6

    def test_non_dict_step_progress_returns_1(self):
        s = _FakeSession("invalid_string")
        assert s.current_step_derived == 1

    def test_unknown_step_keys_ignored(self):
        # unknown keys should not crash and should return 1 (max_num stays 0)
        s = _FakeSession({"steps_completed": ["unknown_step"]})
        assert s.current_step_derived == 1


# ---------------------------------------------------------------------------
# Integration tests: write sites must NOT update current_step column
# ---------------------------------------------------------------------------


def test_session_creation_does_not_write_current_step(client, student):
    """POST /learning/sessions — new session current_step stays at default (1)."""
    resp = client.post(
        "/api/learning/sessions",
        json={"story_slug": VALID_SLUG},
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 201, resp.text
    session_id = resp.json()["id"]
    # The integer column retains the DB default (1) — we intentionally don't set it
    with TestingSessionLocal() as db:
        session = db.query(LearningSession).get(session_id)
        assert session is not None
        assert session.current_step == 1


def test_saving_step_progress_does_not_update_current_step_column(client, student):
    """PUT /progress must NOT write to the integer current_step column."""
    # Use existing session from previous test (same student + slug returns same session)
    # or create a fresh one with a distinct slug is not possible here; re-use existing.
    # Get the existing session_id from the previous test via the API.
    list_resp = client.get(
        "/api/learning/sessions",
        headers=auth_header(student["token"]),
    )
    assert list_resp.status_code == 200, list_resp.text
    sessions = list_resp.json()["items"]
    assert len(sessions) >= 1
    session_id = sessions[0]["id"]

    # Simulate student completing 3 steps
    put_resp = client.put(
        f"/api/learning/sessions/{session_id}/progress",
        json={
            "current_step": "vocab",
            "steps_completed": ["reading-annotation", "tutor", "comprehension"],
            "step_data": {},
        },
        headers=auth_header(student["token"]),
    )
    assert put_resp.status_code == 200, put_resp.text

    # Verify the integer column was NOT updated
    with TestingSessionLocal() as db:
        session = db.query(LearningSession).get(session_id)
        assert session is not None
        assert session.current_step == 1, (
            f"current_step integer column was written (got {session.current_step}), "
            "but it should be deprecated and untouched (#1182)"
        )

    # But current_step_derived should return the correct derived value
    with TestingSessionLocal() as db:
        session = db.query(LearningSession).get(session_id)
        # reading-annotation→intro(1), tutor→live_tutor(2), comprehension(3) → max=3 → derived=4
        assert session.current_step_derived == 4, (
            f"current_step_derived should be 4, got {session.current_step_derived}"
        )


def test_get_session_status_returns_derived_step(client, student):
    """GET /sessions/{id}/status current_step must reflect step_progress, not the column."""
    list_resp = client.get(
        "/api/learning/sessions",
        headers=auth_header(student["token"]),
    )
    session_id = list_resp.json()["items"][0]["id"]

    # Check status endpoint returns derived value (4 from previous test), not stale column (1)
    status_resp = client.get(
        f"/api/learning/sessions/{session_id}/status",
        headers=auth_header(student["token"]),
    )
    assert status_resp.status_code == 200, status_resp.text
    body = status_resp.json()
    # After saving progress with 3 steps (intro, live_tutor, comprehension) → derived=4
    assert body["current_step"] == 4, (
        f"status endpoint returned current_step={body['current_step']}, expected 4 (derived). "
        "The deprecated integer column (1) must not be returned."
    )


def test_patch_session_with_current_step_does_not_write_column(client, student):
    """PATCH /sessions/{id} with current_step in payload must silently discard it."""
    list_resp = client.get(
        "/api/learning/sessions",
        headers=auth_header(student["token"]),
    )
    session_id = list_resp.json()["items"][0]["id"]

    # Try patching current_step directly (should be silently ignored)
    patch_resp = client.patch(
        f"/api/learning/sessions/{session_id}",
        json={"current_step": 5, "accuracy": 85.0},
        headers=auth_header(student["token"]),
    )
    assert patch_resp.status_code == 200, patch_resp.text

    # Verify the column was NOT updated to 5
    with TestingSessionLocal() as db:
        session = db.query(LearningSession).get(session_id)
        assert session is not None
        assert session.current_step != 5, (
            "current_step integer column was written to 5 via PATCH, "
            "but writes should be disabled (#1182)"
        )
        # Accuracy should still have been updated
        assert session.accuracy == 85.0
