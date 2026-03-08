"""
Tests for Organization business info fields (Issue #234).

Covers:
- Create org with all new business fields
- Update org with business info
- tax_id uniqueness among active orgs
- tax_id allowed if other org is inactive
- settings JSONB field
- All new fields nullable (create with name only)

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-234/backend
    python -m pytest tests/test_org_fields.py -v
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


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": "SecurePass123!",
        "name": f"{suffix.title()} {unique}",
    })
    assert resp.status_code == 201
    token = resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    return {
        "token": token,
        "user_id": me_resp.json()["id"],
        "email": email,
    }


def _make_admin(user_id: int):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "system_admin").first()
    user_role = UserRole(
        user_id=user_id,
        role_id=role.id,
        scope_type="platform",
        scope_id=None,
    )
    db.add(user_role)
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "orgfields_admin")
    _make_admin(user["user_id"])
    return user


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _unique_name() -> str:
    return f"TestOrg_{uuid.uuid4().hex[:8]}"


def _unique_tax_id() -> str:
    return uuid.uuid4().hex[:8].upper()


# ===========================================================================
# Tests
# ===========================================================================


class TestOrganizationBusinessFields:
    def test_create_org_with_business_info(self, client, admin_user):
        tax_id = _unique_tax_id()
        resp = client.post("/api/organizations", json={
            "name": _unique_name(),
            "display_name": "Test Display",
            "description": "A test organization description",
            "tax_id": tax_id,
            "contact_email": "contact@example.com",
            "contact_phone": "02-1234-5678",
            "address": "台北市中正區重慶南路一段122號",
            "settings": {"feature_x": True, "max_users": 100},
        }, headers=auth_header(admin_user["token"]))
        assert resp.status_code == 201
        data = resp.json()
        assert data["description"] == "A test organization description"
        assert data["tax_id"] == tax_id
        assert data["contact_email"] == "contact@example.com"
        assert data["contact_phone"] == "02-1234-5678"
        assert data["address"] == "台北市中正區重慶南路一段122號"
        assert data["settings"] == {"feature_x": True, "max_users": 100}

    def test_update_org_business_info(self, client, admin_user):
        name = _unique_name()
        create_resp = client.post("/api/organizations", json={"name": name},
                                  headers=auth_header(admin_user["token"]))
        assert create_resp.status_code == 201
        org_id = create_resp.json()["id"]

        resp = client.patch(f"/api/organizations/{org_id}", json={
            "description": "Updated description",
            "contact_email": "new@example.com",
            "contact_phone": "03-9876-5432",
        }, headers=auth_header(admin_user["token"]))
        assert resp.status_code == 200
        data = resp.json()
        assert data["description"] == "Updated description"
        assert data["contact_email"] == "new@example.com"
        assert data["contact_phone"] == "03-9876-5432"

    def test_tax_id_unique_among_active(self, client, admin_user):
        tax_id = _unique_tax_id()
        # Create first org with the tax_id
        resp1 = client.post("/api/organizations", json={
            "name": _unique_name(),
            "tax_id": tax_id,
        }, headers=auth_header(admin_user["token"]))
        assert resp1.status_code == 201

        # Create second org with the same tax_id → 409
        resp2 = client.post("/api/organizations", json={
            "name": _unique_name(),
            "tax_id": tax_id,
        }, headers=auth_header(admin_user["token"]))
        assert resp2.status_code == 409
        assert "統一編號" in resp2.json()["detail"]

    def test_tax_id_allowed_if_other_inactive(self, client, admin_user):
        tax_id = _unique_tax_id()
        # Create first org with the tax_id
        resp1 = client.post("/api/organizations", json={
            "name": _unique_name(),
            "tax_id": tax_id,
        }, headers=auth_header(admin_user["token"]))
        assert resp1.status_code == 201
        org1_id = resp1.json()["id"]

        # Deactivate org1
        deactivate_resp = client.patch(f"/api/organizations/{org1_id}",
                                       json={"is_active": False},
                                       headers=auth_header(admin_user["token"]))
        assert deactivate_resp.status_code == 200

        # Create second org with the same tax_id → OK (org1 is inactive)
        resp2 = client.post("/api/organizations", json={
            "name": _unique_name(),
            "tax_id": tax_id,
        }, headers=auth_header(admin_user["token"]))
        assert resp2.status_code == 201

    def test_tax_id_uniqueness_on_update(self, client, admin_user):
        tax_id = _unique_tax_id()
        # org1 has the tax_id
        resp1 = client.post("/api/organizations", json={
            "name": _unique_name(),
            "tax_id": tax_id,
        }, headers=auth_header(admin_user["token"]))
        assert resp1.status_code == 201

        # org2 has no tax_id yet
        resp2 = client.post("/api/organizations", json={"name": _unique_name()},
                            headers=auth_header(admin_user["token"]))
        assert resp2.status_code == 201
        org2_id = resp2.json()["id"]

        # Try updating org2 with same tax_id as org1 → 409
        update_resp = client.patch(f"/api/organizations/{org2_id}",
                                   json={"tax_id": tax_id},
                                   headers=auth_header(admin_user["token"]))
        assert update_resp.status_code == 409
        assert "統一編號" in update_resp.json()["detail"]

    def test_settings_jsonb(self, client, admin_user):
        settings_data = {"notifications": True, "theme": "dark", "quota": 500}
        resp = client.post("/api/organizations", json={
            "name": _unique_name(),
            "settings": settings_data,
        }, headers=auth_header(admin_user["token"]))
        assert resp.status_code == 201
        assert resp.json()["settings"] == settings_data

        # Update settings
        org_id = resp.json()["id"]
        update_resp = client.patch(f"/api/organizations/{org_id}",
                                   json={"settings": {"theme": "light"}},
                                   headers=auth_header(admin_user["token"]))
        assert update_resp.status_code == 200
        assert update_resp.json()["settings"] == {"theme": "light"}

    def test_all_new_fields_nullable(self, client, admin_user):
        resp = client.post("/api/organizations", json={"name": _unique_name()},
                           headers=auth_header(admin_user["token"]))
        assert resp.status_code == 201
        data = resp.json()
        assert data["description"] is None
        assert data["tax_id"] is None
        assert data["contact_email"] is None
        assert data["contact_phone"] is None
        assert data["address"] is None
        assert data["settings"] is None

    def test_new_fields_in_get_response(self, client, admin_user):
        tax_id = _unique_tax_id()
        create_resp = client.post("/api/organizations", json={
            "name": _unique_name(),
            "description": "Detail test",
            "tax_id": tax_id,
        }, headers=auth_header(admin_user["token"]))
        assert create_resp.status_code == 201
        org_id = create_resp.json()["id"]

        get_resp = client.get(f"/api/organizations/{org_id}",
                              headers=auth_header(admin_user["token"]))
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["description"] == "Detail test"
        assert data["tax_id"] == tax_id
