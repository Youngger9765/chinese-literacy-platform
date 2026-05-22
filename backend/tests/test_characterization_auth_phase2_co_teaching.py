"""
Characterization tests for co_teaching.py auth behavior — Phase 2 (#1831).

These tests LOCK IN the current permission model BEFORE any refactoring.
They must ALL PASS on unmodified code. Run them again after migration to
confirm no regression.

Routes tested:
  GET    /api/classrooms/{classroom_id}/teachers
  POST   /api/classrooms/{classroom_id}/teachers
  DELETE /api/classrooms/{classroom_id}/teachers/{teacher_id}

Run:
    cd backend && python -m pytest tests/test_characterization_auth_phase2_co_teaching.py -v
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
from app.models.school import School


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


# ---------------------------------------------------------------------------
# Module-scope fixture: create DB, seed, register users, create classroom
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def setup_module():
    Base.metadata.create_all(bind=engine)

    # Seed roles + school
    db = TestingSessionLocal()
    for r in SEED_ROLES:
        db.add(Role(name=r["name"], display_name=r["display_name"], scope_level=r["scope_level"]))
    db.commit()
    school = School(name="Phase2 Co-teaching School")
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
        _state["owner_token"]      = _register(client, "Owner",      "cotest_owner@test.com")
        _state["stranger_token"]   = _register(client, "Stranger",   "cotest_stranger@test.com")
        _state["admin_token"]      = _register(client, "Admin",      "cotest_admin@test.com")
        # co_teacher1 — will be invited in setup (main co-teacher for most tests)
        _state["coteacher_token"]  = _register(client, "CoTeacher",  "cotest_coteacher@test.com")
        # extra_teacher — used for invite-by-admin test + admin-remove test
        _state["extra_token"]      = _register(client, "Extra",      "cotest_extra@test.com")
        # leave_teacher — will be invited so they can self-remove
        _state["leave_token"]      = _register(client, "LeaveTeacher", "cotest_leave@test.com")

        # Grant admin role
        _grant_system_admin("cotest_admin@test.com")

        # Create classroom as owner
        cr = client.post(
            "/api/classrooms",
            json={"name": "Co-teaching Class", "school_id": school_id},
            headers=_h(_state["owner_token"]),
        )
        assert cr.status_code == 201, cr.text
        classroom = cr.json()
        _state["classroom_id"] = classroom["id"]
        _state["owner_id"]     = classroom["teacher_id"]

        # Invite coteacher so they're a member for list/remove tests
        ir = client.post(
            f"/api/classrooms/{classroom['id']}/teachers",
            json={"email": "cotest_coteacher@test.com"},
            headers=_h(_state["owner_token"]),
        )
        assert ir.status_code == 201, f"invite coteacher failed: {ir.text}"
        _state["coteacher_id"] = ir.json()["teacher_id"]

        # Invite leave_teacher so they can self-remove later
        lr2 = client.post(
            f"/api/classrooms/{classroom['id']}/teachers",
            json={"email": "cotest_leave@test.com"},
            headers=_h(_state["owner_token"]),
        )
        assert lr2.status_code == 201, lr2.text
        _state["leave_teacher_id"] = lr2.json()["teacher_id"]

        yield

    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return _state["client"]


# ---------------------------------------------------------------------------
# GET /api/classrooms/{classroom_id}/teachers — list_classroom_teachers
# ---------------------------------------------------------------------------

def test_list_teachers_owner_200(client):
    """Classroom owner can list co-teachers → 200."""
    r = client.get(
        f"/api/classrooms/{_state['classroom_id']}/teachers",
        headers=_h(_state["owner_token"]),
    )
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_list_teachers_coteacher_200(client):
    """Co-teacher can list classroom teachers → 200."""
    r = client.get(
        f"/api/classrooms/{_state['classroom_id']}/teachers",
        headers=_h(_state["coteacher_token"]),
    )
    assert r.status_code == 200


def test_list_teachers_stranger_403(client):
    """Non-member cannot list classroom teachers → 403."""
    r = client.get(
        f"/api/classrooms/{_state['classroom_id']}/teachers",
        headers=_h(_state["stranger_token"]),
    )
    assert r.status_code == 403


def test_list_teachers_admin_200(client):
    """system_admin can list any classroom's teachers → 200."""
    r = client.get(
        f"/api/classrooms/{_state['classroom_id']}/teachers",
        headers=_h(_state["admin_token"]),
    )
    assert r.status_code == 200


