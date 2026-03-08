"""
Tests for the student onboarding endpoint.

Covers:
- POST /api/auth/complete-onboarding
- onboarding_completed field in GET /api/users/me response

Run with:
    cd backend
    python -m pytest tests/test_onboarding.py -v
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
from app.models.user import Role


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
        role = Role(
            name=role_data["name"],
            display_name=role_data["display_name"],
            scope_level=role_data["scope_level"],
        )
        session.add(role)
    session.commit()


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def registered_student(client):
    """Register a fresh user and return dict with email, password, name, token."""
    unique = uuid.uuid4().hex[:8]
    email = f"student_{unique}@example.com"
    password = "StudentPass123!"
    name = f"Student {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201
    token = resp.json()["access_token"]
    return {"email": email, "password": password, "name": name, "token": token}


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ===========================================================================
# TDD: Red tests first — verify onboarding_completed field exists
# ===========================================================================


class TestOnboardingCompletedField:
    def test_new_user_has_onboarding_completed_false(self, client, registered_student):
        """A newly registered user should have onboarding_completed = False."""
        resp = client.get("/api/users/me", headers=auth_header(registered_student["token"]))
        assert resp.status_code == 200
        data = resp.json()
        assert "onboarding_completed" in data, "onboarding_completed field must be in /api/users/me response"
        assert data["onboarding_completed"] is False

    def test_onboarding_completed_is_boolean(self, client, registered_student):
        """onboarding_completed field must be a boolean."""
        resp = client.get("/api/users/me", headers=auth_header(registered_student["token"]))
        data = resp.json()
        assert isinstance(data["onboarding_completed"], bool)


# ===========================================================================
# TDD: Tests for POST /api/auth/complete-onboarding
# ===========================================================================


class TestCompleteOnboardingEndpoint:
    def test_complete_onboarding_returns_200(self, client, registered_student):
        """POST /api/auth/complete-onboarding should return 200 OK."""
        resp = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header(registered_student["token"]),
        )
        assert resp.status_code == 200

    def test_complete_onboarding_returns_success_message(self, client, registered_student):
        """Response should contain a success message."""
        resp = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header(registered_student["token"]),
        )
        data = resp.json()
        assert data["message"] == "Onboarding completed"

    def test_complete_onboarding_returns_onboarding_completed_true(self, client, registered_student):
        """Response body should confirm onboarding_completed is True."""
        resp = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header(registered_student["token"]),
        )
        assert resp.json()["onboarding_completed"] is True

    def test_complete_onboarding_persists_in_get_me(self, client):
        """After calling complete-onboarding, GET /api/users/me should show onboarding_completed=True."""
        # Register a fresh user for isolation
        unique = uuid.uuid4().hex[:8]
        reg_resp = client.post("/api/auth/register", json={
            "email": f"persist_{unique}@example.com",
            "password": "PersistPass123!",
            "name": f"Persist User {unique}",
        })
        token = reg_resp.json()["access_token"]

        # Initially False
        me_resp = client.get("/api/users/me", headers=auth_header(token))
        assert me_resp.json()["onboarding_completed"] is False

        # Complete onboarding
        complete_resp = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header(token),
        )
        assert complete_resp.status_code == 200

        # Now should be True
        me_resp2 = client.get("/api/users/me", headers=auth_header(token))
        assert me_resp2.json()["onboarding_completed"] is True

    def test_complete_onboarding_requires_auth(self, client):
        """Calling without a token should return 401."""
        resp = client.post("/api/auth/complete-onboarding")
        assert resp.status_code == 401

    def test_complete_onboarding_with_invalid_token_returns_401(self, client):
        """Invalid token should return 401."""
        resp = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header("not.a.valid.token"),
        )
        assert resp.status_code == 401

    def test_complete_onboarding_idempotent(self, client):
        """Calling complete-onboarding multiple times should be safe (idempotent)."""
        unique = uuid.uuid4().hex[:8]
        reg_resp = client.post("/api/auth/register", json={
            "email": f"idempotent_{unique}@example.com",
            "password": "IdempotentPass123!",
            "name": f"Idempotent User {unique}",
        })
        token = reg_resp.json()["access_token"]

        # Call twice
        resp1 = client.post("/api/auth/complete-onboarding", headers=auth_header(token))
        resp2 = client.post("/api/auth/complete-onboarding", headers=auth_header(token))

        assert resp1.status_code == 200
        assert resp2.status_code == 200

        # Should still be True after second call
        me_resp = client.get("/api/users/me", headers=auth_header(token))
        assert me_resp.json()["onboarding_completed"] is True


# ===========================================================================
# End-to-end flow
# ===========================================================================


class TestOnboardingFlow:
    def test_full_onboarding_flow(self, client):
        """Register -> check onboarding=False -> complete -> check onboarding=True."""
        unique = uuid.uuid4().hex[:8]

        # Step 1: Register
        reg_resp = client.post("/api/auth/register", json={
            "email": f"flow_{unique}@example.com",
            "password": "FlowPass123!",
            "name": f"Flow User {unique}",
        })
        assert reg_resp.status_code == 201
        token = reg_resp.json()["access_token"]

        # Step 2: Verify onboarding_completed is False after registration
        me_resp = client.get("/api/users/me", headers=auth_header(token))
        assert me_resp.status_code == 200
        assert me_resp.json()["onboarding_completed"] is False

        # Step 3: Complete onboarding
        complete_resp = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header(token),
        )
        assert complete_resp.status_code == 200
        assert complete_resp.json()["onboarding_completed"] is True

        # Step 4: Login again and verify onboarding_completed persists
        login_resp = client.post("/api/auth/login", json={
            "email": f"flow_{unique}@example.com",
            "password": "FlowPass123!",
        })
        new_token = login_resp.json()["access_token"]
        me_resp2 = client.get("/api/users/me", headers=auth_header(new_token))
        assert me_resp2.json()["onboarding_completed"] is True
