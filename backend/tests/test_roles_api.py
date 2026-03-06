"""
Tests for the role management API.

Covers:
- GET    /api/roles                              (list all roles)
- POST   /api/roles/assign                       (assign role to user)
- DELETE /api/roles/assignments/{assignment_id}   (revoke role)
- GET    /api/users/{user_id}/roles              (list user's roles)

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-223/backend
    python -m pytest tests/test_roles_api.py -v
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
from app.models.user import Role


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


@pytest.fixture(scope="module")
def admin_user(client):
    return _register_user(client, "role_admin")


@pytest.fixture(scope="module")
def target_user(client):
    return _register_user(client, "role_target")


# ===========================================================================
# GET /api/roles
# ===========================================================================


class TestListRoles:
    def test_list_returns_200(self, client, admin_user):
        resp = client.get("/api/roles", headers=auth_header(admin_user["token"]))
        assert resp.status_code == 200

    def test_list_returns_all_seed_roles(self, client, admin_user):
        resp = client.get("/api/roles", headers=auth_header(admin_user["token"]))
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 8  # 8 seed roles
        role_names = {r["name"] for r in data}
        assert "teacher" in role_names
        assert "student" in role_names
        assert "system_admin" in role_names

    def test_list_role_has_expected_fields(self, client, admin_user):
        resp = client.get("/api/roles", headers=auth_header(admin_user["token"]))
        data = resp.json()
        for role in data:
            assert "id" in role
            assert "name" in role
            assert "display_name" in role
            assert "scope_level" in role

    def test_list_requires_auth(self, client):
        resp = client.get("/api/roles")
        assert resp.status_code == 401


# ===========================================================================
# POST /api/roles/assign
# ===========================================================================


class TestAssignRole:
    def test_assign_returns_201(self, client, admin_user, target_user):
        resp = client.post(
            "/api/roles/assign",
            json={
                "user_id": target_user["user_id"],
                "role_name": "student",
                "scope_type": "platform",
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201

    def test_assign_returns_role_data(self, client, admin_user, target_user):
        resp = client.post(
            "/api/roles/assign",
            json={
                "user_id": target_user["user_id"],
                "role_name": "principal",
                "scope_type": "school",
                "scope_id": "1",
            },
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert data["user_id"] == target_user["user_id"]
        assert data["role_name"] == "principal"
        assert data["scope_type"] == "school"
        assert data["scope_id"] == "1"
        assert data["is_active"] is True
        assert "id" in data
        assert "created_at" in data

    def test_assign_duplicate_returns_409(self, client, admin_user, target_user):
        # First assign a unique role
        unique_scope_id = uuid.uuid4().hex[:8]
        client.post(
            "/api/roles/assign",
            json={
                "user_id": target_user["user_id"],
                "role_name": "director",
                "scope_type": "school",
                "scope_id": unique_scope_id,
            },
            headers=auth_header(admin_user["token"]),
        )
        # Try to assign the same role again
        resp = client.post(
            "/api/roles/assign",
            json={
                "user_id": target_user["user_id"],
                "role_name": "director",
                "scope_type": "school",
                "scope_id": unique_scope_id,
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 409
        assert resp.json()["detail"] == "Role already assigned to user"

    def test_assign_nonexistent_user_returns_404(self, client, admin_user):
        resp = client.post(
            "/api/roles/assign",
            json={
                "user_id": 99999,
                "role_name": "teacher",
                "scope_type": "platform",
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "User not found"

    def test_assign_nonexistent_role_returns_404(self, client, admin_user, target_user):
        resp = client.post(
            "/api/roles/assign",
            json={
                "user_id": target_user["user_id"],
                "role_name": "nonexistent_role",
                "scope_type": "platform",
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Role not found"

    def test_assign_invalid_scope_type_returns_422(self, client, admin_user, target_user):
        resp = client.post(
            "/api/roles/assign",
            json={
                "user_id": target_user["user_id"],
                "role_name": "teacher",
                "scope_type": "invalid_scope",
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 422

    def test_assign_requires_auth(self, client, target_user):
        resp = client.post(
            "/api/roles/assign",
            json={
                "user_id": target_user["user_id"],
                "role_name": "teacher",
                "scope_type": "platform",
            },
        )
        assert resp.status_code == 401


# ===========================================================================
# DELETE /api/roles/assignments/{assignment_id}
# ===========================================================================


class TestRevokeRole:
    def test_revoke_returns_200(self, client, admin_user):
        # Create a user and assign a role
        user = _register_user(client, "revoke_user")
        assign_resp = client.post(
            "/api/roles/assign",
            json={
                "user_id": user["user_id"],
                "role_name": "org_admin",
                "scope_type": "organization",
                "scope_id": "test-org",
            },
            headers=auth_header(admin_user["token"]),
        )
        assignment_id = assign_resp.json()["id"]

        resp = client.delete(
            f"/api/roles/assignments/{assignment_id}",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["message"] == "Role assignment revoked"

    def test_revoke_makes_role_inactive(self, client, admin_user):
        user = _register_user(client, "revoke_check")
        assign_resp = client.post(
            "/api/roles/assign",
            json={
                "user_id": user["user_id"],
                "role_name": "parent",
                "scope_type": "school",
                "scope_id": "2",
            },
            headers=auth_header(admin_user["token"]),
        )
        assignment_id = assign_resp.json()["id"]

        # Revoke it
        client.delete(
            f"/api/roles/assignments/{assignment_id}",
            headers=auth_header(admin_user["token"]),
        )

        # Check user's active roles -- 'parent' should not appear
        roles_resp = client.get(
            f"/api/users/{user['user_id']}/roles",
            headers=auth_header(admin_user["token"]),
        )
        role_names = [r["role_name"] for r in roles_resp.json()]
        assert "parent" not in role_names

    def test_revoke_nonexistent_returns_404(self, client, admin_user):
        resp = client.delete(
            "/api/roles/assignments/99999",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Role assignment not found"

    def test_revoke_requires_auth(self, client):
        resp = client.delete("/api/roles/assignments/1")
        assert resp.status_code == 401


# ===========================================================================
# GET /api/users/{user_id}/roles
# ===========================================================================


class TestListUserRoles:
    def test_list_user_roles_returns_200(self, client, admin_user, target_user):
        resp = client.get(
            f"/api/users/{target_user['user_id']}/roles",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_list_user_roles_returns_assigned_roles(self, client, admin_user):
        user = _register_user(client, "multi_role")
        # Already has 'teacher' from auto-assign
        # Add 'system_admin'
        client.post(
            "/api/roles/assign",
            json={
                "user_id": user["user_id"],
                "role_name": "system_admin",
                "scope_type": "platform",
            },
            headers=auth_header(admin_user["token"]),
        )

        resp = client.get(
            f"/api/users/{user['user_id']}/roles",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        role_names = {r["role_name"] for r in data}
        assert "teacher" in role_names  # auto-assigned on register
        assert "system_admin" in role_names

    def test_list_user_roles_has_expected_fields(self, client, admin_user, target_user):
        resp = client.get(
            f"/api/users/{target_user['user_id']}/roles",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        if len(data) > 0:
            role = data[0]
            assert "id" in role
            assert "user_id" in role
            assert "role_id" in role
            assert "role_name" in role
            assert "role_display_name" in role
            assert "scope_type" in role
            assert "is_active" in role
            assert "created_at" in role

    def test_list_nonexistent_user_returns_404(self, client, admin_user):
        resp = client.get(
            "/api/users/99999/roles",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "User not found"

    def test_list_user_roles_requires_auth(self, client):
        resp = client.get("/api/users/1/roles")
        assert resp.status_code == 401


# ===========================================================================
# Auto-assign teacher role on registration
# ===========================================================================


class TestAutoAssignTeacherRole:
    def test_new_user_has_teacher_role(self, client, admin_user):
        user = _register_user(client, "auto_teacher")

        resp = client.get(
            f"/api/users/{user['user_id']}/roles",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert len(data) >= 1
        teacher_roles = [r for r in data if r["role_name"] == "teacher"]
        assert len(teacher_roles) == 1
        assert teacher_roles[0]["scope_type"] == "platform"

    def test_auto_assigned_role_appears_in_me_endpoint(self, client):
        user = _register_user(client, "me_teacher")
        resp = client.get("/api/users/me", headers=auth_header(user["token"]))
        data = resp.json()
        assert len(data["roles"]) >= 1
        assert data["roles"][0]["role_name"] == "teacher"
