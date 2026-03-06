"""
Tests for the school management API.

Covers:
- POST  /api/schools             (create school)
- GET   /api/schools             (list schools)
- GET   /api/schools/{id}        (get school detail)
- PATCH /api/schools/{id}        (update school)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-223/backend
    python -m pytest tests/test_schools_api.py -v
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
from app.models.organization import Organization


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
# Module-level state
# ---------------------------------------------------------------------------

_test_org_id: str = ""


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_org_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)

    # Seed an organization for linking schools
    org = Organization(name="Test Org")
    session.add(org)
    session.commit()
    session.refresh(org)
    _test_org_id = org.id
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def org_id():
    return _test_org_id


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
    return _register_user(client, "school_user")


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "school_admin")
    return _make_admin(client, user)


# ===========================================================================
# POST /api/schools
# ===========================================================================


class TestCreateSchool:
    def test_create_returns_201(self, client, admin_user):
        resp = client.post(
            "/api/schools",
            json={"name": "Test School A"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201

    def test_create_returns_school_data(self, client, admin_user):
        resp = client.post(
            "/api/schools",
            json={"name": "School B", "address": "123 Main St", "phone": "02-1234-5678"},
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert data["name"] == "School B"
        assert data["address"] == "123 Main St"
        assert data["phone"] == "02-1234-5678"
        assert data["is_active"] is True
        assert "id" in data
        assert "created_at" in data

    def test_create_with_organization(self, client, admin_user, org_id):
        resp = client.post(
            "/api/schools",
            json={"name": "Org School", "organization_id": org_id},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201
        assert resp.json()["organization_id"] == org_id

    def test_create_with_nonexistent_org_returns_404(self, client, admin_user):
        resp = client.post(
            "/api/schools",
            json={"name": "Bad Org School", "organization_id": "nonexistent-uuid"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Organization not found"

    def test_create_missing_name_returns_422(self, client, admin_user):
        resp = client.post(
            "/api/schools",
            json={},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 422

    def test_create_empty_name_returns_422(self, client, admin_user):
        resp = client.post(
            "/api/schools",
            json={"name": ""},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 422

    def test_create_requires_auth(self, client):
        resp = client.post("/api/schools", json={"name": "No Auth"})
        assert resp.status_code == 401

    def test_create_non_admin_returns_403(self, client, user1):
        resp = client.post(
            "/api/schools",
            json={"name": "Forbidden School"},
            headers=auth_header(user1["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# GET /api/schools
# ===========================================================================


class TestListSchools:
    def test_list_returns_200(self, client, user1):
        resp = client.get("/api/schools", headers=auth_header(user1["token"]))
        assert resp.status_code == 200

    def test_list_returns_items_and_total(self, client, user1):
        resp = client.get("/api/schools", headers=auth_header(user1["token"]))
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
        assert isinstance(data["total"], int)
        assert data["total"] >= 1  # At least our created schools

    def test_list_pagination(self, client, user1):
        resp = client.get(
            "/api/schools?limit=1&offset=0",
            headers=auth_header(user1["token"]),
        )
        data = resp.json()
        assert len(data["items"]) <= 1

    def test_list_requires_auth(self, client):
        resp = client.get("/api/schools")
        assert resp.status_code == 401


# ===========================================================================
# GET /api/schools/{id}
# ===========================================================================


class TestGetSchool:
    def test_get_detail_success(self, client, admin_user, user1):
        create_resp = client.post(
            "/api/schools",
            json={"name": "Detail School"},
            headers=auth_header(admin_user["token"]),
        )
        school_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/schools/{school_id}",
            headers=auth_header(user1["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == school_id
        assert resp.json()["name"] == "Detail School"

    def test_get_nonexistent_returns_404(self, client, user1):
        resp = client.get(
            "/api/schools/99999",
            headers=auth_header(user1["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "School not found"

    def test_get_requires_auth(self, client):
        resp = client.get("/api/schools/1")
        assert resp.status_code == 401


# ===========================================================================
# PATCH /api/schools/{id}
# ===========================================================================


class TestUpdateSchool:
    def test_update_name(self, client, admin_user):
        create_resp = client.post(
            "/api/schools",
            json={"name": "Old School Name"},
            headers=auth_header(admin_user["token"]),
        )
        school_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/schools/{school_id}",
            json={"name": "New School Name"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New School Name"

    def test_update_address_and_phone(self, client, admin_user):
        create_resp = client.post(
            "/api/schools",
            json={"name": "Update Fields School"},
            headers=auth_header(admin_user["token"]),
        )
        school_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/schools/{school_id}",
            json={"address": "456 Oak Ave", "phone": "03-9876-5432"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["address"] == "456 Oak Ave"
        assert resp.json()["phone"] == "03-9876-5432"

    def test_deactivate_school(self, client, admin_user):
        create_resp = client.post(
            "/api/schools",
            json={"name": "Deactivate School"},
            headers=auth_header(admin_user["token"]),
        )
        school_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/schools/{school_id}",
            json={"is_active": False},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    def test_update_nonexistent_returns_404(self, client, admin_user):
        resp = client.patch(
            "/api/schools/99999",
            json={"name": "Ghost"},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404

    def test_update_requires_auth(self, client):
        resp = client.patch("/api/schools/1", json={"name": "No Auth"})
        assert resp.status_code == 401
