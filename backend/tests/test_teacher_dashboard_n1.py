"""
Regression tests for Issue #525 — Teacher Dashboard N+1 query elimination.

Verifies that key teacher dashboard endpoints do NOT issue N queries
(one per student) when loading data for a classroom with multiple students.

Strategy: use SQLAlchemy event listener to count SQL statements emitted
during each endpoint call. For N students, an N+1 pattern would produce
at least 2*N queries. Our batch approach must stay well below that.
"""

import sys
import os
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession
from app.models.user import User
from app.auth.password import hash_password


# ---------------------------------------------------------------------------
# In-memory SQLite DB setup
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=OFF")  # Disable FK for easier seeding
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

_SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]

_state: dict = {}

NUM_STUDENTS = 10  # enough to detect N+1 but fast enough for unit tests


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    """Create tables, seed data, override FastAPI DB dependency."""
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy import JSON

    # Patch JSONB -> JSON for SQLite compatibility
    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            if isinstance(col.type, JSONB):
                col.type = JSON()

    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    # Roles
    for r in _SEED_ROLES:
        db.add(Role(**r))
    db.commit()

    # School
    school = School(name="N+1 Test School")
    db.add(school)
    db.commit()
    db.refresh(school)

    # Teacher user
    teacher_user = User(
        email="n1test_teacher@example.com",
        username="n1test_teacher",
        password_hash=hash_password("Password1!"),
        name="N1 Teacher",
        is_active=True,
        email_verified=True,
    )
    db.add(teacher_user)
    db.commit()
    db.refresh(teacher_user)

    # Classroom
    classroom = Classroom(
        name="N+1 Test Class",
        school_id=school.id,
        teacher_id=teacher_user.id,
        join_code="N1TEST",
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    classroom_id = classroom.id  # capture before session closes

    # Students + enrollments + sessions
    for i in range(NUM_STUDENTS):
        student = User(
            email=f"n1student{i}@example.com",
            username=f"n1student{i}",
            password_hash=hash_password("Password1!"),
            name=f"Student {i}",
            is_active=True,
            email_verified=True,
        )
        db.add(student)
        db.commit()
        db.refresh(student)

        # Enroll
        db.add(ClassroomStudent(classroom_id=classroom_id, student_id=student.id))

        # 3 sessions per student
        for j in range(3):
            started = datetime.now(timezone.utc) - timedelta(days=j)
            db.add(LearningSession(
                student_id=student.id,
                story_slug=str(j + 1),
                status="completed",
                overall_score=float(70 + i + j),
                started_at=started,
                completed_at=started + timedelta(minutes=15),
            ))

    db.commit()
    db.close()

    _state["teacher_email"] = "n1test_teacher@example.com"
    _state["classroom_id"] = classroom_id

    app.dependency_overrides[get_db] = _override_get_db

    # Reset rate limiter if present
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


def count_queries_during(fn) -> int:
    """Count the number of SQL statements emitted while calling fn()."""
    count = 0

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)

    return count


# ---------------------------------------------------------------------------
# N+1 Regression Tests
# ---------------------------------------------------------------------------


class TestProgressEndpointNoN1:
    """GET /api/teacher/classrooms/{id}/progress must not issue N+1 queries."""

    def test_progress_returns_200(self, client, teacher_token):
        classroom_id = _state["classroom_id"]
        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/progress",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == NUM_STUDENTS

    def test_progress_query_count_is_bounded(self, client, teacher_token):
        """With NUM_STUDENTS students, N+1 would produce ≥ 2*N queries.
        Our batch approach should stay well below that (target: < N queries total).
        """
        classroom_id = _state["classroom_id"]

        def call():
            client.get(
                f"/api/teacher/classrooms/{classroom_id}/progress",
                headers=auth_header(teacher_token),
            )

        n_queries = count_queries_during(call)

        # N+1 worst case = auth(1) + classroom(1) + student_ids(1) + tags(1)
        #                  + N*session_count + N*latest_session = 2N+4 = 24 queries
        # Our batch approach: auth + classroom + enrollments_joinedload + tags
        #                     + session_counts + all_sessions_for_latest
        # = approximately 6 constant queries regardless of N
        # Allow generous headroom (< N) to be future-proof
        assert n_queries < NUM_STUDENTS, (
            f"Progress endpoint issued {n_queries} queries for {NUM_STUDENTS} students. "
            f"Expected < {NUM_STUDENTS} (N+1 would be ~{2 * NUM_STUDENTS + 4})."
        )


class TestAlertsEndpointNoN1:
    """GET /api/teacher/classrooms/{id}/alerts must not issue N+1 queries."""

    def test_alerts_returns_200(self, client, teacher_token):
        classroom_id = _state["classroom_id"]
        resp = client.get(
            f"/api/teacher/classrooms/{classroom_id}/alerts",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 200

    def test_alerts_query_count_is_bounded(self, client, teacher_token):
        """Alerts endpoint was the worst N+1 offender: 2 queries per student."""
        classroom_id = _state["classroom_id"]

        def call():
            client.get(
                f"/api/teacher/classrooms/{classroom_id}/alerts",
                headers=auth_header(teacher_token),
            )

        n_queries = count_queries_during(call)

        # N+1 worst case: 2N + overhead ≈ 24 queries for 10 students
        # Batch approach: ~5-6 constant queries
        assert n_queries < NUM_STUDENTS, (
            f"Alerts endpoint issued {n_queries} queries for {NUM_STUDENTS} students. "
            f"Expected < {NUM_STUDENTS} (N+1 would be ~{2 * NUM_STUDENTS + 3})."
        )


class TestNotificationsEndpointNoN1:
    """GET /api/teacher/notifications must not issue N+1 queries."""

    def test_notifications_returns_200(self, client, teacher_token):
        resp = client.get(
            "/api/teacher/notifications",
            headers=auth_header(teacher_token),
        )
        assert resp.status_code == 200

    def test_notifications_query_count_is_bounded(self, client, teacher_token):
        """Notifications endpoint had nested N+1: classrooms × students × 2 queries."""

        def call():
            client.get(
                "/api/teacher/notifications",
                headers=auth_header(teacher_token),
            )

        n_queries = count_queries_during(call)

        # Worst case was: classrooms query + N_classrooms*(enrollments + N_students*2 queries)
        # For 1 classroom with 10 students = 21+ queries
        # Batch approach = ~7 constant queries
        assert n_queries < NUM_STUDENTS * 2, (
            f"Notifications endpoint issued {n_queries} queries for {NUM_STUDENTS} students. "
            f"Expected < {NUM_STUDENTS * 2}."
        )
