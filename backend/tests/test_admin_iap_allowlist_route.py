"""
Tests for GET /api/admin/iap-allowlist (Issue #3720).

Covers:
- 403 for a non-admin (teacher) — lowest-privilege authz test
- 200 for system_admin — positive control for the same check
- 200 "not configured" state when IAP_ALLOWLIST_SERVICES is unset (the
  expected state today, per #3719 — IAP hasn't been turned on yet)
- 200 "not configured" state when GCP itself denies the read (403/other),
  surfaced the same friendly way instead of a 500

Uses SQLite in-memory DB, same pattern as test_report_export.py /
test_admin_api.py.
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
from app.models.user import Role, UserRole
from app.services import gcp_iap_client

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
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
]


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
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()
    session.close()

    from app.routes.auth import rate_limiter
    rate_limiter.reset()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{suffix.title()} {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]
    return {"token": token, "user_id": user_id, "email": email}


def _make_admin(user_id: int):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "system_admin").first()
    db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="platform", scope_id=None))
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "iap_teacher")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "iap_admin")
    _make_admin(user["user_id"])
    return user


# ---------------------------------------------------------------------------
# Authz: lowest-privilege 403 + positive control 200
# ---------------------------------------------------------------------------


def test_non_admin_gets_403(client, teacher):
    resp = client.get("/api/admin/iap-allowlist", headers=auth_header(teacher["token"]))
    assert resp.status_code == 403


def test_unauthenticated_gets_401(client):
    resp = client.get("/api/admin/iap-allowlist")
    assert resp.status_code == 401


def test_admin_gets_200(client, admin_user, monkeypatch):
    monkeypatch.setattr(gcp_iap_client, "IAP_ALLOWLIST_SERVICES", [])
    resp = client.get("/api/admin/iap-allowlist", headers=auth_header(admin_user["token"]))
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Behaviour: not-configured state (expected today) vs GCP error vs success
# ---------------------------------------------------------------------------


def test_returns_not_configured_when_no_services_set(client, admin_user, monkeypatch):
    monkeypatch.setattr(gcp_iap_client, "IAP_ALLOWLIST_SERVICES", [])
    resp = client.get("/api/admin/iap-allowlist", headers=auth_header(admin_user["token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is False
    assert "尚未設定 IAP" in body["message"]


def test_returns_not_configured_when_gcp_denies_permission(client, admin_user, monkeypatch):
    monkeypatch.setattr(gcp_iap_client, "IAP_ALLOWLIST_SERVICES", ["lingoleap-frontend-staging"])

    def _raise(*args, **kwargs):
        raise gcp_iap_client.IapFetchError("permission_denied", "roles/iap.admin not granted")

    monkeypatch.setattr(gcp_iap_client, "fetch_iap_policies", _raise)
    resp = client.get("/api/admin/iap-allowlist", headers=auth_header(admin_user["token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is False
    assert "尚未設定 IAP" in body["message"]


def test_returns_parsed_allowlist_when_gcp_succeeds(client, admin_user, monkeypatch):
    monkeypatch.setattr(gcp_iap_client, "IAP_ALLOWLIST_SERVICES", ["lingoleap-frontend-staging"])
    policy = {
        "bindings": [
            {
                "role": "roles/iap.httpsResourceAccessor",
                "members": ["user:hans@example.com"],
                "condition": {
                    "title": "Hans 劉燁",
                    "expression": 'request.time < timestamp("2099-01-01T00:00:00Z")',
                },
            },
            {
                "role": "roles/iap.httpsResourceAccessor",
                "members": ["domain:junyiacademy.org"],
            },
        ]
    }
    monkeypatch.setattr(gcp_iap_client, "fetch_iap_policies", lambda: [policy])
    resp = client.get("/api/admin/iap-allowlist", headers=auth_header(admin_user["token"]))
    assert resp.status_code == 200
    body = resp.json()
    assert body["configured"] is True
    assert body["junyi_domain_active"] is True
    assert body["external_grants"] == [
        {
            "email": "hans@example.com",
            "name": "Hans 劉燁",
            "status": "active",
            "expires_at": "2099-01-01T00:00:00+00:00",
        }
    ]
