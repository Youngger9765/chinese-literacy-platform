"""
Security regression tests for auth token response gating (issue #1239).

Verifies that reset_token and verification_token are NEVER returned in
production-environment responses, and ARE returned in dev/preview.

Attack vector being blocked: POST /auth/forgot-password with any email
→ read reset_token from response body → POST /auth/reset-password → takeover.
No email access required.

Run with:
    cd backend
    python -m pytest tests/test_auth_token_gate.py -v
"""

import os
import sys
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.auth.password import hash_password

# ---------------------------------------------------------------------------
# In-memory SQLite test DB
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


@pytest.fixture(autouse=True)
def reset_rate_limiters():
    from app.routes.auth import rate_limiter
    rate_limiter.reset()
    try:
        from app.auth.rate_limiter import general_rate_limiter
        general_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _unique_email() -> str:
    return f"tokengate-{uuid.uuid4().hex[:8]}@example.com"


def _create_teacher_with_password(email: str, password: str = "SecurePass123!") -> None:
    """Insert a teacher user directly (bypass student-block in register endpoint)."""
    db = TestingSessionLocal()
    try:
        user = User(
            email=email,
            password_hash=hash_password(password),
            name="Test Teacher",
            email_verified=False,
            email_verification_token="initial-token",
        )
        db.add(user)
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Tests: PRODUCTION environment — tokens must be null
# ---------------------------------------------------------------------------


class TestTokenGateProduction:
    """ENVIRONMENT=production → all token fields must be null in responses."""

    def _client(self, monkeypatch) -> TestClient:
        monkeypatch.setenv("ENVIRONMENT", "production")
        # Invalidate cached is_dev property by patching settings directly
        from app import config
        # Reload the is_dev property via monkeypatching os.environ
        # (settings.is_dev reads os.environ at call time, so env change is enough)
        return TestClient(app)

    def test_forgot_password_no_token_in_prod(self, monkeypatch):
        """POST /auth/forgot-password must NOT return reset_token in production."""
        monkeypatch.setenv("ENVIRONMENT", "production")
        email = _unique_email()
        _create_teacher_with_password(email)

        client = TestClient(app)
        resp = client.post("/api/auth/forgot-password", json={"identifier": email})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        # The field may be present but MUST be null
        assert body.get("reset_token") is None, (
            f"SECURITY: reset_token must be null in production, got: {body.get('reset_token')!r}"
        )

    def test_forgot_password_unknown_email_no_token_in_prod(self, monkeypatch):
        """Unknown email path also must not leak a token sentinel in production."""
        monkeypatch.setenv("ENVIRONMENT", "production")
        client = TestClient(app)
        resp = client.post("/api/auth/forgot-password", json={"identifier": "noexist@example.com"})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body.get("reset_token") is None, (
            f"SECURITY: reset_token must be null in production (unknown email path), got: {body.get('reset_token')!r}"
        )

    def test_resend_verification_no_token_in_prod(self, monkeypatch):
        """POST /auth/resend-verification must NOT return verification_token in production."""
        monkeypatch.setenv("ENVIRONMENT", "production")
        email = _unique_email()
        _create_teacher_with_password(email)  # email_verified=False already

        client = TestClient(app)
        resp = client.post("/api/auth/resend-verification", json={"email": email})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body.get("verification_token") is None, (
            f"SECURITY: verification_token must be null in production, got: {body.get('verification_token')!r}"
        )

    def test_register_no_verification_token_in_prod(self, monkeypatch):
        """POST /auth/register with require_email_verification=True must not return token in production."""
        monkeypatch.setenv("ENVIRONMENT", "production")
        # Temporarily enable email verification requirement
        from app import config
        original = config.settings.require_email_verification
        config.settings.require_email_verification = True

        try:
            email = _unique_email()
            client = TestClient(app)
            resp = client.post("/api/auth/register", json={
                "email": email,
                "password": "SecurePass123!",
                "name": "Test User",
            })
            assert resp.status_code in (200, 201), resp.text
            body = resp.json()
            assert body.get("verification_token") is None, (
                f"SECURITY: verification_token must be null in production, got: {body.get('verification_token')!r}"
            )
        finally:
            config.settings.require_email_verification = original


# ---------------------------------------------------------------------------
# Tests: DEV environment — tokens should be present (internal testing flow)
# ---------------------------------------------------------------------------


