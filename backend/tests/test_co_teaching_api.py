"""
Tests for the co-teaching API (Issue #244).

Covers:
- GET    /api/classrooms/{id}/teachers          (list teachers)
- POST   /api/classrooms/{id}/teachers          (invite co-teacher)
- DELETE /api/classrooms/{id}/teachers/{tid}    (remove co-teacher)

Permission scenarios:
- Owner can invite and remove
- Co-teacher can view list and leave
- Stranger cannot access

Uses SQLite in-memory DB.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-244/backend
    python -m pytest tests/test_co_teaching_api.py -v
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
from app.models.user import Role
from app.models.school import School


# ---------------------------------------------------------------------------
# DB setup
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
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]

# Module-level state shared across tests
_state: dict = {}


def _seed_roles(session):
    for r in SEED_ROLES:
        session.add(Role(name=r["name"], display_name=r["display_name"], scope_level=r["scope_level"]))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="Test School")
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


def _register(client, name, email, password="Password123!"):
    """Register a user, verify their email (dev-mode token), then login to get JWT."""
    r = client.post("/api/auth/register", json={
        "name": name,
        "email": email,
        "password": password,
    })
    assert r.status_code in (200, 201), r.text
    # Dev mode returns verification_token directly; verify it before login
    verification_token = r.json().get("verification_token")
    assert verification_token is not None, "Expected verification_token in dev mode response"
    verify_r = client.get(f"/api/auth/verify-email?token={verification_token}")
    assert verify_r.status_code == 200, verify_r.text
    # Login to get access_token
    login_r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_r.status_code == 200, login_r.text
    return login_r.json()["access_token"]


def _create_classroom(client, token, school_id):
    r = client.post("/api/classrooms", json={"name": "Test Class", "school_id": school_id},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_module():
    """Create tables, seed data, register users, create classroom."""
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    school_id = _seed_school(session)
    session.close()

    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app) as client:
        _state["client"] = client
        _state["owner_token"] = _register(client, "Owner Teacher", "owner@test.com")
        _state["co_teacher_token"] = _register(client, "Co Teacher", "coteacher@test.com")
        _state["stranger_token"] = _register(client, "Stranger", "stranger@test.com")

        cr = _create_classroom(client, _state["owner_token"], school_id)
        _state["classroom_id"] = cr["id"]
        _state["owner_id"] = cr["teacher_id"]

        yield

    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return _state["client"]


@pytest.fixture
def owner_token():
    return _state["owner_token"]


@pytest.fixture
def co_teacher_token():
    return _state["co_teacher_token"]


@pytest.fixture
def stranger_token():
    return _state["stranger_token"]


@pytest.fixture
def classroom_id():
    return _state["classroom_id"]


@pytest.fixture
def owner_id():
    return _state["owner_id"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_list_teachers_includes_primary_owner(client, owner_token, classroom_id, owner_id):
    """After classroom creation, GET /teachers should return 1 primary teacher."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(owner_token))
    assert r.status_code == 200
    teachers = r.json()
    assert len(teachers) == 1
    assert teachers[0]["role"] == "primary"
    assert teachers[0]["teacher_id"] == owner_id


def test_stranger_cannot_list_teachers(client, stranger_token, classroom_id):
    """Stranger cannot see teacher list."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(stranger_token))
    assert r.status_code == 403


def test_invite_co_teacher(client, owner_token, classroom_id):
    """Owner can invite a co-teacher by email."""
    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": "coteacher@test.com"},
        headers=_h(owner_token),
    )
    assert r.status_code == 201
    data = r.json()
    assert data["role"] == "assistant"
    assert data["classroom_id"] == classroom_id


def test_list_teachers_after_invite(client, owner_token, classroom_id):
    """After invite, list should have 2 teachers."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(owner_token))
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_co_teacher_can_list_teachers(client, co_teacher_token, classroom_id):
    """Co-teacher can view the teacher list."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(co_teacher_token))
    assert r.status_code == 200


def test_co_teacher_can_view_classroom(client, co_teacher_token, classroom_id):
    """Co-teacher can GET classroom detail."""
    r = client.get(f"/api/classrooms/{classroom_id}", headers=_h(co_teacher_token))
    assert r.status_code == 200


def test_co_teacher_sees_classroom_in_dashboard(client, co_teacher_token, classroom_id):
    """Co-teacher should see the classroom in GET /classrooms list."""
    r = client.get("/api/classrooms", headers=_h(co_teacher_token))
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()["items"]]
    assert classroom_id in ids


def test_co_teacher_cannot_invite_others(client, co_teacher_token, classroom_id):
    """Co-teacher cannot invite another teacher."""
    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": "stranger@test.com"},
        headers=_h(co_teacher_token),
    )
    assert r.status_code == 403


def test_duplicate_invite_returns_409(client, owner_token, classroom_id):
    """Inviting same teacher twice returns 409."""
    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": "coteacher@test.com"},
        headers=_h(owner_token),
    )
    assert r.status_code == 409


def test_invite_nonexistent_email_returns_404(client, owner_token, classroom_id):
    """Inviting unknown email returns 404."""
    r = client.post(
        f"/api/classrooms/{classroom_id}/teachers",
        json={"email": "nobody@nowhere.com"},
        headers=_h(owner_token),
    )
    assert r.status_code == 404


def test_cannot_remove_owner_via_co_teaching_endpoint(client, owner_token, classroom_id, owner_id):
    """Attempting to remove the owner via DELETE /teachers/{owner_id} returns 400."""
    r = client.delete(
        f"/api/classrooms/{classroom_id}/teachers/{owner_id}",
        headers=_h(owner_token),
    )
    assert r.status_code == 400


def test_owner_can_remove_co_teacher(client, owner_token, classroom_id):
    """Owner can remove a co-teacher."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(owner_token))
    teachers = r.json()
    assistant = next(t for t in teachers if t["role"] == "assistant")
    co_teacher_id = assistant["teacher_id"]

    r = client.delete(
        f"/api/classrooms/{classroom_id}/teachers/{co_teacher_id}",
        headers=_h(owner_token),
    )
    assert r.status_code == 204


def test_list_after_removal_has_one_teacher(client, owner_token, classroom_id):
    """After removal, only the owner remains."""
    r = client.get(f"/api/classrooms/{classroom_id}/teachers", headers=_h(owner_token))
    assert r.status_code == 200
    assert len(r.json()) == 1
