"""
Regression tests for Issue #1192 — Teacher dashboard misses sessions completed via
assignment submission.

The bug: get_classroom_stats (and learning_stats_service helpers) only check
`LearningSession.status == 'completed'`, but assignment-submitted sessions have
`submission.status == 'submitted'` while `session.status` may still be 'in_progress'.

Two sessions are seeded:
  - Session A: session.status = 'completed' (direct completion)
  - Session B: session.status = 'in_progress', BUT has AssignmentSubmission with
               status = 'submitted' (assignment path)

The fixed dashboard stats endpoint must count BOTH as completed.
The fixed learning_stats_service must also count BOTH story slugs.
"""

import sys
import os
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.user import User
from app.auth.password import hash_password

# ---------------------------------------------------------------------------
# SQLite in-memory DB
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_state: dict = {}

_SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    """Create tables and seed the two-session scenario."""
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy import JSON

    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()

    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    for r in _SEED_ROLES:
        db.add(Role(**r))
    db.commit()

    school = School(name="Dashboard Test School")
    db.add(school)
    db.commit()
    db.refresh(school)

    # Teacher
    teacher = User(
        email="dashboard_test_teacher@example.com",
        username="dashboard_test_teacher",
        password_hash=hash_password("Password1!"),
        name="Dashboard Teacher",
        is_active=True,
        email_verified=True,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    # Student
    student = User(
        email="dashboard_test_student@example.com",
        username="dashboard_test_student",
        password_hash=hash_password("Password1!"),
        name="Dashboard Student",
        is_active=True,
        email_verified=True,
    )
    db.add(student)
    db.commit()
    db.refresh(student)

    # Classroom
    classroom = Classroom(
        name="Dashboard Test Class",
        school_id=school.id,
        teacher_id=teacher.id,
        join_code="DASHTEST",
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)

    db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student.id))
    db.commit()

    now = datetime.now(timezone.utc)

    # Session A: directly completed (session.status = 'completed')
    session_a = LearningSession(
        student_id=student.id,
        story_slug="1",
        status="completed",
        overall_score=80.0,
        started_at=now - timedelta(hours=2),
        completed_at=now - timedelta(hours=1),
    )
    db.add(session_a)
    db.commit()
    db.refresh(session_a)

    # Session B: submitted via assignment (session.status stays 'in_progress',
    # submission.status = 'submitted')
    session_b = LearningSession(
        student_id=student.id,
        story_slug="2",
        status="in_progress",
        overall_score=70.0,
        started_at=now - timedelta(hours=4),
        completed_at=None,
    )
    db.add(session_b)
    db.commit()
    db.refresh(session_b)

    # Assignment + submission pointing at session_b
    assignment = Assignment(
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        story_id="2",
        title="Story 2 Assignment",
        assignment_type="reading",
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    submission = AssignmentSubmission(
        assignment_id=assignment.id,
        student_id=student.id,
        session_id=session_b.id,
        status="submitted",
        submitted_at=now - timedelta(hours=3),
    )
    db.add(submission)
    db.commit()

    _state["teacher_email"] = teacher.email
    _state["student_id"] = student.id
    _state["classroom_id"] = classroom.id

    app.dependency_overrides[get_db] = _override_get_db

    try:
        from app.routes.auth import rate_limiter
        rate_limiter.reset()
    except Exception:
        pass

    yield

    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def teacher_token(client):
    resp = client.post("/api/auth/login", json={
        "email": _state["teacher_email"],
        "password": "Password1!",
    })
    assert resp.status_code == 200, f"Login failed: {resp.json()}"
    return resp.json()["access_token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestDashboardStatsIncludesSubmittedAssignments:
    """GET /api/teacher/classrooms/{id}/stats must count assignment-submitted sessions."""

    def test_stats_returns_200(self, client, teacher_token):
        classroom_id = _state["classroom_id"]
        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/stats",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 200

    def test_completion_rate_counts_both_sessions(self, client, teacher_token):
        """completion_rate should be 1.0 (both sessions are 'done').

        Before fix: only session_a counted as completed → rate = 0.5.
        After fix: session_a (status=completed) + session_b (submission.status=submitted)
                   both count → rate = 1.0.
        """
        classroom_id = _state["classroom_id"]
        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/stats",
            headers=auth_header(teacher_token),
        )
        data = resp.json()
        assert data["completion_rate"] == 1.0, (
            f"Expected completion_rate=1.0 but got {data['completion_rate']}. "
            "Session submitted via assignment is not being counted."
        )

    def test_avg_accuracy_includes_submitted_session(self, client, teacher_token):
        """avg_accuracy must average both sessions (80.0 + 70.0) / 2 = 75.0.

        Before fix: only session_a (80.0) counted → avg = 80.0.
        """
        classroom_id = _state["classroom_id"]
        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/stats",
            headers=auth_header(teacher_token),
        )
        data = resp.json()
        assert data["avg_accuracy"] is not None
        assert abs(data["avg_accuracy"] - 75.0) < 0.5, (
            f"Expected avg_accuracy≈75.0 but got {data['avg_accuracy']}. "
            "Assignment-submitted session score not included in average."
        )


class TestLearningStatsServiceIncludesSubmittedAssignments:
    """learning_stats_service helpers must also count assignment-submitted sessions."""

    def test_get_completed_story_count_includes_submitted_session(self):
        """get_completed_story_count must return 2 (both story '1' and story '2').

        Before fix: returns 1 (only story '1' with status=completed).
        """
        db = TestingSessionLocal()
        try:
            from app.services.learning_stats_service import get_completed_story_count
            count = get_completed_story_count(db, _state["student_id"])
            assert count == 2, (
                f"Expected 2 completed stories but got {count}. "
                "Story '2' submitted via assignment is not being counted."
            )
        finally:
            db.close()

    def test_get_completed_story_slugs_includes_submitted_session(self):
        """get_completed_story_slugs must return both '1' and '2'."""
        db = TestingSessionLocal()
        try:
            from app.services.learning_stats_service import get_completed_story_slugs
            slugs = get_completed_story_slugs(db, _state["student_id"])
            assert "1" in slugs, f"Story '1' missing from {slugs}"
            assert "2" in slugs, (
                f"Story '2' (assignment-submitted) missing from {slugs}"
            )
        finally:
            db.close()
