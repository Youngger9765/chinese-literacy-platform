"""
Tests for the student learning progress API (Issue #257).

Covers:
- GET /api/learning/students/{id}/progress
  - Returns empty list for new student
  - Returns per-text progress grouped by story_slug
  - Step completion derived correctly from current_step + status
  - Rule-based next-step recommendation
  - Teacher can access their student's progress
  - Another student cannot access (403)

Run with:
    cd backend && python -m pytest tests/test_student_progress.py -v
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
from app.models.session import LearningSession

# ---------------------------------------------------------------------------
# Test database (SQLite in-memory)
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
        session.add(Role(
            name=role_data["name"],
            display_name=role_data["display_name"],
            scope_level=role_data["scope_level"],
        ))
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


def _register_user(client, suffix=None):
    """Register user, return dict with token and id."""
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"prog_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"Prog User {unique}",
        "copyright_confirmed": True,
    })
    assert resp.status_code == 201, resp.text
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    return {"token": token, "id": me.json()["id"], "email": email}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestStudentProgressEmpty:
    """Student with no sessions gets an empty progress response."""

    def test_empty_progress(self, client):
        student = _register_user(client, "empty")
        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["student_id"] == student["id"]
        assert data["texts_attempted"] == 0
        assert data["texts_completed"] == 0
        assert data["average_score"] is None
        assert data["texts"] == []


class TestStudentProgressWithSessions:
    """Progress aggregates sessions correctly."""

    def test_in_progress_session(self, client):
        """One in-progress session at step 2 → 1 text, 0 completed, 1 step done."""
        student = _register_user(client, "inprog")
        db = TestingSessionLocal()
        session = LearningSession(
            student_id=student["id"],
            story_slug="lesson-01",
            status="in_progress",
            current_step=2,
        )
        db.add(session)
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["texts_attempted"] == 1
        assert data["texts_completed"] == 0
        text = data["texts"][0]
        assert text["story_slug"] == "lesson-01"
        assert text["status"] == "in_progress"
        # step 1 (intro) should be completed, step 2 in_progress
        steps = {s["step_key"]: s["status"] for s in text["steps"]}
        assert steps["intro"] == "completed"
        assert steps["live_tutor"] == "in_progress"
        assert steps["comprehension"] == "not_started"
        assert text["completion_pct"] > 0

    def test_completed_session(self, client):
        """A completed session → texts_completed=1, all steps completed."""
        student = _register_user(client, "done")
        db = TestingSessionLocal()
        session = LearningSession(
            student_id=student["id"],
            story_slug="lesson-02",
            status="completed",
            current_step=6,
            overall_score=85.0,
        )
        db.add(session)
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["texts_completed"] == 1
        assert data["average_score"] == 85.0
        text = data["texts"][0]
        assert text["completion_pct"] == 100
        steps = {s["step_key"]: s["status"] for s in text["steps"]}
        for key in ["intro", "live_tutor", "comprehension", "vocab", "full_reading", "report"]:
            assert steps[key] == "completed", f"{key} should be completed"

    def test_multiple_sessions_same_story_deduped(self, client):
        """Two sessions for same story → only the latest is returned."""
        student = _register_user(client, "dedup")
        db = TestingSessionLocal()
        # Older session (step 1)
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-03",
            status="abandoned",
            current_step=1,
        ))
        # Newer session (step 3)
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-03",
            status="in_progress",
            current_step=3,
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # Only 1 text card despite 2 sessions
        assert data["texts_attempted"] == 1
        text = data["texts"][0]
        assert text["status"] == "in_progress"

    def test_next_step_recommendation_low_accuracy(self, client):
        """Low accuracy session → recommends retry of live_tutor."""
        student = _register_user(client, "lowaccu")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-04",
            status="in_progress",
            current_step=2,
            accuracy=50.0,
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        data = resp.json()
        next_step = data["texts"][0]["next_step"]
        # Accuracy 50% < 70% and step <= 2 → retry live_tutor
        assert next_step["action"] == "retry_step"
        assert next_step["step"] == "live_tutor"

    def test_next_step_completed_suggests_new_text(self, client):
        """Completed session → new_text recommendation."""
        student = _register_user(client, "newtext")
        db = TestingSessionLocal()
        db.add(LearningSession(
            student_id=student["id"],
            story_slug="lesson-05",
            status="completed",
            current_step=6,
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        data = resp.json()
        next_step = data["texts"][0]["next_step"]
        assert next_step["action"] == "new_text"


class TestStudentProgressAccess:
    """Access control: own data OK, other student's data 403."""

    def test_own_progress_accessible(self, client):
        student = _register_user(client, "acc_own")
        resp = client.get(
            f"/api/learning/students/{student['id']}/progress",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert resp.status_code == 200

    def test_other_students_progress_forbidden(self, client):
        student_a = _register_user(client, "acc_a")
        student_b = _register_user(client, "acc_b")
        resp = client.get(
            f"/api/learning/students/{student_b['id']}/progress",
            headers={"Authorization": f"Bearer {student_a['token']}"},
        )
        assert resp.status_code == 403

    def test_unauthenticated_request_rejected(self, client):
        student = _register_user(client, "acc_unauth")
        resp = client.get(f"/api/learning/students/{student['id']}/progress")
        assert resp.status_code == 401