def test_list_teachers_bad_classroom_404(client):
    """Nonexistent classroom_id → 404."""
    r = client.get(
        "/api/classrooms/999999/teachers",
        headers=_h(_state["owner_token"]),
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/classrooms/{classroom_id}/teachers — invite_co_teacher
# ---------------------------------------------------------------------------

def test_invite_owner_201(client):
    """Owner can invite a new teacher → 201."""
    r = client.post(
        f"/api/classrooms/{_state['classroom_id']}/teachers",
        json={"email": "cotest_extra@test.com"},
        headers=_h(_state["owner_token"]),
    )
    assert r.status_code == 201
    body = r.json()
    assert body["role"] == "assistant"
    _state["extra_teacher_id"] = body["teacher_id"]


def test_invite_stranger_403(client):
    """Non-owner stranger cannot invite → 403."""
    r = client.post(
        f"/api/classrooms/{_state['classroom_id']}/teachers",
        json={"email": "cotest_extra@test.com"},
        headers=_h(_state["stranger_token"]),
    )
    assert r.status_code == 403


def test_invite_duplicate_409(client):
    """Inviting already-a-member teacher → 409 Conflict."""
    r = client.post(
        f"/api/classrooms/{_state['classroom_id']}/teachers",
        json={"email": "cotest_coteacher@test.com"},
        headers=_h(_state["owner_token"]),
    )
    assert r.status_code == 409


def test_invite_nonexistent_user_404(client):
    """Inviting email that has no account → 404."""
    r = client.post(
        f"/api/classrooms/{_state['classroom_id']}/teachers",
        json={"email": "nobody@nowhere.com"},
        headers=_h(_state["owner_token"]),
    )
    assert r.status_code == 404


def test_invite_owner_self_409(client):
    """Inviting the classroom owner themselves → 409 (already owner)."""
    r = client.post(
        f"/api/classrooms/{_state['classroom_id']}/teachers",
        json={"email": "cotest_owner@test.com"},
        headers=_h(_state["owner_token"]),
    )
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# DELETE /api/classrooms/{classroom_id}/teachers/{teacher_id} — remove_co_teacher
# ---------------------------------------------------------------------------

def test_remove_coteacher_by_owner_204(client):
    """Owner can remove a co-teacher → 204.

    Uses extra_teacher who was invited in test_invite_owner_201 (tests are ordered).
    xfail if invite test didn't run or failed.
    """
    teacher_id = _state.get("extra_teacher_id")
    if not teacher_id:
        pytest.skip("extra_teacher_id not set — invite test must run first")
    r = client.delete(
        f"/api/classrooms/{_state['classroom_id']}/teachers/{teacher_id}",
        headers=_h(_state["owner_token"]),
    )
    assert r.status_code == 204


def test_coteacher_self_remove_204(client):
    """Co-teacher can remove themselves from the classroom → 204."""
    teacher_id = _state.get("leave_teacher_id")
    if not teacher_id:
        pytest.skip("leave_teacher_id not set")
    r = client.delete(
        f"/api/classrooms/{_state['classroom_id']}/teachers/{teacher_id}",
        headers=_h(_state["leave_token"]),
    )
    assert r.status_code == 204


def test_remove_stranger_403(client):
    """Stranger cannot remove a co-teacher → 403."""
    r = client.delete(
        f"/api/classrooms/{_state['classroom_id']}/teachers/{_state['coteacher_id']}",
        headers=_h(_state["stranger_token"]),
    )
    assert r.status_code == 403


def test_remove_owner_via_endpoint_400(client):
    """Attempting to remove the primary owner via this endpoint → 400."""
    r = client.delete(
        f"/api/classrooms/{_state['classroom_id']}/teachers/{_state['owner_id']}",
        headers=_h(_state["owner_token"]),
    )
    assert r.status_code == 400


def test_remove_nonexistent_coteacher_404(client):
    """Removing a teacher_id that is not a co-teacher → 404."""
    r = client.delete(
        f"/api/classrooms/{_state['classroom_id']}/teachers/999999",
        headers=_h(_state["owner_token"]),
    )
    assert r.status_code == 404
