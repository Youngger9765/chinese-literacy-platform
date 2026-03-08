"""
Tests for privacy policy endpoints.

Covers:
- GET  /api/privacy/policy       — public, returns structured policy JSON
- POST /api/privacy/accept       — requires auth, records acceptance timestamp
- GET  /api/privacy/consent-status — requires auth, reports acceptance state

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /path/to/backend
    python -m pytest tests/test_privacy_api.py -v
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
from app.models.user import Role, UserRole
from app.models.school import School
from app.models.organization import Organization
from app.auth.password import hash_password
from app.models.user import User


# ---------------------------------------------------------------------------
# In-memory SQLite test DB setup
# ---------------------------------------------------------------------------

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
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


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    # Seed roles
    student_role = Role(name="student", display_name="學生", scope_level="school")
    db.add(student_role)
    db.flush()

    # Seed test user
    user = User(
        email="student_priv@test.com",
        password_hash=hash_password("test12345"),
        name="隱私測試生",
        is_active=True,
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role_id=student_role.id, scope_type="platform"))
    db.commit()
    db.close()

    yield

    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


@pytest.fixture(scope="module")
def auth_token(client):
    resp = client.post("/api/auth/login", json={"email": "student_priv@test.com", "password": "test12345"})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


# ---------------------------------------------------------------------------
# Tests: GET /api/privacy/policy  (public)
# ---------------------------------------------------------------------------

class TestGetPrivacyPolicy:
    def test_returns_200_without_auth(self, client):
        resp = client.get("/api/privacy/policy")
        assert resp.status_code == 200

    def test_response_has_required_top_level_fields(self, client):
        resp = client.get("/api/privacy/policy")
        data = resp.json()
        assert "version" in data
        assert "effective_date" in data
        assert "language" in data
        assert "sections" in data
        assert data["language"] == "zh-TW"

    def test_all_required_sections_present(self, client):
        resp = client.get("/api/privacy/policy")
        sections = resp.json()["sections"]
        required = {"data_collection", "audio_data", "data_retention", "data_deletion", "children_privacy"}
        assert required.issubset(sections.keys())

    def test_audio_data_section_mentions_web_speech_api(self, client):
        resp = client.get("/api/privacy/policy")
        audio_content = resp.json()["sections"]["audio_data"]["content"]
        assert "Web Speech API" in audio_content

    def test_audio_data_section_clarifies_no_server_upload(self, client):
        resp = client.get("/api/privacy/policy")
        audio_content = resp.json()["sections"]["audio_data"]["content"]
        # Key claim: audio files are NOT uploaded to the server
        assert "不會上傳" in audio_content or "不上傳" in audio_content

    def test_each_section_has_title_and_content(self, client):
        resp = client.get("/api/privacy/policy")
        for key, section in resp.json()["sections"].items():
            assert "title" in section, f"Section '{key}' missing title"
            assert "content" in section, f"Section '{key}' missing content"
            assert len(section["content"]) > 20, f"Section '{key}' content too short"


# ---------------------------------------------------------------------------
# Tests: POST /api/privacy/accept  (auth required)
# ---------------------------------------------------------------------------

class TestAcceptPrivacyPolicy:
    def test_requires_auth(self, client):
        resp = client.post("/api/privacy/accept")
        assert resp.status_code == 401

    def test_accept_returns_200_with_accepted_at(self, client, auth_headers):
        resp = client.post("/api/privacy/accept", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "accepted_at" in data
        assert data["accepted_at"] is not None
        assert "policy_version" in data

    def test_accept_is_idempotent(self, client, auth_headers):
        """Calling accept multiple times should not fail."""
        resp1 = client.post("/api/privacy/accept", headers=auth_headers)
        resp2 = client.post("/api/privacy/accept", headers=auth_headers)
        assert resp1.status_code == 200
        assert resp2.status_code == 200


# ---------------------------------------------------------------------------
# Tests: GET /api/privacy/consent-status  (auth required)
# ---------------------------------------------------------------------------

class TestConsentStatus:
    def test_requires_auth(self, client):
        resp = client.get("/api/privacy/consent-status")
        assert resp.status_code == 401

    def test_after_accept_has_accepted_is_true(self, client, auth_headers):
        # Ensure accepted first
        client.post("/api/privacy/accept", headers=auth_headers)
        resp = client.get("/api/privacy/consent-status", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_accepted"] is True
        assert data["accepted_at"] is not None

    def test_consent_status_includes_policy_version(self, client, auth_headers):
        resp = client.get("/api/privacy/consent-status", headers=auth_headers)
        assert "current_policy_version" in resp.json()
