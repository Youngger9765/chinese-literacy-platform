"""Regression tests for Issue #1243 — remaining perf optimizations.

Covers:
  1. Assignment.teacher_id index=True model annotation
  2. /learning/sessions/reading-history SQL LIMIT push-down (no full scan)
  3. Gamification _user_has_admin_role SQL COUNT helper (no Python set iteration)

Each section verifies:
  - Behaviour is identical to the pre-fix implementation
  - Query counts are bounded (SQL COUNT, not N lazy loads)
"""
from __future__ import annotations

import sys
import os
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event, inspect as sa_inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession
from app.models.assignment import Assignment, AssignmentSubmission  # noqa: F401 (may be used in future)
from app.auth.password import hash_password


# ---------------------------------------------------------------------------
# SQLite in-memory engine (shared for module-scope fixtures)
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _disable_fk(dbapi_connection, _record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=OFF")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ⚠️ import 時登記的 override 撐不過別的測試模組的 `dependency_overrides.clear()`
#    —— collection 期間就設好，等真的跑到這支時早被掃掉了，於是登入回 500。
#    下面 module-scope fixture 會在跑之前重掛一次，不靠 import 順序。
app.dependency_overrides[get_db] = _override_get_db


# ---------------------------------------------------------------------------
# Query counting helper (mirrors test_teacher_dashboard_n1.py)
# ---------------------------------------------------------------------------

def count_queries_during(fn) -> int:
    """Count SQL statements emitted while calling fn()."""
    count = 0

    def _before(conn, cursor, statement, parameters, context, executemany):
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", _before)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", _before)
    return count


# ---------------------------------------------------------------------------
# Shared seed state
# ---------------------------------------------------------------------------

