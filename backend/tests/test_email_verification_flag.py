"""
Tests for REQUIRE_EMAIL_VERIFICATION config flag (issue #460).

Covers:
- When REQUIRE_EMAIL_VERIFICATION=False (default):
  - Registration sets email_verified=True (auto-verify, backward-compatible)
  - Login works without manual email verification
- When REQUIRE_EMAIL_VERIFICATION=True:
  - Registration sets email_verified=False
  - Login blocked for unverified users (403)
  - /verify-email endpoint allows login after verification
  - /resend-verification issues new token

Run with:
    cd backend
    python -m pytest tests/test_email_verification_flag.py -v
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
from unittest.mock import patch

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User


# ---------------------------------------------------------------------------
# Test DB setup (SQLite in-memory)
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


def _register(client, unique=None):
    """Helper: register a new user and return the response body + credentials."""
    if unique is None:
        unique = uuid.uuid4().hex[:8]
    email = f"flagtest_{unique}@test.edu.tw"
    password = "StrongPass1!"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"Flag Test {unique}",
    })
    assert resp.status_code == 201
    body = resp.json()
    body["email"] = email
    body["password"] = password
    return body


# ---------------------------------------------------------------------------
# Tests: REQUIRE_EMAIL_VERIFICATION=False (default — auto-verify behaviour)
# ---------------------------------------------------------------------------


class TestEmailVerificationFlagOff:
    """When REQUIRE_EMAIL_VERIFICATION=False, registration auto-verifies email."""

    def test_flag_off_register_sets_email_verified_true(self, client):
        """With flag off, email_verified should be True immediately after registration."""
        from app.config import settings

        with patch.object(settings, "require_email_verification", False):
            data = _register(client)

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.email == data["email"]).first()
            assert user is not None
            assert user.email_verified is True
        finally:
            db.close()

    def test_flag_off_login_without_verification_succeeds(self, client):
        """With flag off, a freshly-registered user can login without any verification step."""
        from app.config import settings

        with patch.object(settings, "require_email_verification", False):
            data = _register(client)
            resp = client.post("/api/auth/login", json={
                "email": data["email"],
                "password": data["password"],
            })

        assert resp.status_code == 200
        assert "access_token" in resp.json()

    def test_flag_off_register_response_has_no_verification_token(self, client):
        """With flag off, the register response omits or nullifies the verification_token."""
        from app.config import settings

        with patch.object(settings, "require_email_verification", False):
            data = _register(client)

        # When auto-verified, no verification token is needed
        assert data.get("verification_token") is None


# ---------------------------------------------------------------------------
# Tests: REQUIRE_EMAIL_VERIFICATION=True (opt-in enforcement)
# ---------------------------------------------------------------------------


class TestEmailVerificationFlagOn:
    """When REQUIRE_EMAIL_VERIFICATION=True, users must verify email before login."""

    def test_flag_on_register_sets_email_verified_false(self, client):
        """With flag on, email_verified should be False after registration."""
        from app.config import settings

        with patch.object(settings, "require_email_verification", True):
            data = _register(client)

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.email == data["email"]).first()
            assert user is not None
            assert user.email_verified is False
        finally:
            db.close()

    def test_flag_on_register_returns_verification_token(self, client):
        """With flag on, the register response includes a verification_token for dev/staging testing."""
        from app.config import settings

        with patch.object(settings, "require_email_verification", True):
            data = _register(client)

        assert "verification_token" in data
        assert data["verification_token"] is not None

    def test_flag_on_login_without_verification_returns_403(self, client):
        """With flag on, unverified users cannot login."""
        from app.config import settings

        with patch.object(settings, "require_email_verification", True):
            data = _register(client)
            resp = client.post("/api/auth/login", json={
                "email": data["email"],
                "password": data["password"],
            })

        assert resp.status_code == 403
        assert "驗證" in resp.json()["detail"]

    def test_flag_on_verify_then_login_succeeds(self, client):
        """With flag on, verifying email token allows login."""
        from app.config import settings

        with patch.object(settings, "require_email_verification", True):
            data = _register(client)

        # Verify email using the dev-mode token
        verify_resp = client.get(f"/api/auth/verify-email?token={data['verification_token']}")
        assert verify_resp.status_code == 200

        # Now login should work
        login_resp = client.post("/api/auth/login", json={
            "email": data["email"],
            "password": data["password"],
        })
        assert login_resp.status_code == 200
        assert "access_token" in login_resp.json()

    def test_flag_on_resend_verification_issues_new_token(self, client):
        """With flag on, resend-verification returns a new token."""
        from app.config import settings

        with patch.object(settings, "require_email_verification", True):
            data = _register(client)

        resp = client.post("/api/auth/resend-verification", json={"email": data["email"]})
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("verification_token") is not None

    def test_flag_on_resend_token_allows_login(self, client):
        """With flag on, verifying with the resent token allows login."""
        from app.config import settings

        with patch.object(settings, "require_email_verification", True):
            data = _register(client)

        # Resend and get new token
        resend_resp = client.post("/api/auth/resend-verification", json={"email": data["email"]})
        new_token = resend_resp.json()["verification_token"]

        # Verify with new token
        client.get(f"/api/auth/verify-email?token={new_token}")

        # Login should now succeed
        login_resp = client.post("/api/auth/login", json={
            "email": data["email"],
            "password": data["password"],
        })
        assert login_resp.status_code == 200


# ---------------------------------------------------------------------------
# Tests: Config flag is readable from environment variable
# ---------------------------------------------------------------------------


class TestEmailVerificationFlagConfig:
    """The flag should be configurable via REQUIRE_EMAIL_VERIFICATION env var."""

    def test_config_flag_defaults_to_false(self):
        """REQUIRE_EMAIL_VERIFICATION should default to False."""
        from app.config import Settings

        s = Settings()
        assert s.require_email_verification is False

    def test_config_flag_can_be_set_true_via_env(self, monkeypatch):
        """REQUIRE_EMAIL_VERIFICATION=true in env should result in True."""
        from app.config import Settings

        monkeypatch.setenv("REQUIRE_EMAIL_VERIFICATION", "true")
        s = Settings()
        assert s.require_email_verification is True

    def test_config_flag_is_case_insensitive(self, monkeypatch):
        """REQUIRE_EMAIL_VERIFICATION=True (mixed case) should work."""
        from app.config import Settings

        monkeypatch.setenv("REQUIRE_EMAIL_VERIFICATION", "True")
        s = Settings()
        assert s.require_email_verification is True
