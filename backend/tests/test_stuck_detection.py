"""
Tests for stuck-point detection (Issue #91).

Covers:
- GET  /api/learning/students/{id}/stuck-points
- GET  /api/learning/students/{id}/recommendations
- GET  /api/teacher/classrooms/{id}/stuck-overview
- Unit tests for detect_stuck_points() and build_recommendations()

Uses SQLite in-memory DB to avoid external dependencies.
conftest.py patches JSONB -> JSON for SQLite compatibility.

Run with:
    cd backend && python -m pytest tests/test_stuck_detection.py -v
"""

import sys
import os
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole
from app.models.school import Classroom, ClassroomStudent, School
from app.models.session import CharacterError, LearningSession
from app.services.stuck_detection_service import build_recommendations, detect_stuck_points

# ---------------------------------------------------------------------------
# Test database setup
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
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]


def _seed_roles(session):
    for role_data in SEED_ROLES:
        if not session.query(Role).filter_by(name=role_data["name"]).first():
            session.add(Role(**role_data))
    session.commit()


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


_test_school_id: int = 0


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    _seed_roles(db)
    school = School(name="Stuck Test School")
    db.add(school)
    db.commit()
    db.refresh(school)
    _test_school_id = school.id
    db.close()

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def school_id():
    return _test_school_id


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201
    token = resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me_resp.json()["id"]
    return {"email": email, "name": name, "token": token, "user_id": user_id}


@pytest.fixture(scope="module")
def student(client):
    return _register_user(client, "stuck_student")


@pytest.fixture(scope="module")
def other_student(client):
    return _register_user(client, "stuck_other_stu")


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "stuck_teacher")


@pytest.fixture(scope="module")
def classroom_id(client, teacher, student, school_id):
    """Create a classroom with the teacher and enroll the student."""
    resp = client.post(
        "/api/classrooms",
        json={"name": "Stuck Test Class", "school_id": school_id},
        headers={"Authorization": f"Bearer {teacher['token']}"},
    )
    assert resp.status_code == 201
    cid = resp.json()["id"]
    client.post(
        f"/api/classrooms/{cid}/students",
        json={"student_id": student["user_id"]},
        headers={"Authorization": f"Bearer {teacher['token']}"},
    )
    return cid


# ---------------------------------------------------------------------------
# Unit tests for detect_stuck_points (pure logic)
# ---------------------------------------------------------------------------

