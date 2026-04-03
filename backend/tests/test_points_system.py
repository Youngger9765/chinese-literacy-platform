"""
Tests for organization points system.

Covers:
- Organization model fields: total_points, used_points, subscription dates
- points_service.check_and_deduct_points logic
- GET /api/organizations/{id}/points/logs endpoint

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-232/backend
    python -m pytest tests/test_points_system.py -v
"""

import sys
import os
import uuid
from datetime import datetime, timezone

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
from app.services.points_service import check_and_deduct_points, InsufficientPointsError


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
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
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
    return {
        "token": token,
        "user_id": me_resp.json()["id"],
        "email": email,
        "name": name,
    }


def _make_admin(user_id: int, role_name: str = "system_admin"):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == role_name).first()
    scope_type = "platform" if role_name == "system_admin" else "organization"
    user_role = UserRole(
        user_id=user_id,
        role_id=role.id,
        scope_type=scope_type,
        scope_id=None,
    )
    db.add(user_role)
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "pts_admin")
    _make_admin(user["user_id"], "system_admin")
    return user


@pytest.fixture(scope="module")
def regular_user(client):
    return _register_user(client, "pts_regular")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestOrgPointsFields:
    def test_create_org_with_points(self, client, admin_user):
        resp = client.post(
            "/api/organizations",
            json={"name": f"pts-org-{uuid.uuid4().hex[:6]}", "total_points": 100000},
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["total_points"] == 100000
        assert data["used_points"] == 0

    def test_org_response_includes_points(self, client, admin_user):
        org_name = f"pts-fields-{uuid.uuid4().hex[:6]}"
        create_resp = client.post(
            "/api/organizations",
            json={"name": org_name, "total_points": 5000},
            headers=auth_header(admin_user["token"]),
        )
        org_id = create_resp.json()["id"]

        resp = client.get(
            f"/api/organizations/{org_id}",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_points"] == 5000
        assert data["used_points"] == 0

    def test_subscription_dates(self, client, admin_user):
        start = "2026-01-01T00:00:00Z"
        end = "2026-12-31T23:59:59Z"
        resp = client.post(
            "/api/organizations",
            json={
                "name": f"pts-sub-{uuid.uuid4().hex[:6]}",
                "total_points": 1000,
                "subscription_start_date": start,
                "subscription_end_date": end,
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["subscription_start_date"] is not None
        assert data["subscription_end_date"] is not None

    def test_update_org_with_subscription_dates(self, client, admin_user):
        create_resp = client.post(
            "/api/organizations",
            json={"name": f"pts-upd-{uuid.uuid4().hex[:6]}"},
            headers=auth_header(admin_user["token"]),
        )
        org_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/organizations/{org_id}",
            json={
                "total_points": 9999,
                "subscription_start_date": "2026-03-01T00:00:00Z",
            },
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_points"] == 9999
        assert data["subscription_start_date"] is not None


class TestPointsService:
    def _create_org(self, total_points: int | None = 100) -> Organization:
        db = TestingSessionLocal()
        org = Organization(
            name=f"svc-org-{uuid.uuid4().hex[:8]}",
            total_points=total_points,
        )
        db.add(org)
        db.commit()
        db.refresh(org)
        db.close()
        return org

    def test_deduct_points(self):
        org = self._create_org(total_points=100)
        db = TestingSessionLocal()
        log = check_and_deduct_points(
            db=db,
            organization_id=org.id,
            user_id=None,
            points=10,
            feature_type="reading",
            description="test deduction",
        )
        db.close()

        # Verify org.used_points increased
        db2 = TestingSessionLocal()
        updated_org = db2.query(Organization).filter(Organization.id == org.id).first()
        assert updated_org.used_points == 10
        db2.close()

        assert log.points_used == 10
        assert log.feature_type == "reading"

    def test_deduct_points_insufficient(self):
        org = self._create_org(total_points=5)
        db = TestingSessionLocal()
        with pytest.raises(InsufficientPointsError):
            check_and_deduct_points(
                db=db,
                organization_id=org.id,
                user_id=None,
                points=10,
                feature_type="reading",
            )
        db.close()

    def test_deduct_points_no_limit(self):
        """Org with total_points=None should always succeed."""
        org = self._create_org(total_points=None)
        db = TestingSessionLocal()
        log = check_and_deduct_points(
            db=db,
            organization_id=org.id,
            user_id=None,
            points=99999,
            feature_type="reading",
        )
        db.close()
        assert log.points_used == 99999

    def test_points_log_created(self):
        from app.models.points_log import OrganizationPointsLog

        org = self._create_org(total_points=500)
        db = TestingSessionLocal()
        check_and_deduct_points(
            db=db,
            organization_id=org.id,
            user_id=None,
            points=5,
            feature_type="vocab",
            description="vocab test",
        )
        db.close()

        db2 = TestingSessionLocal()
        logs = (
            db2.query(OrganizationPointsLog)
            .filter(OrganizationPointsLog.organization_id == org.id)
            .all()
        )
        db2.close()
        assert len(logs) == 1
        assert logs[0].feature_type == "vocab"
        assert logs[0].description == "vocab test"

    def test_deduct_unknown_org(self):
        db = TestingSessionLocal()
        with pytest.raises(ValueError, match="Organization not found"):
            check_and_deduct_points(
                db=db,
                organization_id="nonexistent-id",
                user_id=None,
                points=1,
                feature_type="test",
            )
        db.close()


class TestPointsLogEndpoint:
    def _create_org_with_logs(self, admin_client, admin_token: str) -> str:
        org_name = f"log-org-{uuid.uuid4().hex[:6]}"
        create_resp = admin_client.post(
            "/api/organizations",
            json={"name": org_name, "total_points": 10000},
            headers=auth_header(admin_token),
        )
        assert create_resp.status_code == 201
        return create_resp.json()["id"]

    def test_points_log_endpoint(self, client, admin_user):
        org_id = self._create_org_with_logs(client, admin_user["token"])

        # Add some log entries via service
        db = TestingSessionLocal()
        check_and_deduct_points(db, org_id, admin_user["user_id"], 10, "reading", "log test 1")
        check_and_deduct_points(db, org_id, None, 5, "vocab", "log test 2")
        db.close()

        resp = client.get(
            f"/api/organizations/{org_id}/points/logs",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert data["total"] >= 2
        # Most recent first
        assert data["items"][0]["created_at"] >= data["items"][1]["created_at"]

    def test_points_log_has_user_name(self, client, admin_user):
        org_id = self._create_org_with_logs(client, admin_user["token"])

        db = TestingSessionLocal()
        check_and_deduct_points(db, org_id, admin_user["user_id"], 1, "reading")
        db.close()

        resp = client.get(
            f"/api/organizations/{org_id}/points/logs",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        entry = next((i for i in data["items"] if i["user_id"] == admin_user["user_id"]), None)
        assert entry is not None
        assert entry["user_name"] == admin_user["name"]

    def test_points_log_pagination(self, client, admin_user):
        org_id = self._create_org_with_logs(client, admin_user["token"])

        db = TestingSessionLocal()
        for i in range(5):
            check_and_deduct_points(db, org_id, None, 1, "reading", f"entry {i}")
        db.close()

        resp = client.get(
            f"/api/organizations/{org_id}/points/logs?limit=2&offset=0",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) <= 2

    def test_points_log_forbidden(self, client, regular_user):
        # Create an org that the regular user has no access to
        db = TestingSessionLocal()
        org = Organization(name=f"forbidden-org-{uuid.uuid4().hex[:6]}")
        db.add(org)
        db.commit()
        org_id = org.id
        db.close()

        resp = client.get(
            f"/api/organizations/{org_id}/points/logs",
            headers=auth_header(regular_user["token"]),
        )
        assert resp.status_code == 403

    def test_points_log_org_not_found(self, client, admin_user):
        resp = client.get(
            "/api/organizations/nonexistent-org-id/points/logs",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 404

    def test_points_log_requires_auth(self, client):
        resp = client.get("/api/organizations/some-id/points/logs")
        assert resp.status_code == 401