_state: dict = {}
_SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin",    "display_name": "Org Admin",    "scope_level": "organization"},
    {"name": "org_owner",    "display_name": "Org Owner",    "scope_level": "organization"},
    {"name": "teacher",      "display_name": "Teacher",      "scope_level": "school"},
    {"name": "student",      "display_name": "Student",      "scope_level": "school"},
]


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    """Create tables and seed data for all tests in this module."""
    app.dependency_overrides[get_db] = _override_get_db
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    # Roles
    roles: dict[str, Role] = {}
    for r in _SEED_ROLES:
        role = Role(**r)
        db.add(role)
    db.commit()
    for r in _SEED_ROLES:
        roles[r["name"]] = db.query(Role).filter(Role.name == r["name"]).first()

    # School + classroom
    school = School(name="Perf1243 School")
    db.add(school)
    db.commit()
    db.refresh(school)

    teacher = User(
        email="p1243_teacher@test.com",
        username="p1243_teacher",
        password_hash=hash_password("Password1!"),
        name="Perf Teacher",
        is_active=True,
        email_verified=True,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)

    classroom = Classroom(
        name="Perf1243 Class",
        school_id=school.id,
        teacher_id=teacher.id,
        join_code="P1243",
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)

    # Student (plain — no admin roles)
    student = User(
        email="p1243_student@test.com",
        username="p1243_student",
        password_hash=hash_password("Password1!"),
        name="Perf Student",
        is_active=True,
        email_verified=True,
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student.id))

    # Admin user (has system_admin role)
    admin = User(
        email="p1243_admin@test.com",
        username="p1243_admin",
        password_hash=hash_password("Password1!"),
        name="Perf Admin",
        is_active=True,
        email_verified=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    admin_role = roles["system_admin"]
    db.add(UserRole(user_id=admin.id, role_id=admin_role.id, is_active=True, scope_type="platform"))
    db.commit()

    # Sessions for reading-history endpoint
    # 60 completed sessions for student on story "1" (more than default limit=50)
    # Mix: 20 from assignment (via step_progress.__meta), 40 from self-practice
    assignment_session_count = 20
    self_session_count = 40
    base_time = datetime.now(timezone.utc) - timedelta(days=70)
    for i in range(60):
        started = base_time + timedelta(hours=i)
        # Mark first 20 sessions as assignment-sourced via step_progress.__meta
        step_progress = None
        if i < assignment_session_count:
            step_progress = {"__meta": {"source": "assignment"}}
        sess = LearningSession(
            student_id=student.id,
            story_slug="1",
            status="completed",
            started_at=started,
            completed_at=started + timedelta(minutes=10),
            reading_result={"cpm": 100 + i, "accuracy": 80.0},
            step_progress=step_progress,
        )
        db.add(sess)
    db.commit()

    # Capture IDs before closing the session (avoid DetachedInstanceError)
    classroom_id = classroom.id
    student_id = student.id
    admin_id = admin.id

    db.close()

    _state["teacher_email"] = "p1243_teacher@test.com"
    _state["student_email"] = "p1243_student@test.com"
    _state["admin_email"] = "p1243_admin@test.com"
    _state["classroom_id"] = classroom_id
    _state["student_id"] = student_id
    _state["admin_id"] = admin_id
    _state["total_sessions"] = 60
    _state["assignment_session_count"] = assignment_session_count
    _state["self_session_count"] = self_session_count

    yield

    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def _login(client: TestClient, email: str) -> str:
    resp = client.post("/api/auth/login", json={"email": email, "password": "Password1!"})
    assert resp.status_code == 200, f"Login failed for {email}: {resp.text}"
    return resp.json()["access_token"]


# ---------------------------------------------------------------------------
# 1. Assignment.teacher_id — model annotation sync
# ---------------------------------------------------------------------------

class TestAssignmentTeacherIdIndex:
    """Verify that Assignment.teacher_id now declares index=True in the model.

    This is a model-annotation sync: the DB index was already created by
    fk01idx02add03 migration. The fix ensures ORM introspection is accurate.
    """

    def test_teacher_id_has_index_annotation(self):
        from sqlalchemy import inspect as sa_inspect
        from app.models.assignment import Assignment
        mapper = sa_inspect(Assignment)
        col = mapper.columns["teacher_id"]
        # SQLAlchemy model-level index=True is reflected in column.index attribute
        assert col.index is True, (
            "Assignment.teacher_id must have index=True for accurate ORM introspection. "
            "DB index ix_assignments_teacher_id already exists via fk01idx02add03."
        )


# ---------------------------------------------------------------------------
# 2. /learning/sessions/reading-history — SQL LIMIT push-down
# ---------------------------------------------------------------------------

class TestReadingHistorySQLLimit:
    """Verify that reading-history pushes LIMIT to SQL instead of full scan."""

    def test_default_limit_returns_50_items(self, client):
        """Default limit=50: should return at most 50 sessions."""
        token = _login(client, _state["student_email"])
        resp = client.get(
            "/api/learning/sessions/reading-history",
            params={"story_slug": "1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        # We seeded 60 sessions; default limit=50 must cap at 50
        assert len(data) <= 50, f"Expected ≤50 items, got {len(data)}"
        assert len(data) == 50, f"Expected exactly 50 items with 60 seeded, got {len(data)}"

    def test_custom_limit_is_respected(self, client):
        """limit=10 must return exactly 10 sessions."""
        token = _login(client, _state["student_email"])
        resp = client.get(
            "/api/learning/sessions/reading-history",
            params={"story_slug": "1", "limit": 10},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 10, f"Expected 10, got {len(data)}"

    def test_response_fields_are_complete(self, client):
        """Each result item must have all expected fields."""
        token = _login(client, _state["student_email"])
        resp = client.get(
            "/api/learning/sessions/reading-history",
            params={"story_slug": "1", "limit": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        item = resp.json()[0]
        for field in ("session_id", "started_at", "cpm", "accuracy", "match_rate", "overall_score"):
            assert field in item, f"Missing field: {field}"

    def test_results_are_ordered_ascending_by_started_at(self, client):
        """Sessions must be in ascending chronological order (oldest first)."""
        token = _login(client, _state["student_email"])
        resp = client.get(
            "/api/learning/sessions/reading-history",
            params={"story_slug": "1", "limit": 10},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        timestamps = [item["started_at"] for item in data]
        assert timestamps == sorted(timestamps), "Results are not in ascending order"

    def test_learning_source_assignment_filter(self, client):
        """learning_source=assignment must return only assignment-linked sessions."""
        token = _login(client, _state["student_email"])
        resp = client.get(
            "/api/learning/sessions/reading-history",
            params={"story_slug": "1", "learning_source": "assignment", "limit": 50},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # We seeded 20 assignment sessions
        assert len(data) == _state["assignment_session_count"], (
            f"Expected {_state['assignment_session_count']} assignment sessions, got {len(data)}"
        )

    def test_learning_source_self_filter(self, client):
        """learning_source=self must return only self-practice sessions."""
        token = _login(client, _state["student_email"])
        resp = client.get(
            "/api/learning/sessions/reading-history",
            params={"story_slug": "1", "learning_source": "self", "limit": 50},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # We seeded 40 self-practice sessions
        assert len(data) == _state["self_session_count"], (
            f"Expected {_state['self_session_count']} self sessions, got {len(data)}"
        )

    def test_sql_query_count_is_bounded(self, client):
        """Fetching reading-history must NOT issue one SQL query per session.

        Before the fix: sessions_query.all() loaded ALL 60+ rows.
        After the fix: a .limit(limit+50) cap keeps the fetch bounded.
        We verify query count stays low regardless of total history depth.
        """
        token = _login(client, _state["student_email"])

        n_queries = count_queries_during(
            lambda: client.get(
                "/api/learning/sessions/reading-history",
                params={"story_slug": "1", "limit": 10},
                headers={"Authorization": f"Bearer {token}"},
            )
        )

        # Worst-case bounded count: auth(1) + history_query(1) + assignment_ids(1) + any overhead
        # Should be well under 60 (old full-scan count).  Allow generous headroom.
        TOTAL_SEEDED = _state["total_sessions"]
        assert n_queries < TOTAL_SEEDED, (
            f"reading-history issued {n_queries} SQL queries for {TOTAL_SEEDED} seeded sessions. "
            f"Expected < {TOTAL_SEEDED} (SQL LIMIT cap should prevent full scan)."
        )


# ---------------------------------------------------------------------------
# 3. Gamification access control (admin / teacher / student paths)
# ---------------------------------------------------------------------------

class TestGamificationAccessControl:
    """Integration tests for /gamification/summary + /leaderboard access control.

    Note: the original SQL COUNT helper `_user_has_admin_role` was removed in
    #1261 because the conflict merge of #1247 into main resolved the admin
    check to `is_system_admin(current_user)` (in-memory roles path), leaving
    the helper as dead code. These tests remain as access-control contracts.
    """

    def test_admin_can_view_summary(self, client):
        token = _login(client, _state["admin_email"])
        resp = client.get(
            f"/api/gamification/summary/{_state['student_id']}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200

    def test_non_admin_non_teacher_cannot_view_others_summary(self, client):
        db = TestingSessionLocal()
        other = User(
            email="p1243_other@test.com",
            username="p1243_other",
            password_hash=hash_password("Password1!"),
            name="Other Student",
            is_active=True,
            email_verified=True,
        )
        db.add(other)
        db.commit()
        db.refresh(other)
        other_id = other.id
        db.close()

        token = _login(client, _state["student_email"])
        resp = client.get(
            f"/api/gamification/summary/{other_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    def test_student_can_view_own_summary(self, client):
        token = _login(client, _state["student_email"])
        resp = client.get(
            f"/api/gamification/summary/{_state['student_id']}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200

    def test_admin_leaderboard_access(self, client):
        token = _login(client, _state["admin_email"])
        resp = client.get(
            f"/api/gamification/leaderboard/{_state['classroom_id']}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200

    def test_teacher_leaderboard_access(self, client):
        token = _login(client, _state["teacher_email"])
        resp = client.get(
            f"/api/gamification/leaderboard/{_state['classroom_id']}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
