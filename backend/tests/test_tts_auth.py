"""
TDD tests for TTS endpoint authentication (Issue #1240).

Covers:
- POST /api/tts/synthesize  → 401 without token, 200 with valid token
- POST /api/tts/synthesize-sentence → 401 without token, 200 with valid token
- POST /api/tts/regenerate  → 401 without token, 403 for non-admin, 200 for system_admin

Run:
    cd /path/to/chinese-literacy-platform/backend
    pytest tests/test_tts_auth.py -v
"""
import sys
import os
import uuid
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole

# ---------------------------------------------------------------------------
# Test DB (SQLite in-memory)
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


def _assign_role(email: str, role_name: str) -> None:
    # Map role name to the correct scope_type (UserRole.scope_type is NOT NULL)
    scope_type_map = {
        "system_admin": "platform",
        "org_admin": "organization",
        "principal": "school",
        "director": "school",
        "teacher": "school",
        "homeroom_teacher": "school",
        "student": "school",
        "parent": "school",
    }
    scope_type = scope_type_map.get(role_name, "platform")

    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        role = db.query(Role).filter(Role.name == role_name).first()
        existing = db.query(UserRole).filter(
            UserRole.user_id == user.id,
            UserRole.role_id == role.id,
            UserRole.is_active == True,
        ).first()
        if not existing:
            db.add(UserRole(
                user_id=user.id,
                role_id=role.id,
                is_active=True,
                scope_type=scope_type,
            ))
            db.commit()
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


def _register_and_login(client) -> dict:
    """Register a fresh user and return {'email', 'token'}."""
    unique = uuid.uuid4().hex[:8]
    email = f"ttstest_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"TTS Test {unique}",
    })
    assert resp.status_code == 201, resp.text

    verification_token = resp.json().get("verification_token")
    if verification_token is not None:
        client.get(f"/api/auth/verify-email?token={verification_token}")

    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]
    return {"email": email, "token": token}


@pytest.fixture(scope="module")
def regular_user(client):
    return _register_and_login(client)


@pytest.fixture(scope="module")
def admin_user(client):
    user_info = _register_and_login(client)
    _assign_role(user_info["email"], "system_admin")
    return user_info


# ---------------------------------------------------------------------------
# Helper: fake TTS so we don't hit Azure/GCP in tests
# ---------------------------------------------------------------------------

FAKE_AUDIO = b"FAKE_AUDIO_BYTES"


def _patch_tts():
    """Context manager that patches synthesize_speech and synthesize_sentence."""
    return patch.multiple(
        "app.routes.tts",
        synthesize_speech=MagicMock(return_value=FAKE_AUDIO),
        synthesize_sentence=MagicMock(return_value=FAKE_AUDIO),
    )


def _patch_regenerate():
    """Context manager that patches both delete_tts_cache and synthesize_speech for /regenerate."""
    delete_result = {
        "key": "abc123",
        "l1_deleted": True,
        "gcs_deleted": ["azure/sentences/abc123.mp3"],
    }
    return patch.multiple(
        "app.routes.tts",
        delete_tts_cache=MagicMock(return_value=delete_result),
        synthesize_speech=MagicMock(return_value=FAKE_AUDIO),
    )


# ===========================================================================
# Tests: POST /api/tts/synthesize
# ===========================================================================

class TestSynthesizeAuth:

    def test_unauthenticated_returns_401(self, client):
        """Anonymous request must be rejected with 401."""
        resp = client.post("/api/tts/synthesize", json={"text": "你好"})
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"

    def test_authenticated_returns_200(self, client, regular_user):
        """Authenticated user receives audio bytes."""
        with _patch_tts():
            resp = client.post(
                "/api/tts/synthesize",
                json={"text": "你好"},
                headers={"Authorization": f"Bearer {regular_user['token']}"},
            )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        assert resp.content == FAKE_AUDIO


# ===========================================================================
# Tests: POST /api/tts/synthesize-sentence
# ===========================================================================

class TestSynthesizeSentenceAuth:

    def test_unauthenticated_returns_401(self, client):
        """Anonymous request must be rejected with 401."""
        resp = client.post("/api/tts/synthesize-sentence", json={"text": "你好"})
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"

    def test_authenticated_returns_200(self, client, regular_user):
        """Authenticated user receives audio bytes."""
        with _patch_tts():
            resp = client.post(
                "/api/tts/synthesize-sentence",
                json={"text": "你好"},
                headers={"Authorization": f"Bearer {regular_user['token']}"},
            )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        assert resp.content == FAKE_AUDIO


# ===========================================================================
# Tests: POST /api/tts/regenerate
# ===========================================================================

class TestRegenerateAuth:

    def test_unauthenticated_returns_401(self, client):
        """Anonymous request must be rejected with 401."""
        resp = client.post("/api/tts/regenerate", json={"text": "你好"})
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"

    def test_non_admin_returns_403(self, client, regular_user):
        """Regular (non-admin) user must receive 403 Forbidden."""
        resp = client.post(
            "/api/tts/regenerate",
            json={"text": "你好"},
            headers={"Authorization": f"Bearer {regular_user['token']}"},
        )
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}: {resp.text}"

    def test_system_admin_returns_200(self, client, admin_user):
        """system_admin user can call /regenerate."""
        with _patch_regenerate():
            resp = client.post(
                "/api/tts/regenerate",
                json={"text": "你好"},
                headers={"Authorization": f"Bearer {admin_user['token']}"},
            )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data["status"] == "ok"
