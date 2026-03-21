"""
Tests for password validation and password reset flow (Issue #255).

Covers:
- Password strength validation rules (unit tests)
- POST /api/auth/register with weak passwords
- POST /api/auth/change-password with weak new password
- POST /api/auth/forgot-password
- POST /api/auth/reset-password
- POST /api/auth/verify-email

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform/backend
    python -m pytest tests/test_password_validation.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.utils.password_validator import validate_password_strength, get_password_strength_level


# ---------------------------------------------------------------------------
# Test database setup
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def register_user(client: TestClient, email: str, password: str, name: str = "Test User"):
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    # If registration succeeded, auto-verify email using the dev-mode token (issue #460)
    if resp.status_code == 201:
        vt = resp.json().get("verification_token")
        if vt:
            client.get(f"/api/auth/verify-email?token={vt}")
    return resp


def register_and_verify(client: TestClient, email: str, password: str, name: str = "Test User"):
    """Register a user and verify their email so they can log in."""
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201
    token = resp.json()["verification_token"]
    client.post("/api/auth/verify-email", json={"token": token})
    return resp


def get_auth_token(client: TestClient, email: str, password: str) -> str:
    register_and_verify(client, email, password)
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    return resp.json()["access_token"]


# Unit tests: password_validator module

class TestPasswordValidatorUnit:

    def test_valid_password_passes(self):
        result = validate_password_strength("secure123")
        assert result.is_valid is True
        assert result.errors == []

    def test_too_short_fails(self):
        result = validate_password_strength("abc1")
        assert result.is_valid is False
        assert any("8" in e for e in result.errors)

    def test_no_letter_fails(self):
        result = validate_password_strength("12345678")
        assert result.is_valid is False
        assert any("英文字母" in e for e in result.errors)

    def test_no_number_fails(self):
        result = validate_password_strength("abcdefgh")
        assert result.is_valid is False
        assert any("數字" in e for e in result.errors)

    def test_multiple_failures_reported(self):
        # Only 3 chars, no letters, no numbers check — but "abc" is 3 chars with letters
        result = validate_password_strength("abc")  # too short, no number
        assert result.is_valid is False
        assert len(result.errors) == 2

    def test_empty_string_fails(self):
        result = validate_password_strength("")
        assert result.is_valid is False

    def test_exact_8_chars_with_letter_and_number(self):
        result = validate_password_strength("abcdef12")
        assert result.is_valid is True

    def test_uppercase_letters_count(self):
        result = validate_password_strength("ABCDEF12")
        assert result.is_valid is True


class TestPasswordStrengthLevel:

    def test_empty_is_weak(self):
        assert get_password_strength_level("") == "weak"

    def test_short_only_letters_is_weak(self):
        assert get_password_strength_level("abc") == "weak"

    def test_8_chars_letter_and_number_is_medium(self):
        level = get_password_strength_level("abcdef12")
        assert level in ("medium", "strong")

    def test_long_mixed_is_strong(self):
        level = get_password_strength_level("Str0ng!Pass#2025")
        assert level == "strong"


# Integration tests: register with password strength

class TestRegisterPasswordStrength:

    def test_register_valid_password_succeeds(self, client):
        resp = register_user(client, "user@example.com", "secure123")
        assert resp.status_code == 201
        assert "verification_token" in resp.json()  # email verification required (#460)

    def test_register_too_short_fails(self, client):
        resp = register_user(client, "user@example.com", "abc1")
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        # detail is {"errors": [...]} from our custom handler
        errors = detail["errors"] if isinstance(detail, dict) else []
        assert any("8" in e for e in errors)

    def test_register_no_number_fails(self, client):
        resp = register_user(client, "user@example.com", "abcdefgh")
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        errors = detail["errors"] if isinstance(detail, dict) else []
        assert any("數字" in e for e in errors)

    def test_register_no_letter_fails(self, client):
        resp = register_user(client, "user@example.com", "12345678")
        assert resp.status_code == 422
        detail = resp.json()["detail"]
        errors = detail["errors"] if isinstance(detail, dict) else []
        assert any("英文字母" in e for e in errors)

    def test_register_empty_password_fails(self, client):
        resp = register_user(client, "user@example.com", "")
        # Pydantic min_length=1 returns 422 before our validator runs
        assert resp.status_code == 422


# Integration tests: change-password with password strength

class TestChangePasswordStrength:

    def test_change_to_weak_password_fails(self, client):
        token = get_auth_token(client, "user@example.com", "secure123")

        resp = client.post(
            "/api/auth/change-password",
            json={"old_password": "secure123", "new_password": "abc"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 422

    def test_change_to_strong_password_succeeds(self, client):
        token = get_auth_token(client, "user@example.com", "secure123")

        resp = client.post(
            "/api/auth/change-password",
            json={"old_password": "secure123", "new_password": "newPass99"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200


# Integration tests: forgot-password flow

class TestForgotPasswordFlow:

    def test_forgot_password_with_valid_email(self, client):
        register_user(client, "user@example.com", "secure123")

        resp = client.post("/api/auth/forgot-password", json={"identifier": "user@example.com"})
        assert resp.status_code == 200
        data = resp.json()
        assert "reset_token" in data
        assert data["reset_token"] != "account-not-found"
        assert len(data["reset_token"]) == 64  # 32 bytes hex

    def test_forgot_password_with_unknown_email_returns_200(self, client):
        # Should not leak whether the account exists
        resp = client.post("/api/auth/forgot-password", json={"identifier": "notexist@example.com"})
        assert resp.status_code == 200
        data = resp.json()
        assert "reset_token" in data
        # Indicates no real token was generated
        assert data["reset_token"] == "account-not-found"

    def test_forgot_password_with_username(self, client):
        # Register a user — username not set via register, so test via email only here
        register_user(client, "user@example.com", "secure123")

        resp = client.post("/api/auth/forgot-password", json={"identifier": "user@example.com"})
        assert resp.status_code == 200
        assert resp.json()["reset_token"] != "account-not-found"

    def test_reset_password_with_valid_token(self, client):
        register_and_verify(client, "user@example.com", "secure123")

        # Get reset token
        forgot_resp = client.post("/api/auth/forgot-password", json={"identifier": "user@example.com"})
        reset_token = forgot_resp.json()["reset_token"]

        # Reset with new valid password
        resp = client.post(
            "/api/auth/reset-password",
            json={"token": reset_token, "new_password": "newSecure99"},
        )
        assert resp.status_code == 200
        assert "成功" in resp.json()["message"]

        # Can login with new password (email already verified)
        login_resp = client.post("/api/auth/login", json={"email": "user@example.com", "password": "newSecure99"})
        assert login_resp.status_code == 200

    def test_reset_password_with_invalid_token_fails(self, client):
        resp = client.post(
            "/api/auth/reset-password",
            json={"token": "invalidtoken", "new_password": "newSecure99"},
        )
        assert resp.status_code == 400

    def test_reset_password_token_is_invalidated_after_use(self, client):
        register_user(client, "user@example.com", "secure123")

        forgot_resp = client.post("/api/auth/forgot-password", json={"identifier": "user@example.com"})
        reset_token = forgot_resp.json()["reset_token"]

        # First reset succeeds
        client.post(
            "/api/auth/reset-password",
            json={"token": reset_token, "new_password": "newSecure99"},
        )

        # Second reset with same token fails
        resp = client.post(
            "/api/auth/reset-password",
            json={"token": reset_token, "new_password": "anotherPass1"},
        )
        assert resp.status_code == 400

    def test_reset_password_with_weak_password_fails(self, client):
        register_user(client, "user@example.com", "secure123")

        forgot_resp = client.post("/api/auth/forgot-password", json={"identifier": "user@example.com"})
        reset_token = forgot_resp.json()["reset_token"]

        resp = client.post(
            "/api/auth/reset-password",
            json={"token": reset_token, "new_password": "weak"},
        )
        assert resp.status_code == 422


# Integration tests: verify-email endpoint

class TestVerifyEmail:

    def _set_verification_token(self, client: TestClient, email: str, token: str):
        """Helper: directly set email_verification_token in DB via SQL."""
        db = TestingSessionLocal()
        try:
            from app.models.user import User
            user = db.query(User).filter(User.email == email).first()
            assert user is not None
            user.email_verified = False
            user.email_verification_token = token
            db.commit()
        finally:
            db.close()

    def test_verify_email_with_valid_token(self, client):
        register_user(client, "user@example.com", "secure123")
        self._set_verification_token(client, "user@example.com", "valid-token-abc")

        resp = client.post("/api/auth/verify-email", json={"token": "valid-token-abc"})
        assert resp.status_code == 200
        assert "成功" in resp.json()["message"]

    def test_verify_email_with_invalid_token_fails(self, client):
        resp = client.post("/api/auth/verify-email", json={"token": "bogus-token"})
        assert resp.status_code == 400

    def test_verify_email_already_verified_returns_200(self, client):
        register_user(client, "user@example.com", "secure123")
        # Register auto-verifies; set a token anyway and verify again
        self._set_verification_token(client, "user@example.com", "some-token")

        db = TestingSessionLocal()
        try:
            from app.models.user import User
            user = db.query(User).filter(User.email == "user@example.com").first()
            user.email_verified = True  # pre-verified
            db.commit()
        finally:
            db.close()

        resp = client.post("/api/auth/verify-email", json={"token": "some-token"})
        assert resp.status_code == 200
