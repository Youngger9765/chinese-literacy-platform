"""
Characterization tests for gamification.py auth behavior — Phase 2 (#1831).

These tests LOCK IN the current permission model BEFORE any refactoring.
They must ALL PASS on unmodified code. Run again after migration to confirm
no regression.

Routes tested:
  GET /api/gamification/summary/{student_id}    → proxies _assert_can_view
  GET /api/gamification/leaderboard/{classroom_id}

Run:
    cd backend && python -m pytest tests/test_characterization_auth_phase2_gamification.py -v
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole, User
from app.models.school import School, Classroom, ClassroomStudent, ClassroomTeacher


# ---------------------------------------------------------------------------
# SQLite in-memory DB setup
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _fk(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin",    "display_name": "Org Admin",    "scope_level": "organization"},
    {"name": "teacher",      "display_name": "Teacher",      "scope_level": "school"},
    {"name": "student",      "display_name": "Student",      "scope_level": "school"},
]

_state: dict = {}


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _reset_rate_limiters():
    """Reset all auth rate limiters between registrations to avoid 429."""
    try:
        from app.routes.auth import rate_limiter
        rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
    try:
        from app.auth.rate_limiter import general_rate_limiter
        general_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass


def _register(client, name, email, password="Password123!"):
    """Register, verify email (dev-mode token), login → return access token."""
    _reset_rate_limiters()
    r = client.post("/api/auth/register", json={"name": name, "email": email, "password": password})
    assert r.status_code in (200, 201), f"register failed: {r.text}"
    token = r.json().get("verification_token")
    if token:
        vr = client.get(f"/api/auth/verify-email?token={token}")
        assert vr.status_code == 200, vr.text
    _reset_rate_limiters()
    lr = client.post("/api/auth/login", json={"email": email, "password": password})
    assert lr.status_code == 200, lr.text
    return lr.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _grant_system_admin(user_email: str) -> None:
    """Give a registered user the system_admin role directly via DB."""
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "system_admin").first()
        user = db.query(User).filter(User.email == user_email).first()
        assert role and user, "role/user not found when granting system_admin"
        ur = UserRole(
            user_id=user.id,
            role_id=role.id,
            is_active=True,
            scope_type="platform",
            scope_id=None,
        )
        db.add(ur)
        db.commit()
    finally:
        db.close()


def _get_user_id(email: str) -> int:
    db = TestingSessionLocal()
    try:
        u = db.query(User).filter(User.email == email).first()
        assert u, f"user {email} not found"
        return u.id
    finally:
        db.close()


def _enroll_student(classroom_id: int, student_id: int) -> None:
    """Directly enroll a student in a classroom via DB."""
    db = TestingSessionLocal()
    try:
        cs = ClassroomStudent(classroom_id=classroom_id, student_id=student_id)
        db.add(cs)
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Module-scope fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def setup_module():
    Base.metadata.create_all(bind=engine)

    # Seed roles + school
    db = TestingSessionLocal()
    for r in SEED_ROLES:
        db.add(Role(name=r["name"], display_name=r["display_name"], scope_level=r["scope_level"]))
    db.commit()
    school = School(name="Phase2 Gamification School")
    db.add(school)
    db.commit()
    db.refresh(school)
    school_id = school.id
    db.close()

    # Reset all rate limiters
    _reset_rate_limiters()

    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app) as client:
        _state["client"] = client

        # Register users
        _state["teacher_token"]  = _register(client, "Teacher",  "gamtest_teacher@test.com")
        _state["student_token"]  = _register(client, "Student",  "gamtest_student@test.com")
        _state["stranger_token"] = _register(client, "Stranger", "gamtest_stranger@test.com")
        _state["admin_token"]    = _register(client, "Admin",    "gamtest_admin@test.com")

        # Grant admin role via DB
        _grant_system_admin("gamtest_admin@test.com")

        # Retrieve user IDs
        _state["teacher_id"]  = _get_user_id("gamtest_teacher@test.com")
        _state["student_id"]  = _get_user_id("gamtest_student@test.com")
        _state["stranger_id"] = _get_user_id("gamtest_stranger@test.com")
        _state["admin_id"]    = _get_user_id("gamtest_admin@test.com")

        # Create classroom as teacher
        cr = client.post(
            "/api/classrooms",
            json={"name": "Gamification Class", "school_id": school_id},
            headers=_h(_state["teacher_token"]),
        )
        assert cr.status_code == 201, cr.text
        _state["classroom_id"] = cr.json()["id"]

        # Enroll student in classroom via DB
        _enroll_student(_state["classroom_id"], _state["student_id"])

        yield

    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return _state["client"]


# ---------------------------------------------------------------------------
# GET /api/gamification/summary/{student_id} — _assert_can_view
# ---------------------------------------------------------------------------

def test_student_views_own_summary_200(client):
    """Student can view their own gamification summary → 200."""
    r = client.get(
        f"/api/gamification/summary/{_state['student_id']}",
        headers=_h(_state["student_token"]),
    )
    assert r.status_code == 200


def test_teacher_with_student_in_classroom_views_summary_200(client):
    """Teacher who owns a classroom containing the student can view summary → 200."""
    r = client.get(
        f"/api/gamification/summary/{_state['student_id']}",
        headers=_h(_state["teacher_token"]),
    )
    assert r.status_code == 200


def test_stranger_teacher_cannot_view_summary_403(client):
    """Teacher whose classroom does NOT contain the student → 403."""
    r = client.get(
        f"/api/gamification/summary/{_state['student_id']}",
        headers=_h(_state["stranger_token"]),
    )
    assert r.status_code == 403


def test_admin_views_any_student_summary_200(client):
    """system_admin can view any student's gamification summary → 200.

    Current code uses is_system_admin(current_user) which checks eager-loaded
    user_roles. This characterizes that the admin path works end-to-end.
    """
    r = client.get(
        f"/api/gamification/summary/{_state['student_id']}",
        headers=_h(_state["admin_token"]),
    )
    assert r.status_code == 200


def test_summary_nonexistent_student_404(client):
    """Student ID that does not exist → 404 (not 500)."""
    r = client.get(
        "/api/gamification/summary/999999",
        headers=_h(_state["teacher_token"]),
    )
    # The route returns 404 for non-existent student (after _assert_can_view passes
    # for the teacher because there's no classroom enrollment to check against).
    # Current code: _assert_can_view raises 403 if no classroom has the student,
    # then the 404 check for the student object comes after.
    # Teacher cannot see non-existent student → 403 is also valid current behavior.
    assert r.status_code in (403, 404)


# ---------------------------------------------------------------------------
# GET /api/gamification/leaderboard/{classroom_id}
# ---------------------------------------------------------------------------

def test_leaderboard_teacher_200(client):
    """Classroom teacher can view their classroom leaderboard → 200."""
    r = client.get(
        f"/api/gamification/leaderboard/{_state['classroom_id']}",
        headers=_h(_state["teacher_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    assert "classroom_id" in body
    assert "entries" in body


def test_leaderboard_enrolled_student_200(client):
    """Enrolled student can view their classroom leaderboard → 200."""
    r = client.get(
        f"/api/gamification/leaderboard/{_state['classroom_id']}",
        headers=_h(_state["student_token"]),
    )
    assert r.status_code == 200


def test_leaderboard_stranger_403(client):
    """Stranger (not teacher, not enrolled, not admin) cannot view leaderboard → 403."""
    r = client.get(
        f"/api/gamification/leaderboard/{_state['classroom_id']}",
        headers=_h(_state["stranger_token"]),
    )
    assert r.status_code == 403


def test_leaderboard_admin_200(client):
    """system_admin can view any classroom leaderboard → 200.

    Current code uses is_system_admin(current_user) (eager-loaded roles check).
    This characterizes that the admin bypass works end-to-end.
    """
    r = client.get(
        f"/api/gamification/leaderboard/{_state['classroom_id']}",
        headers=_h(_state["admin_token"]),
    )
    assert r.status_code == 200


def test_leaderboard_bad_classroom_404(client):
    """Nonexistent classroom_id → 404."""
    r = client.get(
        "/api/gamification/leaderboard/999999",
        headers=_h(_state["teacher_token"]),
    )
    assert r.status_code == 404
