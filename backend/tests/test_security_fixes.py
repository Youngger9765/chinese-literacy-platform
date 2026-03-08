"""
Tests for security fixes from Issue #286.

Covers:
- Comprehension endpoints return 401 without auth token (HIGH-4)
- Comprehension endpoints work with a valid auth token
- JWT expiry is 480 minutes / 8 hours (HIGH-1)

Run with:
    cd backend
    python -m pytest tests/test_security_fixes.py -v
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
from app.models.user import Role, UserRole
from app.config import settings


# ---------------------------------------------------------------------------
# Test database setup (isolated in-memory SQLite)
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
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
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


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_and_login(client) -> str:
    """Register a user and return the access token."""
    import uuid
    unique = uuid.uuid4().hex[:8]
    resp = client.post("/api/auth/register", json={
        "email": f"security_test_{unique}@example.com",
        "password": "SecurePass123!",
        "name": f"Security Test {unique}",
    })
    assert resp.status_code == 201, f"Register failed: {resp.text}"
    return resp.json()["access_token"]


# ---------------------------------------------------------------------------
# Test payload helpers
# ---------------------------------------------------------------------------

_COMPREHENSION_QUESTION_PAYLOAD = {
    "story_title": "測試故事",
    "story_text": "從前有一隻小白兔，牠住在山上的森林裡。",
    "conversation": [],
}

_COMPREHENSION_CHAT_PAYLOAD = {
    "session_id": "test-session-security-001",
    "story_title": "測試故事",
    "story_text": "從前有一隻小白兔，牠住在山上的森林裡。",
    "student_answer": None,
}


# ---------------------------------------------------------------------------
# HIGH-4: Authentication required on comprehension endpoints
# ---------------------------------------------------------------------------


class TestComprehensionAuth:
    """Comprehension endpoints must require authentication."""

    def test_question_endpoint_returns_401_without_token(self, client):
        """POST /api/comprehension/question must return 401 when no token provided."""
        resp = client.post(
            "/api/comprehension/question",
            json=_COMPREHENSION_QUESTION_PAYLOAD,
        )
        assert resp.status_code == 401, (
            f"Expected 401 Unauthorized but got {resp.status_code}. "
            "Comprehension question endpoint must require authentication."
        )

    def test_chat_endpoint_returns_401_without_token(self, client):
        """POST /api/comprehension/chat must return 401 when no token provided."""
        resp = client.post(
            "/api/comprehension/chat",
            json=_COMPREHENSION_CHAT_PAYLOAD,
        )
        assert resp.status_code == 401, (
            f"Expected 401 Unauthorized but got {resp.status_code}. "
            "Comprehension chat endpoint must require authentication."
        )

    def test_question_endpoint_returns_401_with_invalid_token(self, client):
        """POST /api/comprehension/question must return 401 with invalid token."""
        resp = client.post(
            "/api/comprehension/question",
            json=_COMPREHENSION_QUESTION_PAYLOAD,
            headers={"Authorization": "Bearer invalid-token-xyz"},
        )
        assert resp.status_code == 401, (
            f"Expected 401 Unauthorized but got {resp.status_code}."
        )

    def test_chat_endpoint_returns_401_with_invalid_token(self, client):
        """POST /api/comprehension/chat must return 401 with invalid token."""
        resp = client.post(
            "/api/comprehension/chat",
            json=_COMPREHENSION_CHAT_PAYLOAD,
            headers={"Authorization": "Bearer invalid-token-xyz"},
        )
        assert resp.status_code == 401, (
            f"Expected 401 Unauthorized but got {resp.status_code}."
        )

    def test_question_endpoint_accepts_valid_token(self, client):
        """POST /api/comprehension/question must accept authenticated requests.

        Returns 200 or a downstream error (e.g. 503 when Vertex AI is unavailable
        in the test environment) — but NOT 401 or 403.
        """
        token = _register_and_login(client)
        resp = client.post(
            "/api/comprehension/question",
            json=_COMPREHENSION_QUESTION_PAYLOAD,
            headers=_auth_header(token),
        )
        # 401/403 = auth failure; anything else (200, 503, 500) = auth passed
        assert resp.status_code not in (401, 403), (
            f"Authenticated request to comprehension/question returned {resp.status_code}. "
            "Auth should pass even if AI service is unavailable."
        )

    def test_chat_endpoint_accepts_valid_token(self, client):
        """POST /api/comprehension/chat must accept authenticated requests.

        Returns 200 or a downstream error (e.g. 503 when Vertex AI is unavailable
        in the test environment) — but NOT 401 or 403.
        """
        token = _register_and_login(client)
        resp = client.post(
            "/api/comprehension/chat",
            json=_COMPREHENSION_CHAT_PAYLOAD,
            headers=_auth_header(token),
        )
        assert resp.status_code not in (401, 403), (
            f"Authenticated request to comprehension/chat returned {resp.status_code}. "
            "Auth should pass even if AI service is unavailable."
        )


# ---------------------------------------------------------------------------
# HIGH-1: JWT expiry is 8 hours (480 minutes)
# ---------------------------------------------------------------------------


class TestJWTExpiry:
    """JWT tokens should expire after 8 hours, not 24."""

    def test_jwt_expire_minutes_is_480(self):
        """Settings.jwt_expire_minutes must be 480 (8 hours)."""
        assert settings.jwt_expire_minutes == 480, (
            f"Expected JWT expiry of 480 minutes (8 hours), "
            f"got {settings.jwt_expire_minutes} minutes. "
            "Long-lived tokens are a security risk."
        )

    def test_jwt_expire_minutes_is_not_24_hours(self):
        """Settings.jwt_expire_minutes must not be 1440 (24 hours)."""
        assert settings.jwt_expire_minutes != 1440, (
            "JWT expiry is still 1440 minutes (24 hours). "
            "This must be reduced to 480 minutes (8 hours)."
        )

    def test_login_token_claims_correct_expiry(self, client):
        """Issued JWT tokens should have an expiry around 8 hours from now."""
        import time
        import base64
        import json

        token = _register_and_login(client)

        # Decode the JWT payload (without verification — just inspecting claims)
        parts = token.split(".")
        assert len(parts) == 3, "Token does not look like a JWT"

        # Pad base64 if needed
        payload_b64 = parts[1] + "=="
        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        payload = json.loads(payload_bytes)

        assert "exp" in payload, "JWT missing 'exp' claim"
        assert "iat" in payload, "JWT missing 'iat' claim"

        issued_at = payload["iat"]
        expires_at = payload["exp"]
        token_lifetime_minutes = (expires_at - issued_at) / 60

        # Allow ±5 minute tolerance for clock skew / test execution time
        assert abs(token_lifetime_minutes - 480) <= 5, (
            f"JWT lifetime is {token_lifetime_minutes:.1f} minutes, "
            f"expected ~480 minutes (8 hours). "
            f"iat={issued_at}, exp={expires_at}"
        )


# ---------------------------------------------------------------------------
# Additional: story_text max_length validation
# ---------------------------------------------------------------------------


class TestInputValidation:
    """Input validation on comprehension endpoints."""

    def test_story_text_max_length_enforced(self, client):
        """story_text over 10000 chars should return 422 Unprocessable Entity."""
        token = _register_and_login(client)
        oversized_payload = {
            "story_title": "長文測試",
            "story_text": "A" * 10001,
            "conversation": [],
        }
        resp = client.post(
            "/api/comprehension/question",
            json=oversized_payload,
            headers=_auth_header(token),
        )
        assert resp.status_code == 422, (
            f"Expected 422 for oversized story_text, got {resp.status_code}. "
            "Input validation should reject excessively long story_text."
        )

    def test_story_text_at_max_length_accepted(self, client):
        """story_text at exactly 10000 chars should not fail due to length."""
        token = _register_and_login(client)
        max_length_payload = {
            "story_title": "長文測試",
            "story_text": "A" * 10000,
            "conversation": [],
        }
        resp = client.post(
            "/api/comprehension/question",
            json=max_length_payload,
            headers=_auth_header(token),
        )
        # Should not be rejected for length (may fail for AI unavailability)
        assert resp.status_code != 422, (
            f"story_text at exactly 10000 chars was rejected with 422. "
            "Max length boundary should be inclusive."
        )
