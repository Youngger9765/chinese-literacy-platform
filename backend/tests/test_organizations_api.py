"""
Tests for the organization management API.

Covers:
- POST  /api/organizations             (create org)
- GET   /api/organizations             (list orgs)
- GET   /api/organizations/{id}        (get org detail with schools)
- PATCH /api/organizations/{id}        (update org)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-223/backend
    python -m pytest tests/test_organizations_api.py -v
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
    return {"token": token, "user_id": me_resp.json()["id"]}


def _make_admin(client, user_data: dict) -> dict:
    """Assign system_admin role to a user via DB."""
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "system_admin").first()
    user_role = UserRole(
        user_id=user_data["user_id"],
        role_id=role.id,
        scope_type="platform",
        scope_id=None,
    )
    db.add(user_role)
    db.commit()
    db.close()
    return user_data


@pytest.fixture(scope="module")
def user1(client):
    return _register_user(client, "org_user")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "org_admin")
    return _make_admin(client, user)


# ===========================================================================
# POST /api/organizations
# ===========================================================================


class TestCreateOrganization:
    def test_create_returns_201(self, client, admin_user):
        resp = client.post(
            "/api/organizations",
            json={"name": "Test Org A"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201

    def test_create_returns_org_data(self, client, admin_user):
        resp = client.post(
            "/api/organizations",
            json={"name": "Org B", "display_name": "Organization B"},
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert data["name"] == "Org B"
        assert data["display_name"] == "Organization B"
        assert data["is_active"] is True
        assert data["school_count"] == 0
        assert "id" in data
        assert "created_at" in data

    def test_create_generates_uuid_id(self, client, admin_user):
        resp = client.post(
            "/api/organizations",
            json={"name": "UUID Org"},
            headers=auth_header(admin_user["token"]),
        )
        org_id = resp.json()["id"]
        assert isinstance(org_id, str)
        assert len(org_id) == 36  # UUID format

    def test_create_missing_name_returns_422(self, client, admin_user):
        resp = client.post(
            "/api/organizations",
            json={},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 422

    def test_create_empty_name_returns_422(self, client, admin_user):
        resp = client.post(
            "/api/organizations",
            json={"name": ""},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 422

    def test_create_requires_auth(self, client):
        resp = client.post("/api/organizations", json={"name": "No Auth"})
        assert resp.status_code == 401

    def test_create_non_admin_returns_403(self, client, user1):
        resp = client.post(
            "/api/organizations",
            json={"name": "Forbidden Org"},
            headers=auth_header(user1["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# GET /api/organizations
# ===========================================================================


class TestListOrganizations:
    def test_list_returns_200(self, client, user1):
        resp = client.get("/api/organizations", headers=auth_header(user1["token"]))
        assert resp.status_code == 200

    def test_list_returns_items_and_total(self, client, user1, admin_user):
        # user1 has no org scope — sees empty list (correct scoping behaviour)
        resp = client.get("/api/organizations", headers=auth_header(user1["token"]))
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
        assert data["total"] == 0

        # admin_user (system_admin) sees all orgs
        resp_admin = client.get("/api/organizations", headers=auth_header(admin_user["token"]))
        admin_data = resp_admin.json()
        assert admin_data["total"] >= 1

    def test_list_pagination(self, client, user1):
        resp = client.get(
            "/api/organizations?limit=1&offset=0",
            headers=auth_header(user1["token"]),
        )
        data = resp.json()
        assert len(data["items"]) <= 1

    def test_list_requires_auth(self, client):
        resp = client.get("/api/organizations")
        assert resp.status_code == 401


# ===========================================================================
# GET /api/organizations/{id}
# ===========================================================================


class TestGetOrganization:
    def test_get_detail_success(self, client, admin_user):
        create_resp = client.post(
            "/api/organizations",
            json={"name": "Detail Org"},
            headers=auth_header(admin_user["token"]),
        )
        org_id = create_resp.json()["id"]

        # admin_user (system_admin) can read any org
        resp = client.get(
            f"/api/organizations/{org_id}",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == org_id
        assert data["name"] == "Detail Org"
        assert "schools" in data
        assert isinstance(data["schools"], list)

    def test_get_detail_includes_schools(self, client, admin_user):
        org_resp = client.post(
            "/api/organizations",
            json={"name": "Org With Schools"},
            headers=auth_header(admin_user["token"]),
        )
        org_id = org_resp.json()["id"]

        client.post(
            "/api/schools",
            json={"name": "School Under Org", "organization_id": org_id},
            headers=auth_header(admin_user["token"]),
        )

        # admin_user (system_admin) can read any org
        resp = client.get(
            f"/api/organizations/{org_id}",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert data["school_count"] == 1
        assert len(data["schools"]) == 1
        assert data["schools"][0]["name"] == "School Under Org"

    def test_get_nonexistent_returns_404(self, client, user1):
        resp = client.get(
            "/api/organizations/nonexistent-uuid",
            headers=auth_header(user1["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Organization not found"

    def test_get_requires_auth(self, client):
        resp = client.get("/api/organizations/some-id")
        assert resp.status_code == 401


# ===========================================================================
# PATCH /api/organizations/{id}
# ===========================================================================


class TestUpdateOrganization:
    def test_update_name(self, client, admin_user):
        create_resp = client.post(
            "/api/organizations",
            json={"name": "Old Org Name"},
            headers=auth_header(admin_user["token"]),
        )
        org_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/organizations/{org_id}",
            json={"name": "New Org Name"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Org Name"

    def test_update_display_name(self, client, admin_user):
        create_resp = client.post(
            "/api/organizations",
            json={"name": "Display Update Org"},
            headers=auth_header(admin_user["token"]),
        )
        org_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/organizations/{org_id}",
            json={"display_name": "Pretty Name"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "Pretty Name"

    def test_deactivate_organization(self, client, admin_user):
        create_resp = client.post(
            "/api/organizations",
            json={"name": "Deactivate Org"},
            headers=auth_header(admin_user["token"]),
        )
        org_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/organizations/{org_id}",
            json={"is_active": False},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    def test_update_nonexistent_returns_404(self, client, admin_user):
        resp = client.patch(
            "/api/organizations/nonexistent-uuid",
            json={"name": "Ghost"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404

    def test_update_requires_auth(self, client):
        resp = client.patch("/api/organizations/some-id", json={"name": "No Auth"})
        assert resp.status_code == 401

    def test_update_non_admin_returns_403(self, client, admin_user, user1):
        create_resp = client.post(
            "/api/organizations",
            json={"name": "Admin Only Org"},
            headers=auth_header(admin_user["token"]),
        )
        org_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/organizations/{org_id}",
            json={"name": "Hacked Name"},
            headers=auth_header(user1["token"]),
        )
        assert resp.status_code == 403
