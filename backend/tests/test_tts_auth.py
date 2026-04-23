"""
TDD tests for TTS endpoint auth (Issue #1234).

Covers:
- POST /api/tts/synthesize     → 401 when unauthenticated, 200 when authenticated
- POST /api/tts/synthesize-sentence → 401 when unauthenticated
- POST /api/tts/regenerate     → 401 when unauthenticated, 403 when non-admin, 200 when system_admin

Run with:
    cd /path/to/project/backend
    python -m pytest tests/test_tts_auth.py -v
"""

from __future__ import annotations

import sys
import os
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Set JWT secret before importing the app so auth works in tests
if not os.environ.get("JWT_SECRET_KEY"):
    os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-tts-auth-tests"

from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.auth.password import hash_password
from app.auth.jwt import create_access_token


# ---------------------------------------------------------------------------
# Test DB setup (SQLite in-memory)
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


def _seed_roles(db):
    for role_data in SEED_ROLES:
        if not db.query(Role).filter_by(name=role_data["name"]).first():
            db.add(Role(
                name=role_data["name"],
                display_name=role_data["display_name"],
                scope_level=role_data["scope_level"],
            ))
    db.commit()


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


def _create_user_with_role(db, role_name: str) -> tuple[User, str]:
    """Create a user, assign role, return (user, jwt_token)."""
    unique = uuid.uuid4().hex[:8]
    email = f"ttstest_{role_name}_{unique}@example.com"
    user = User(
        email=email,
        name=f"TTS Test {role_name}",
        password_hash=hash_password("TestPass123!"),
        is_active=True,
        email_verified=True,
    )
    db.add(user)
    db.flush()

    role = db.query(Role).filter_by(name=role_name).first()
    if role:
        scope_type = role.scope_level  # "platform", "organization", or "school"
        ur = UserRole(user_id=user.id, role_id=role.id, scope_type=scope_type, is_active=True)
        db.add(ur)

    db.commit()
    db.refresh(user)
    token = create_access_token(user_id=user.id)
    return user, token


@pytest.fixture(scope="module")
def student_token():
    db = TestingSessionLocal()
    try:
        _, token = _create_user_with_role(db, "student")
        return token
    finally:
        db.close()


@pytest.fixture(scope="module")
def admin_token():
    db = TestingSessionLocal()
    try:
        _, token = _create_user_with_role(db, "system_admin")
        return token
    finally:
        db.close()


FAKE_AUDIO = b"FAKE_MP3_AUDIO"


# ---------------------------------------------------------------------------
# Tests: /api/tts/synthesize
# ---------------------------------------------------------------------------


class TestSynthesizeAuth:
    """POST /api/tts/synthesize must require authentication."""

    def test_unauthenticated_returns_401(self, client):
        resp = client.post("/api/tts/synthesize", json={"text": "你好"})
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_no_bearer_prefix_returns_401(self, client):
        resp = client.post(
            "/api/tts/synthesize",
            json={"text": "你好"},
            headers={"Authorization": "notabearer"},
        )
        assert resp.status_code == 401

    @patch("app.routes.tts.synthesize_speech", return_value=FAKE_AUDIO)
    def test_authenticated_student_returns_200(self, mock_synth, client, student_token):
        resp = client.post(
            "/api/tts/synthesize",
            json={"text": "你好"},
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/mpeg"


# ---------------------------------------------------------------------------
# Tests: /api/tts/synthesize-sentence
# ---------------------------------------------------------------------------


class TestSynthesizeSentenceAuth:
    """POST /api/tts/synthesize-sentence must require authentication."""

    def test_unauthenticated_returns_401(self, client):
        resp = client.post("/api/tts/synthesize-sentence", json={"text": "你好"})
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    @patch("app.routes.tts.synthesize_sentence", return_value=FAKE_AUDIO)
    def test_authenticated_student_returns_200(self, mock_synth, client, student_token):
        resp = client.post(
            "/api/tts/synthesize-sentence",
            json={"text": "你好"},
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/mpeg"


# ---------------------------------------------------------------------------
# Tests: /api/tts/regenerate (system_admin only)
# ---------------------------------------------------------------------------


class TestRegenerateAuth:
    """POST /api/tts/regenerate must require system_admin role."""

    def test_unauthenticated_returns_401(self, client):
        resp = client.post("/api/tts/regenerate", json={"text": "你好"})
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_non_admin_returns_403(self, client, student_token):
        resp = client.post(
            "/api/tts/regenerate",
            json={"text": "你好"},
            headers={"Authorization": f"Bearer {student_token}"},
        )
        assert resp.status_code == 403, f"Expected 403 for non-admin, got {resp.status_code}"

    @patch("app.routes.tts.delete_tts_cache", return_value={
        "key": "abc123hash",
        "l1_deleted": True,
        "gcs_deleted": [],
    })
    @patch("app.routes.tts.synthesize_speech", return_value=FAKE_AUDIO)
    def test_system_admin_returns_200(self, mock_synth, mock_delete, client, admin_token):
        resp = client.post(
            "/api/tts/regenerate",
            json={"text": "你好"},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 200, f"Expected 200 for admin, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["status"] == "ok"