class TestDetectStuckPoints:
    """Unit tests for the service layer (no HTTP)."""

    def test_no_sessions_returns_empty(self, student):
        db = TestingSessionLocal()
        try:
            data = detect_stuck_points(student["user_id"], db)
            assert data["story_stuck"] == []
            assert data["character_stuck"] == []
            assert data["is_declining"] is False
            assert data["accuracy_trend"] == []
        finally:
            db.close()

    def test_story_stuck_detected(self, student):
        """3 attempts on same story with flat accuracy → story_stuck."""
        db = TestingSessionLocal()
        try:
            now = datetime.now(timezone.utc)
            for i in range(3):
                s = LearningSession(
                    student_id=student["user_id"],
                    story_slug="flat-story",
                    status="completed",
                    current_step=6,
                    accuracy=60.0,
                    started_at=now - timedelta(days=10 - i),
                )
                db.add(s)
            db.commit()

            data = detect_stuck_points(student["user_id"], db)
            story_slugs = [s["story_slug"] for s in data["story_stuck"]]
            assert "flat-story" in story_slugs
        finally:
            db.query(LearningSession).filter_by(student_id=student["user_id"]).delete()
            db.commit()
            db.close()

    def test_story_not_stuck_when_improving(self, student):
        """3 attempts with significant accuracy improvement → NOT stuck."""
        db = TestingSessionLocal()
        try:
            now = datetime.now(timezone.utc)
            for i, acc in enumerate([60.0, 72.0, 88.0]):
                s = LearningSession(
                    student_id=student["user_id"],
                    story_slug="improving-story",
                    status="completed",
                    current_step=6,
                    accuracy=acc,
                    started_at=now - timedelta(days=5 - i),
                )
                db.add(s)
            db.commit()

            data = detect_stuck_points(student["user_id"], db)
            story_slugs = [s["story_slug"] for s in data["story_stuck"]]
            assert "improving-story" not in story_slugs
        finally:
            db.query(LearningSession).filter_by(student_id=student["user_id"]).delete()
            db.commit()
            db.close()

    def test_declining_accuracy_detected(self, student):
        """3 consecutive sessions with strictly decreasing accuracy → is_declining=True."""
        db = TestingSessionLocal()
        try:
            now = datetime.now(timezone.utc)
            for i, acc in enumerate([85.0, 70.0, 55.0]):
                s = LearningSession(
                    student_id=student["user_id"],
                    story_slug=f"decline-story-{i}",
                    status="completed",
                    current_step=6,
                    accuracy=acc,
                    started_at=now - timedelta(days=3 - i),
                )
                db.add(s)
            db.commit()

            data = detect_stuck_points(student["user_id"], db)
            assert data["is_declining"] is True
        finally:
            db.query(LearningSession).filter_by(student_id=student["user_id"]).delete()
            db.commit()
            db.close()

    def test_character_stuck_detected(self, student):
        """Character with 3+ CharacterErrors across sessions → character_stuck."""
        db = TestingSessionLocal()
        try:
            now = datetime.now(timezone.utc)
            session_ids = []
            for i in range(3):
                s = LearningSession(
                    student_id=student["user_id"],
                    story_slug=f"char-story-{i}",
                    status="completed",
                    current_step=6,
                    accuracy=65.0,
                    started_at=now - timedelta(days=5 - i),
                )
                db.add(s)
                db.flush()
                session_ids.append(s.id)
            for sid in session_ids:
                db.add(CharacterError(
                    session_id=sid,
                    character="難",
                    error_type="mispronounced",
                ))
            db.commit()

            data = detect_stuck_points(student["user_id"], db)
            chars = [c["character"] for c in data["character_stuck"]]
            assert "難" in chars
        finally:
            # clean up
            for sid in session_ids:
                db.query(CharacterError).filter_by(session_id=sid).delete()
            db.query(LearningSession).filter_by(student_id=student["user_id"]).delete()
            db.commit()
            db.close()


# ---------------------------------------------------------------------------
# Unit tests for build_recommendations
# ---------------------------------------------------------------------------

class TestBuildRecommendations:
    """Pure unit tests — no DB."""

    def test_encouragement_when_no_stuck(self):
        data = {
            "story_stuck": [],
            "character_stuck": [],
            "is_declining": False,
            "accuracy_trend": [],
        }
        recs = build_recommendations(data)
        assert len(recs) == 1
        assert recs[0]["type"] == "encouragement"

    def test_declining_generates_recommendation(self):
        data = {
            "story_stuck": [],
            "character_stuck": [],
            "is_declining": True,
            "accuracy_trend": [80.0, 70.0, 60.0],
        }
        recs = build_recommendations(data)
        types = [r["type"] for r in recs]
        assert "declining" in types

    def test_character_stuck_recommendation(self):
        data = {
            "story_stuck": [],
            "character_stuck": [{"character": "難", "error_count": 4, "last_error_date": None}],
            "is_declining": False,
            "accuracy_trend": [],
        }
        recs = build_recommendations(data)
        types = [r["type"] for r in recs]
        assert "character_stuck" in types
        char_rec = next(r for r in recs if r["type"] == "character_stuck")
        assert "難" in char_rec["title"]

    def test_all_fields_present(self):
        data = {
            "story_stuck": [],
            "character_stuck": [],
            "is_declining": False,
            "accuracy_trend": [],
        }
        recs = build_recommendations(data)
        for rec in recs:
            assert "type" in rec
            assert "title" in rec
            assert "description" in rec
            assert "action" in rec


