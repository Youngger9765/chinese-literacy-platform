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

# "L06" is a first-edition lesson code. #1135 added a gate requiring the slug to name a
# real story, and these eight tests have errored ever since — permanently red tests are
# where a genuine regression hides.
from app.services.lesson_loader import get_all_lessons

_ALL_LESSON_SLUGS = [str(lesson["id"]) for lesson in get_all_lessons()]
_VALID_SLUG = _ALL_LESSON_SLUGS[0]


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
        json={"story_slug": _VALID_SLUG},
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


# ---------------------------------------------------------------------------
# Tests: mid-session step-complete XP + badge check (Issue #3024)
#
# #3024's PRD found XP_REWARDS["step_complete"] already defined but never
# awarded anywhere in the codebase -- the data model had a place for
# "finishing a step gives XP" but nothing was wired to it. This is the ONE
# place every step completion already flows through: PUT .../progress with
# the step id freshly added to steps_completed. Wiring it here (rather than
# a brand-new endpoint) needs no new API surface and no DB migration.
#
# These tests use a dedicated fresh_session_id per test (not the module-scoped
# session_id shared by the tests above) so XP side effects from one test never
# leak into another.
# ---------------------------------------------------------------------------


_fresh_slug_counter = iter(range(1, len(_ALL_LESSON_SLUGS)))


@pytest.fixture()
def fresh_session_id(client, student):
    """A brand-new session per test, isolated from the shared module session_id.

    POST /api/learning/sessions get-or-creates: it returns the existing
    in_progress session for the SAME (user, story_slug) pair instead of a new
    one (#984 dedup). The shared `student` fixture is module-scoped, so
    reusing `_VALID_SLUG` here would silently hand every test the SAME
    session — each call uses a distinct slug to guarantee genuine isolation.
    """
    slug = _ALL_LESSON_SLUGS[next(_fresh_slug_counter)]
    resp = client.post(
        "/api/learning/sessions",
        json={"story_slug": slug},
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_first_step_completion_awards_step_complete_xp(client, student, fresh_session_id):
    """Completing a step for the first time awards step_complete XP (3xp)."""
    resp = client.put(
        f"/api/learning/sessions/{fresh_session_id}/progress",
        json={
            "current_step": "vocab-definition",
            "steps_completed": ["vocab-definition"],
            "step_data": {},
        },
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["xp_awarded"] == 3
    assert body["badges_unlocked"] == []


def test_resaving_same_completed_step_does_not_double_award(client, student, fresh_session_id):
    """Saving the SAME steps_completed list again must not award XP twice
    (component remounts / debounced re-saves must be idempotent per step)."""
    payload = {
        "current_step": "vocab-definition",
        "steps_completed": ["vocab-definition"],
        "step_data": {},
    }
    r1 = client.put(
        f"/api/learning/sessions/{fresh_session_id}/progress",
        json=payload,
        headers=auth_header(student["token"]),
    )
    assert r1.json()["xp_awarded"] == 3

    r2 = client.put(
        f"/api/learning/sessions/{fresh_session_id}/progress",
        json=payload,
        headers=auth_header(student["token"]),
    )
    assert r2.json()["xp_awarded"] == 0


def test_multiple_new_steps_in_one_save_each_award_xp(client, student, fresh_session_id):
    """A single save that newly-completes 2 steps at once (a batched/debounced
    sync catching up) must award XP for each newly-completed step, not just one."""
    resp = client.put(
        f"/api/learning/sessions/{fresh_session_id}/progress",
        json={
            "current_step": "comprehension",
            "steps_completed": ["vocab-definition", "comprehension"],
            "step_data": {},
        },
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["xp_awarded"] == 6  # 2 newly-completed steps * 3xp


def test_report_step_completion_is_excluded_from_step_complete_xp(client, student, fresh_session_id):
    """'report' is the results page itself (marked complete by ReportPage on
    mount for teacher-dashboard visibility), not a step the student practiced --
    it must NOT earn step_complete XP. Awarding it would double-count against
    the session_complete settlement that fires in the same moment."""
    resp = client.put(
        f"/api/learning/sessions/{fresh_session_id}/progress",
        json={"current_step": "report", "steps_completed": ["report"], "step_data": {}},
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["xp_awarded"] == 0
    assert resp.json()["badges_unlocked"] == []


def test_get_progress_response_defaults_xp_fields_to_empty(client, student, fresh_session_id):
    """GET (read-only) never awards XP -- new fields default to 0/[] so old
    clients that don't read them see no behavior change."""
    client.put(
        f"/api/learning/sessions/{fresh_session_id}/progress",
        json={
            "current_step": "vocab-definition",
            "steps_completed": ["vocab-definition"],
            "step_data": {},
        },
        headers=auth_header(student["token"]),
    )
    resp = client.get(
        f"/api/learning/sessions/{fresh_session_id}/progress",
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["xp_awarded"] == 0
    assert resp.json()["badges_unlocked"] == []


def test_midsession_step_complete_does_not_block_session_complete_settlement(
    client, student, fresh_session_id,
):
    """End-to-end version of the #3024 root-cause fix: completing a step
    mid-session (which now writes a StudentXPLog row for this session_id)
    must not make POST /gamification/session-complete believe the session
    was already settled."""
    client.put(
        f"/api/learning/sessions/{fresh_session_id}/progress",
        json={
            "current_step": "vocab-definition",
            "steps_completed": ["vocab-definition"],
            "step_data": {},
        },
        headers=auth_header(student["token"]),
    )

    me = client.get("/api/users/me", headers=auth_header(student["token"]))
    assert me.status_code == 200, me.text
    student_id = me.json()["id"]

    resp = client.post(
        "/api/gamification/session-complete",
        json={"student_id": student_id, "session_id": fresh_session_id},
        headers=auth_header(student["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    event_types = [e["event_type"] for e in body["xp_breakdown"]]
    assert "session_complete" in event_types, (
        "Mid-session step_complete XP incorrectly suppressed the "
        f"session_complete settlement. Got breakdown: {body['xp_breakdown']!r}"
    )
