"""
TDD tests for Google OAuth endpoint: POST /api/auth/google

Tests use unittest.mock to patch google.oauth2.id_token.verify_oauth2_token
so no real Google credentials are needed.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-27/backend
    python -m pytest tests/test_google_oauth.py -v
"""

import sys
import os
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import User
from app.auth.password import hash_password

# ---------------------------------------------------------------------------
# In-memory SQLite test database setup
# ---------------------------------------------------------------------------
SQLALCHEMY_TEST_URL = "sqlite://"

engine = create_engine(
    SQLALCHEMY_TEST_URL,
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


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FAKE_GOOGLE_CLIENT_ID = "fake-client-id.apps.googleusercontent.com"
FAKE_CREDENTIAL = "fake.jwt.credential"

FAKE_ID_INFO = {
    "sub": "google-uid-12345",
    "email": "newuser@gmail.com",
    "name": "New User",
    "picture": "https://lh3.googleusercontent.com/photo.jpg",
}


def mock_verify(credential, request, client_id):
    """Simulates a successful Google token verification."""
    return FAKE_ID_INFO


def patch_google(monkeypatch):
    """Patch settings.google_client_id and Google verify function."""
    monkeypatch.setattr("app.config.settings.google_client_id", FAKE_GOOGLE_CLIENT_ID)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGoogleLoginNewUser:
    """New Google user — should create account and return token."""

    def test_creates_new_user_returns_token(self, client, monkeypatch):
        patch_google(monkeypatch)
        # The endpoint imports google.oauth2.id_token inside the function body,
        # so we patch the module-level path used at runtime.
        with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=mock_verify):
            response = client.post(
                "/api/auth/google",
                json={"credential": FAKE_CREDENTIAL},
            )

        assert response.status_code == 200, response.text
        data = response.json()
        assert "access_token" in data
        assert data["is_new_user"] is True

    def test_user_stored_in_db(self, client, monkeypatch):
        patch_google(monkeypatch)
        with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=mock_verify):
            client.post("/api/auth/google", json={"credential": FAKE_CREDENTIAL})

        db = TestingSessionLocal()
        user = db.query(User).filter(User.email == FAKE_ID_INFO["email"]).first()
        db.close()

        assert user is not None
        assert user.google_id == FAKE_ID_INFO["sub"]
        assert user.email_verified is True
        assert user.avatar_url == FAKE_ID_INFO["picture"]

    def test_email_verified_true_for_new_user(self, client, monkeypatch):
        patch_google(monkeypatch)
        with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=mock_verify):
            client.post("/api/auth/google", json={"credential": FAKE_CREDENTIAL})

        db = TestingSessionLocal()
        user = db.query(User).filter(User.email == FAKE_ID_INFO["email"]).first()
        db.close()
        assert user.email_verified is True


class TestGoogleLoginExistingEmailUser:
    """Existing user registered with email — Google account should be linked."""

    def _create_existing_user(self):
        db = TestingSessionLocal()
        user = User(
            email=FAKE_ID_INFO["email"],
            password_hash=hash_password("SomePassword123"),
            name="Existing User",
            email_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        db.close()
        return user

    def test_links_google_id_to_existing_account(self, client, monkeypatch):
        self._create_existing_user()
        patch_google(monkeypatch)

        with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=mock_verify):
            response = client.post("/api/auth/google", json={"credential": FAKE_CREDENTIAL})

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["is_new_user"] is False

        db = TestingSessionLocal()
        user = db.query(User).filter(User.email == FAKE_ID_INFO["email"]).first()
        db.close()
        assert user.google_id == FAKE_ID_INFO["sub"]

    def test_does_not_create_duplicate_user(self, client, monkeypatch):
        self._create_existing_user()
        patch_google(monkeypatch)

        with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=mock_verify):
            client.post("/api/auth/google", json={"credential": FAKE_CREDENTIAL})

        db = TestingSessionLocal()
        count = db.query(User).filter(User.email == FAKE_ID_INFO["email"]).count()
        db.close()
        assert count == 1


class TestGoogleLoginReturningUser:
    """User already has google_id — should login directly."""

    def _create_google_user(self):
        db = TestingSessionLocal()
        user = User(
            email=FAKE_ID_INFO["email"],
            password_hash=hash_password("unused"),
            name="Google User",
            google_id=FAKE_ID_INFO["sub"],
            email_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        db.close()

    def test_returning_user_gets_token(self, client, monkeypatch):
        self._create_google_user()
        patch_google(monkeypatch)

        with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=mock_verify):
            response = client.post("/api/auth/google", json={"credential": FAKE_CREDENTIAL})

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["is_new_user"] is False


class TestGoogleLoginErrorCases:
    """Error handling for invalid credentials and misconfiguration."""

    def test_returns_503_when_client_id_not_configured(self, client, monkeypatch):
        monkeypatch.setattr("app.config.settings.google_client_id", "")
        response = client.post("/api/auth/google", json={"credential": FAKE_CREDENTIAL})
        assert response.status_code == 503

    def test_returns_401_on_invalid_google_token(self, client, monkeypatch):
        patch_google(monkeypatch)

        def bad_verify(credential, request, client_id):
            raise ValueError("Token signature is invalid.")

        with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=bad_verify):
            response = client.post("/api/auth/google", json={"credential": "bad.token"})

        assert response.status_code == 401

    def test_returns_400_on_missing_email(self, client, monkeypatch):
        patch_google(monkeypatch)

        def no_email_verify(credential, request, client_id):
            return {"sub": "uid-999", "name": "No Email"}

        with patch("google.oauth2.id_token.verify_oauth2_token", side_effect=no_email_verify):
            response = client.post("/api/auth/google", json={"credential": FAKE_CREDENTIAL})

        assert response.status_code == 400
