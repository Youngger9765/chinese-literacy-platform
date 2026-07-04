"""
Tests for copyright confirmation gate on classroom text assignment.

Covers:
- POST /api/classrooms/{id}/texts without copyright_confirmed → 422
- POST /api/classrooms/{id}/texts with copyright_confirmed=false → 422
- POST /api/classrooms/{id}/texts with copyright_confirmed=true → 201

Run with:
    cd backend
    python -m pytest tests/test_copyright.py -v
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
from app.models.school import School


# ---------------------------------------------------------------------------
# Test database setup (SQLite in-memory with StaticPool)
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
    school = School(name="Copyright Test School")
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


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_and_login(client) -> str:
    unique = uuid.uuid4().hex[:8]
    email = f"teacher_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"Teacher {unique}",
    })
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]

    me_resp = client.get("/api/users/me", headers=_auth_header(token))
    user_id = me_resp.json()["id"]
    _mk = TestingSessionLocal()
    try:
        _trole = _mk.query(Role).filter(Role.name == "teacher").first()
        if _trole and not _mk.query(UserRole).filter(
            UserRole.user_id == user_id, UserRole.role_id == _trole.id,
            UserRole.scope_type == "school", UserRole.scope_id == str(_test_school_id),
        ).first():
            _mk.add(UserRole(user_id=user_id, role_id=_trole.id,
                             scope_type="school", scope_id=str(_test_school_id)))
            _mk.commit()
    finally:
        _mk.close()

    return token


def _create_classroom(client, token: str, school_id: int) -> int:
    resp = client.post(
        "/api/classrooms",
        json={"name": f"班級_{uuid.uuid4().hex[:6]}", "school_id": school_id},
        headers=_auth_header(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# Use story id "1" which is known to exist in the fixture YAML data
TEXT_ID = "1"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestCopyrightConfirmation:
    """POST /api/classrooms/{id}/texts copyright gate."""

    @pytest.fixture(scope="class")
    def setup(self, client, school_id):
        token = _register_and_login(client)
        classroom_id = _create_classroom(client, token, school_id)
        return {"token": token, "classroom_id": classroom_id}

    def test_missing_copyright_confirmed_returns_422(self, client, setup):
        """Omitting copyright_confirmed (defaults to false) must return 422."""
        resp = client.post(
            f"/api/classrooms/{setup['classroom_id']}/texts",
            json={"text_id": TEXT_ID},
            headers=_auth_header(setup["token"]),
        )
        assert resp.status_code == 422
        assert "copyright_confirmed" in resp.json().get("detail", "").lower()

    def test_copyright_confirmed_false_returns_422(self, client, setup):
        """Explicitly sending copyright_confirmed=false must return 422."""
        resp = client.post(
            f"/api/classrooms/{setup['classroom_id']}/texts",
            json={"text_id": TEXT_ID, "copyright_confirmed": False},
            headers=_auth_header(setup["token"]),
        )
        assert resp.status_code == 422
        assert "copyright_confirmed" in resp.json().get("detail", "").lower()

    def test_copyright_confirmed_true_succeeds(self, client, setup):
        """Sending copyright_confirmed=true must succeed with 201."""
        resp = client.post(
            f"/api/classrooms/{setup['classroom_id']}/texts",
            json={"text_id": TEXT_ID, "copyright_confirmed": True},
            headers=_auth_header(setup["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["text_id"] == TEXT_ID
        assert "title" in data
        assert "assigned_at" in data
