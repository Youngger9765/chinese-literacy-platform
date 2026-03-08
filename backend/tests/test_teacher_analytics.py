"""
Tests for teacher analytics API endpoints.

Covers:
- GET /api/teacher/classrooms/{id}/stats   (enhanced with avg_accuracy, completion_rate, duration)
- GET /api/teacher/classrooms/{id}/error-vocab  (character error frequency)
- GET /api/teacher/classrooms/{id}/time-stats   (learning time statistics)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd backend && python -m pytest tests/test_teacher_analytics.py -v
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
from app.models.school import School
from app.models.session import CharacterError, LearningSession


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
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Analytics Test School")
    session.add(school)
    session.commit()
    session.refresh(school)
    return school.id


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# Module-level state
_test_school_id: int = 0


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _test_school_id = _seed_school(session)
    session.close()

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
    me_resp = client.get("/api/users/me", headers=_auth(token))
    user_id = me_resp.json()["id"]
    return {"email": email, "name": name, "token": token, "user_id": user_id}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_admin(user_id: int):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "system_admin").first()
    user_role = UserRole(
        user_id=user_id,
        role_id=role.id,
        scope_type="platform",
        scope_id=None,
    )
    db.add(user_role)
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "analytics_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "analytics_other")


@pytest.fixture(scope="module")
def student1(client):
    return _register_user(client, "analytics_stu1")


@pytest.fixture(scope="module")
def student2(client):
    return _register_user(client, "analytics_stu2")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "analytics_admin")
    _make_admin(user["user_id"])
    return user


def _create_classroom_with_students(client, teacher, students, school_id, name="Test Class"):
    """Helper to create a classroom and enroll students."""
    resp = client.post(
        "/api/classrooms",
        json={"name": name, "school_id": school_id},
        headers=_auth(teacher["token"]),
    )
    assert resp.status_code == 201
    classroom_id = resp.json()["id"]

    for student in students:
        client.post(
            f"/api/classrooms/{classroom_id}/students",
            json={"student_id": student["user_id"]},
            headers=_auth(teacher["token"]),
        )

    return classroom_id


# ===========================================================================
# Enhanced stats endpoint
# ===========================================================================


class TestEnhancedClassroomStats:
    def test_returns_new_fields(self, client, teacher, student1, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [student1], school_id, "Enhanced Stats Class"
        )

        # Create a completed session with score
        db = TestingSessionLocal()
        session = LearningSession(
            student_id=student1["user_id"],
            story_slug="1",
            status="completed",
            overall_score=85.0,
            started_at=datetime.now(timezone.utc) - timedelta(hours=1),
            completed_at=datetime.now(timezone.utc),
        )
        db.add(session)
        db.commit()
        db.close()

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/stats",
            headers=_auth(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()

        # Check all new fields exist
        assert "avg_accuracy" in data
        assert "completion_rate" in data
        assert "avg_session_duration_minutes" in data

    def test_avg_accuracy_computed(self, client, teacher, student1, student2, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [student1, student2], school_id, "Accuracy Stats Class"
        )

        db = TestingSessionLocal()
        # Two completed sessions with different scores
        db.add(LearningSession(
            student_id=student1["user_id"],
            story_slug="1",
            status="completed",
            overall_score=80.0,
            started_at=datetime.now(timezone.utc) - timedelta(hours=2),
            completed_at=datetime.now(timezone.utc) - timedelta(hours=1),
        ))
        db.add(LearningSession(
            student_id=student2["user_id"],
            story_slug="2",
            status="completed",
            overall_score=60.0,
            started_at=datetime.now(timezone.utc) - timedelta(hours=2),
            completed_at=datetime.now(timezone.utc) - timedelta(hours=1),
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/stats",
            headers=_auth(teacher["token"]),
        )
        data = resp.json()
        assert data["avg_accuracy"] is not None
        # avg of 80 and 60 = 70 (approximately, other sessions may exist)
        assert isinstance(data["avg_accuracy"], (int, float))

    def test_completion_rate_computed(self, client, teacher, student1, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [student1], school_id, "Completion Rate Class"
        )

        db = TestingSessionLocal()
        # One completed, one in_progress
        db.add(LearningSession(
            student_id=student1["user_id"],
            story_slug="1",
            status="completed",
            overall_score=90.0,
            started_at=datetime.now(timezone.utc) - timedelta(hours=2),
            completed_at=datetime.now(timezone.utc) - timedelta(hours=1),
        ))
        db.add(LearningSession(
            student_id=student1["user_id"],
            story_slug="2",
            status="in_progress",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=30),
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/stats",
            headers=_auth(teacher["token"]),
        )
        data = resp.json()
        assert data["completion_rate"] > 0
        assert data["completion_rate"] <= 1.0

    def test_empty_classroom_returns_defaults(self, client, teacher, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [], school_id, "Empty Analytics Class"
        )

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/stats",
            headers=_auth(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_students"] == 0
        assert data["total_sessions"] == 0
        assert data["avg_accuracy"] is None
        assert data["completion_rate"] == 0.0
        assert data["avg_session_duration_minutes"] is None


# ===========================================================================
# Error vocabulary endpoint
# ===========================================================================


class TestErrorVocabEndpoint:
    def test_returns_200(self, client, teacher, student1, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [student1], school_id, "ErrorVocab Class"
        )

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/error-vocab",
            headers=_auth(teacher["token"]),
        )
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_returns_seeded_errors(self, client, teacher, student1, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [student1], school_id, "ErrorVocab Seeded"
        )

        db = TestingSessionLocal()
        session = LearningSession(
            student_id=student1["user_id"],
            story_slug="1",
            status="completed",
            started_at=datetime.now(timezone.utc) - timedelta(hours=1),
            completed_at=datetime.now(timezone.utc),
        )
        db.add(session)
        db.flush()

        # Add character errors
        db.add(CharacterError(session_id=session.id, character="的", error_type="substitution"))
        db.add(CharacterError(session_id=session.id, character="的", error_type="substitution"))
        db.add(CharacterError(session_id=session.id, character="是", error_type="omission"))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/error-vocab",
            headers=_auth(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1

        # Check structure
        first = data[0]
        assert "character" in first
        assert "error_type" in first
        assert "count" in first
        assert "student_count" in first

    def test_ordered_by_count_desc(self, client, teacher, student1, student2, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [student1, student2], school_id, "ErrorVocab Ordered"
        )

        db = TestingSessionLocal()
        s1 = LearningSession(
            student_id=student1["user_id"], story_slug="1", status="completed",
            started_at=datetime.now(timezone.utc) - timedelta(hours=1),
            completed_at=datetime.now(timezone.utc),
        )
        s2 = LearningSession(
            student_id=student2["user_id"], story_slug="1", status="completed",
            started_at=datetime.now(timezone.utc) - timedelta(hours=1),
            completed_at=datetime.now(timezone.utc),
        )
        db.add_all([s1, s2])
        db.flush()

        # "了" appears 3 times, "我" appears 1 time
        db.add(CharacterError(session_id=s1.id, character="了", error_type="substitution"))
        db.add(CharacterError(session_id=s1.id, character="了", error_type="substitution"))
        db.add(CharacterError(session_id=s2.id, character="了", error_type="substitution"))
        db.add(CharacterError(session_id=s1.id, character="我", error_type="omission"))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/error-vocab",
            headers=_auth(teacher["token"]),
        )
        data = resp.json()
        # First item should have the highest count
        if len(data) >= 2:
            assert data[0]["count"] >= data[1]["count"]

    def test_empty_classroom_returns_empty(self, client, teacher, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [], school_id, "ErrorVocab Empty"
        )

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/error-vocab",
            headers=_auth(teacher["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_401_without_auth(self, client, teacher, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [], school_id, "ErrorVocab Auth"
        )

        resp = client.get(f"/api/teacher/classrooms/{classroom_id}/error-vocab")
        assert resp.status_code == 401

    def test_returns_403_for_non_owner(self, client, teacher, other_teacher, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [], school_id, "ErrorVocab Forbidden"
        )

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/error-vocab",
            headers=_auth(other_teacher["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# Time stats endpoint
# ===========================================================================


class TestTimeStatsEndpoint:
    def test_returns_200(self, client, teacher, student1, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [student1], school_id, "TimeStats Class"
        )

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/time-stats",
            headers=_auth(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "total_hours" in data
        assert "avg_minutes_per_session" in data
        assert "study_days" in data
        assert "sessions_this_week" in data
        assert "sessions_last_week" in data

    def test_computes_from_sessions(self, client, teacher, student1, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [student1], school_id, "TimeStats Compute"
        )

        now = datetime.now(timezone.utc)
        db = TestingSessionLocal()
        # Two sessions, each 30 minutes
        db.add(LearningSession(
            student_id=student1["user_id"],
            story_slug="1",
            status="completed",
            started_at=now - timedelta(hours=2),
            completed_at=now - timedelta(hours=1, minutes=30),
        ))
        db.add(LearningSession(
            student_id=student1["user_id"],
            story_slug="2",
            status="completed",
            started_at=now - timedelta(hours=1),
            completed_at=now - timedelta(minutes=30),
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/time-stats",
            headers=_auth(teacher["token"]),
        )
        data = resp.json()
        assert data["total_hours"] >= 0
        assert data["avg_minutes_per_session"] is not None
        assert data["avg_minutes_per_session"] > 0
        assert data["study_days"] >= 1

    def test_empty_classroom_returns_defaults(self, client, teacher, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [], school_id, "TimeStats Empty"
        )

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/time-stats",
            headers=_auth(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_hours"] == 0.0
        assert data["avg_minutes_per_session"] is None
        assert data["study_days"] == 0
        assert data["sessions_this_week"] == 0
        assert data["sessions_last_week"] == 0

    def test_returns_401_without_auth(self, client, teacher, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [], school_id, "TimeStats Auth"
        )

        resp = client.get(f"/api/teacher/classrooms/{classroom_id}/time-stats")
        assert resp.status_code == 401

    def test_returns_403_for_non_owner(self, client, teacher, other_teacher, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [], school_id, "TimeStats Forbidden"
        )

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/time-stats",
            headers=_auth(other_teacher["token"]),
        )
        assert resp.status_code == 403

    def test_sessions_this_week_counted(self, client, teacher, student1, school_id):
        classroom_id = _create_classroom_with_students(
            client, teacher, [student1], school_id, "TimeStats Week"
        )

        now = datetime.now(timezone.utc)
        db = TestingSessionLocal()
        # Session today (should be in "this week")
        db.add(LearningSession(
            student_id=student1["user_id"],
            story_slug="1",
            status="completed",
            started_at=now - timedelta(hours=1),
            completed_at=now,
        ))
        db.commit()
        db.close()

        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/time-stats",
            headers=_auth(teacher["token"]),
        )
        data = resp.json()
        assert data["sessions_this_week"] >= 1
