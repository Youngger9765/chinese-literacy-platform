"""
Tests for the terms of service acceptance endpoint.

Covers:
- POST /api/auth/accept-terms (authenticated)
- Verifies terms_accepted_at and terms_version are set
- Verifies terms_accepted boolean in UserResponse
- Verifies GET /api/users/me reflects terms_accepted

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-94/backend
    python -m pytest tests/test_terms.py -v
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
from app.auth.password import hash_password
from app.auth.jwt import create_access_token


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


@pytest.fixture(scope="module")
def db_engine():
    Base.metadata.create_all(bind=engine)
    with TestingSessionLocal() as session:
        _seed_roles(session)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client(db_engine):
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _register_and_get_token(client: TestClient, email: str, name: str = "Test User") -> str:
    """Register a user and return their JWT token."""
    password = "password123"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": name},
    )
    assert resp.status_code == 201, f"Register failed: {resp.json()}"
    verification_token = resp.json()["verification_token"]
    client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    return login_resp.json()["access_token"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestTermsAcceptance:
    """Tests for POST /api/auth/accept-terms."""

    def test_accept_terms_requires_auth(self, client: TestClient):
        """Unauthenticated request should return 401."""
        resp = client.post("/api/auth/accept-terms")
        assert resp.status_code == 401

    def test_accept_terms_sets_fields(self, client: TestClient):
        """Accepting terms should set terms_accepted_at and terms_version."""
        token = _register_and_get_token(client, "terms_user1@test.com")
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post("/api/auth/accept-terms", headers=headers)
        assert resp.status_code == 200

        data = resp.json()
        assert data["terms_accepted"] is True
        assert data["terms_accepted_at"] is not None
        assert data["terms_version"] == "1.0"

    def test_accept_terms_idempotent(self, client: TestClient):
        """Calling accept-terms twice should succeed and overwrite with latest timestamp."""
        token = _register_and_get_token(client, "terms_user2@test.com")
        headers = {"Authorization": f"Bearer {token}"}

        resp1 = client.post("/api/auth/accept-terms", headers=headers)
        assert resp1.status_code == 200
        ts1 = resp1.json()["terms_accepted_at"]

        resp2 = client.post("/api/auth/accept-terms", headers=headers)
        assert resp2.status_code == 200
        ts2 = resp2.json()["terms_accepted_at"]

        # Second call should succeed
        assert resp2.json()["terms_accepted"] is True
        # Timestamps may differ (second call updates to "now" again)
        assert ts2 is not None

    def test_get_me_shows_terms_not_accepted_for_new_user(self, client: TestClient):
        """Newly registered user should have terms_accepted = false."""
        token = _register_and_get_token(client, "terms_user3@test.com")
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.get("/api/users/me", headers=headers)
        assert resp.status_code == 200

        data = resp.json()
        assert data["terms_accepted"] is False
        assert data["terms_accepted_at"] is None
        assert data["terms_version"] is None

    def test_get_me_shows_terms_accepted_after_accepting(self, client: TestClient):
        """After accepting terms, GET /api/users/me should reflect terms_accepted = true."""
        token = _register_and_get_token(client, "terms_user4@test.com")
        headers = {"Authorization": f"Bearer {token}"}

        # Initially not accepted
        resp = client.get("/api/users/me", headers=headers)
        assert resp.json()["terms_accepted"] is False

        # Accept terms
        accept_resp = client.post("/api/auth/accept-terms", headers=headers)
        assert accept_resp.status_code == 200

        # Now should be accepted
        resp2 = client.get("/api/users/me", headers=headers)
        assert resp2.status_code == 200
        data = resp2.json()
        assert data["terms_accepted"] is True
        assert data["terms_accepted_at"] is not None
        assert data["terms_version"] == "1.0"

    def test_accept_terms_response_includes_user_fields(self, client: TestClient):
        """Response from accept-terms should include standard user fields."""
        token = _register_and_get_token(client, "terms_user5@test.com", name="Full User")
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.post("/api/auth/accept-terms", headers=headers)
        assert resp.status_code == 200

        data = resp.json()
        # Standard user fields should be present
        assert "id" in data
        assert "email" in data
        assert data["email"] == "terms_user5@test.com"
        assert data["name"] == "Full User"
        assert "roles" in data
        assert "created_at" in data