class TestTokenGateDev:
    """ENVIRONMENT=development → token fields should be returned for internal testing."""

    def test_forgot_password_returns_token_in_dev(self, monkeypatch):
        """POST /auth/forgot-password SHOULD return reset_token in dev environment."""
        monkeypatch.setenv("ENVIRONMENT", "development")
        email = _unique_email()
        _create_teacher_with_password(email)

        client = TestClient(app)
        resp = client.post("/api/auth/forgot-password", json={"identifier": email})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        token = body.get("reset_token")
        assert token is not None and token != "", (
            f"Dev environment should return reset_token, got: {token!r}"
        )
        # Confirm the token is a hex string (64 chars for 32-byte token)
        assert len(token) == 64, f"Expected 64-char hex token, got length {len(token)}"

    def test_resend_verification_returns_token_in_dev(self, monkeypatch):
        """POST /auth/resend-verification SHOULD return verification_token in dev."""
        monkeypatch.setenv("ENVIRONMENT", "development")
        email = _unique_email()
        _create_teacher_with_password(email)  # email_verified=False

        client = TestClient(app)
        resp = client.post("/api/auth/resend-verification", json={"email": email})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        token = body.get("verification_token")
        assert token is not None and token != "", (
            f"Dev environment should return verification_token, got: {token!r}"
        )

    def test_register_returns_verification_token_in_dev(self, monkeypatch):
        """POST /auth/register with verification enabled SHOULD return token in dev."""
        monkeypatch.setenv("ENVIRONMENT", "development")
        from app import config
        original = config.settings.require_email_verification
        config.settings.require_email_verification = True

        try:
            email = _unique_email()
            client = TestClient(app)
            resp = client.post("/api/auth/register", json={
                "email": email,
                "password": "SecurePass123!",
                "name": "Dev Test User",
            })
            assert resp.status_code in (200, 201), resp.text
            body = resp.json()
            token = body.get("verification_token")
            assert token is not None and token != "", (
                f"Dev environment should return verification_token, got: {token!r}"
            )
        finally:
            config.settings.require_email_verification = original

    def test_preview_env_also_returns_token(self, monkeypatch):
        """ENVIRONMENT=preview (PR preview deploys) also gets tokens for QA testing."""
        monkeypatch.setenv("ENVIRONMENT", "preview")
        email = _unique_email()
        _create_teacher_with_password(email)

        client = TestClient(app)
        resp = client.post("/api/auth/forgot-password", json={"identifier": email})

        assert resp.status_code == 200, resp.text
        body = resp.json()
        token = body.get("reset_token")
        assert token is not None and token != "", (
            f"Preview environment should return reset_token for QA testing, got: {token!r}"
        )


# ---------------------------------------------------------------------------
# Tests: settings.is_dev unit tests
# ---------------------------------------------------------------------------


class TestSettingsIsDev:
    """Unit tests for the is_dev property on Settings."""

    def test_is_dev_true_for_development(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "development")
        from app.config import Settings
        s = Settings()
        assert s.is_dev is True

    def test_is_dev_true_for_preview(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "preview")
        from app.config import Settings
        s = Settings()
        assert s.is_dev is True

    def test_is_dev_false_for_production(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "production")
        from app.config import Settings
        s = Settings()
        assert s.is_dev is False

    def test_is_dev_false_for_staging(self, monkeypatch):
        """Staging is NOT in the dev set — staging tokens should also be gated."""
        monkeypatch.setenv("ENVIRONMENT", "staging")
        from app.config import Settings
        s = Settings()
        assert s.is_dev is False

    def test_is_dev_true_when_local_no_env_no_k_service(self, monkeypatch):
        """No ENVIRONMENT + no K_SERVICE → local dev (is_dev=True)."""
        monkeypatch.delenv("ENVIRONMENT", raising=False)
        monkeypatch.delenv("K_SERVICE", raising=False)
        from app.config import Settings
        s = Settings()
        assert s.is_dev is True

    def test_is_dev_false_when_cloud_run_no_environment(self, monkeypatch):
        """K_SERVICE set (Cloud Run) without ENVIRONMENT → fail-safe to prod (is_dev=False).

        This guards against deploy workflows forgetting to set ENVIRONMENT.
        Before fix: is_dev defaulted to True → reset/verification tokens leaked
        in prod responses. After fix: missing ENVIRONMENT on Cloud Run = prod.
        """
        monkeypatch.delenv("ENVIRONMENT", raising=False)
        monkeypatch.setenv("K_SERVICE", "lingoleap-backend")
        from app.config import Settings
        s = Settings()
        assert s.is_dev is False

    def test_is_dev_false_for_unknown_env_on_cloud_run(self, monkeypatch):
        """Unknown ENVIRONMENT value on Cloud Run → fail-safe to prod."""
        monkeypatch.setenv("ENVIRONMENT", "canary")
        monkeypatch.setenv("K_SERVICE", "lingoleap-backend")
        from app.config import Settings
        s = Settings()
        assert s.is_dev is False