# ---------------------------------------------------------------------------
# API integration tests
# ---------------------------------------------------------------------------

class TestStuckPointsAPI:
    """Integration tests for the stuck-points HTTP endpoints."""

    def test_stuck_points_returns_200(self, client, student):
        res = client.get(
            f"/api/learning/students/{student['user_id']}/stuck-points",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert res.status_code == 200
        body = res.json()
        assert "story_stuck" in body
        assert "character_stuck" in body
        assert "is_declining" in body
        assert "accuracy_trend" in body
        assert isinstance(body["story_stuck"], list)
        assert isinstance(body["character_stuck"], list)

    def test_recommendations_returns_200(self, client, student):
        res = client.get(
            f"/api/learning/students/{student['user_id']}/recommendations",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert res.status_code == 200
        body = res.json()
        assert "recommendations" in body
        assert "total" in body
        assert isinstance(body["recommendations"], list)
        # Always at least 1 recommendation (encouragement if no stuck)
        assert body["total"] >= 1

    def test_recommendation_items_have_required_fields(self, client, student):
        res = client.get(
            f"/api/learning/students/{student['user_id']}/recommendations",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert res.status_code == 200
        for rec in res.json()["recommendations"]:
            assert "type" in rec
            assert "title" in rec
            assert "description" in rec
            assert "action" in rec

    def test_stuck_points_forbidden_for_other_student(self, client, student, other_student):
        """Student cannot see another student's stuck-points."""
        res = client.get(
            f"/api/learning/students/{other_student['user_id']}/stuck-points",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert res.status_code == 403

    def test_recommendations_forbidden_for_other_student(self, client, student, other_student):
        """Student cannot see another student's recommendations."""
        res = client.get(
            f"/api/learning/students/{other_student['user_id']}/recommendations",
            headers={"Authorization": f"Bearer {student['token']}"},
        )
        assert res.status_code == 403

    def test_teacher_can_access_student_stuck_points(self, client, teacher, student, classroom_id):
        """Teacher who owns a classroom with the student can see stuck-points."""
        res = client.get(
            f"/api/learning/students/{student['user_id']}/stuck-points",
            headers={"Authorization": f"Bearer {teacher['token']}"},
        )
        assert res.status_code == 200

    def test_teacher_can_access_student_recommendations(self, client, teacher, student, classroom_id):
        """Teacher can also see recommendations."""
        res = client.get(
            f"/api/learning/students/{student['user_id']}/recommendations",
            headers={"Authorization": f"Bearer {teacher['token']}"},
        )
        assert res.status_code == 200

    def test_classroom_stuck_overview_returns_200(self, client, teacher, classroom_id):
        """Teacher can get classroom-level stuck overview."""
        res = client.get(
            f"/api/teacher/classrooms/{classroom_id}/stuck-overview",
            headers={"Authorization": f"Bearer {teacher['token']}"},
        )
        assert res.status_code == 200
        body = res.json()
        assert "students" in body
        assert "total_stuck" in body
        assert isinstance(body["students"], list)

    def test_classroom_stuck_overview_structure(self, client, teacher, classroom_id):
        """Each entry in stuck overview has required fields."""
        res = client.get(
            f"/api/teacher/classrooms/{classroom_id}/stuck-overview",
            headers={"Authorization": f"Bearer {teacher['token']}"},
        )
        assert res.status_code == 200
        for entry in res.json()["students"]:
            assert "student_id" in entry
            assert "student_name" in entry
            assert "story_stuck_count" in entry
            assert "character_stuck_count" in entry
            assert "is_declining" in entry
            assert "top_stuck_characters" in entry
            assert "top_recommendations" in entry

    def test_unauthenticated_request_rejected(self, client, student):
        """No token → 401."""
        res = client.get(f"/api/learning/students/{student['user_id']}/stuck-points")
        assert res.status_code == 401
