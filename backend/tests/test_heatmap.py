"""
Tests for GET /api/teacher/classrooms/{id}/heatmap endpoint.

Covers:
- Returns correct students/stories/scores structure
- Returns best score per (student, story) pair
- Empty classroom returns empty lists
- Unauthenticated request returns 401
- Teacher from a different classroom gets 403

Run with:
    cd /Users/young/project/chinese-literacy-platform/.claude/worktrees/agent-ab336196/backend
    python -m pytest tests/test_heatmap.py -v
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
from app.models.user import Role, UserRole
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession


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
    school = School(name="Heatmap Test School")
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


# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

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


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


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
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    return {
        "token": token,
        "user_id": me_resp.json()["id"],
        "email": email,
        "name": name,
    }


def _seed_classroom(teacher_id: int, school_id: int) -> int:
    db = TestingSessionLocal()
    classroom = Classroom(
        name="Test Heatmap Class",
        teacher_id=teacher_id,
        school_id=school_id,
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    cid = classroom.id
    db.close()
    return cid


def _enroll_student(classroom_id: int, student_id: int):
    db = TestingSessionLocal()
    enrollment = ClassroomStudent(classroom_id=classroom_id, student_id=student_id)
    db.add(enrollment)
    db.commit()
    db.close()


def _seed_session(student_id: int, classroom_id: int, story_slug: str,
                  overall_score: float | None, status: str = "completed"):
    db = TestingSessionLocal()
    sess = LearningSession(
        student_id=student_id,
        classroom_id=classroom_id,
        story_slug=story_slug,
        overall_score=overall_score,
        status=status,
    )
    db.add(sess)
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "hm_teacher")


@pytest.fixture(scope="module")
def other_teacher(client):
    return _register_user(client, "hm_other_teacher")


@pytest.fixture(scope="module")
def student_a(client):
    return _register_user(client, "hm_student_a")


@pytest.fixture(scope="module")
def student_b(client):
    return _register_user(client, "hm_student_b")


@pytest.fixture(scope="module")
def classroom(teacher, school_id):
    return _seed_classroom(teacher["user_id"], school_id)


@pytest.fixture(scope="module")
def empty_classroom(teacher, school_id):
    db = TestingSessionLocal()
    c = Classroom(
        name="Empty Heatmap Class",
        teacher_id=teacher["user_id"],
        school_id=school_id,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    cid = c.id
    db.close()
    return cid


@pytest.fixture(scope="module")
def seeded_classroom(classroom, student_a, student_b):
    """Classroom with students enrolled and sessions seeded."""
    _enroll_student(classroom, student_a["user_id"])
    _enroll_student(classroom, student_b["user_id"])

    # student_a: story "1" — two sessions; best is score=90
    _seed_session(student_a["user_id"], classroom, "1", 70.0, "completed")
    _seed_session(student_a["user_id"], classroom, "1", 90.0, "completed")

    # student_a: story "2" — one in_progress session with no score
    _seed_session(student_a["user_id"], classroom, "2", None, "in_progress")

    # student_b: story "1" — score=55 (red)
    _seed_session(student_b["user_id"], classroom, "1", 55.0, "completed")

    # student_b: story "2" — score=65 (yellow)
    _seed_session(student_b["user_id"], classroom, "2", 65.0, "completed")

    return classroom


class TestHeatmapEndpoint:
    def test_returns_correct_structure(self, client, teacher, seeded_classroom):
        """Response must include students, stories, scores keys."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "students" in data
        assert "stories" in data
        assert "scores" in data

    def test_student_list(self, client, teacher, seeded_classroom, student_a, student_b):
        """Both enrolled students should appear in the list."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        student_ids = [s["id"] for s in data["students"]]
        assert student_a["user_id"] in student_ids
        assert student_b["user_id"] in student_ids

    def test_story_list(self, client, teacher, seeded_classroom):
        """Stories with sessions should appear (slugs '1' and '2')."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        story_ids = [s["id"] for s in data["stories"]]
        assert "1" in story_ids
        assert "2" in story_ids

    def test_best_score_selected(self, client, teacher, seeded_classroom, student_a):
        """student_a has two sessions for story '1' (70, 90) — best is 90."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        # Find score entry for student_a + story "1"
        entry = next(
            (e for e in data["scores"]
             if e["student_id"] == student_a["user_id"] and e["story_id"] == "1"),
            None,
        )
        assert entry is not None
        assert entry["score"] == 90.0

    def test_in_progress_session_included(self, client, teacher, seeded_classroom, student_a):
        """student_a story '2' has only an in_progress session with no score; it must appear."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        entry = next(
            (e for e in data["scores"]
             if e["student_id"] == student_a["user_id"] and e["story_id"] == "2"),
            None,
        )
        assert entry is not None
        assert entry["status"] == "in_progress"
        assert entry["score"] == 0.0

    def test_student_b_scores(self, client, teacher, seeded_classroom, student_b):
        """student_b scores: story '1' = 55, story '2' = 65."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()

        def get_score(story_id):
            entry = next(
                (e for e in data["scores"]
                 if e["student_id"] == student_b["user_id"] and e["story_id"] == story_id),
                None,
            )
            return entry

        e1 = get_score("1")
        assert e1 is not None
        assert e1["score"] == 55.0

        e2 = get_score("2")
        assert e2 is not None
        assert e2["score"] == 65.0

    def test_empty_classroom(self, client, teacher, empty_classroom):
        """Empty classroom returns empty lists."""
        resp = client.get(
            f"/api/teacher/classrooms/{empty_classroom}/heatmap",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["students"] == []
        assert data["stories"] == []
        assert data["scores"] == []

    def test_unauthenticated_returns_401(self, client, seeded_classroom):
        """Request without token should return 401 or 403."""
        resp = client.get(f"/api/teacher/classrooms/{seeded_classroom}/heatmap")
        assert resp.status_code in (401, 403)

    def test_other_teacher_forbidden(self, client, other_teacher, seeded_classroom):
        """Teacher who does not own this classroom should get 403."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_classroom}/heatmap",
            headers=auth_header(other_teacher["token"]),
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Session-limit guard tests (Issue #1225)
# ---------------------------------------------------------------------------

class TestHeatmapSessionLimit:
    """Verify that the heatmap endpoint raises 400 when session count exceeds
    _HEATMAP_SESSION_LIMIT (5,000) so teachers are not silently shown
    incomplete data."""

    @pytest.fixture(scope="class")
    def limit_teacher(self, client):
        return _register_user(client, "limit_teacher")

    @pytest.fixture(scope="class")
    def limit_student(self, client):
        return _register_user(client, "limit_student")

    @pytest.fixture(scope="class")
    def small_classroom(self, limit_teacher, school_id):
        """Classroom with a small number of sessions — must return 200."""
        db = TestingSessionLocal()
        c = Classroom(
            name="Small Limit Class",
            teacher_id=limit_teacher["user_id"],
            school_id=school_id,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        cid = c.id
        db.close()
        return cid

    @pytest.fixture(scope="class")
    def over_limit_classroom(self, limit_teacher, school_id):
        """Classroom that will be seeded with 5,001 sessions."""
        db = TestingSessionLocal()
        c = Classroom(
            name="Over Limit Class",
            teacher_id=limit_teacher["user_id"],
            school_id=school_id,
        )
        db.add(c)
        db.commit()
        db.refresh(c)
        cid = c.id
        db.close()
        return cid

    @pytest.fixture(scope="class")
    def seeded_over_limit(self, over_limit_classroom, limit_student, school_id):
        """Enroll the student and seed 5,001 sessions with distinct story slugs."""
        db = TestingSessionLocal()
        enrollment = ClassroomStudent(
            classroom_id=over_limit_classroom,
            student_id=limit_student["user_id"],
        )
        db.add(enrollment)
        db.commit()

        # Each session gets a unique story_slug to avoid UNIQUE constraint issues.
        # We need 5,001 sessions to exceed _HEATMAP_SESSION_LIMIT.
        sessions = [
            LearningSession(
                student_id=limit_student["user_id"],
                classroom_id=over_limit_classroom,
                story_slug=f"limit-story-{i}",
                overall_score=80.0,
                status="completed",
            )
            for i in range(5001)
        ]
        db.bulk_save_objects(sessions)
        db.commit()
        db.close()
        return over_limit_classroom

    @pytest.fixture(scope="class")
    def seeded_small(self, small_classroom, limit_student, school_id):
        """Enroll the student and seed a few sessions under the limit."""
        db = TestingSessionLocal()
        enrollment = ClassroomStudent(
            classroom_id=small_classroom,
            student_id=limit_student["user_id"],
        )
        db.add(enrollment)
        db.commit()

        sessions = [
            LearningSession(
                student_id=limit_student["user_id"],
                classroom_id=small_classroom,
                story_slug=f"small-story-{i}",
                overall_score=80.0,
                status="completed",
            )
            for i in range(10)
        ]
        db.bulk_save_objects(sessions)
        db.commit()
        db.close()
        return small_classroom

    def test_under_limit_returns_200(self, client, limit_teacher, seeded_small):
        """Small classroom (10 sessions) must succeed with 200."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_small}/heatmap",
            headers=auth_header(limit_teacher["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "students" in data
        assert len(data["scores"]) == 10

    def test_over_limit_returns_400(self, client, limit_teacher, seeded_over_limit):
        """Classroom with 5,001 sessions must return 400 (not silently truncate)."""
        resp = client.get(
            f"/api/teacher/classrooms/{seeded_over_limit}/heatmap",
            headers=auth_header(limit_teacher["token"]),
        )
        assert resp.status_code == 400
        detail = resp.json().get("detail", "")
        # Should mention the limit so the teacher knows what to do
        assert "5,000" in detail or "5000" in detail
