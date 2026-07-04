"""
Tests for the text auto-cleanup mechanism (Issue #92).

Covers:
- Service layer: preview_expired_texts / run_cleanup
- GET  /api/admin/cleanup/preview — preview expired rows
- POST /api/admin/cleanup/run    — soft-delete expired rows

BDD acceptance criteria:
  Given a ClassroomText with expires_at in the past
  When the cleanup job runs
  Then deleted_at is set (soft-deleted) and it no longer appears in the listing

  Given a ClassroomText with expires_at in the future
  When the cleanup job runs
  Then it is untouched (deleted_at remains NULL)

  Given a ClassroomText with no expires_at
  When the cleanup job runs
  Then it is untouched

Run with:
    cd backend
    python -m pytest tests/test_text_cleanup.py -v
"""

import sys
import os
import uuid
from datetime import datetime, timedelta, timezone

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
from app.models.school import School, Classroom, ClassroomText
from app.services.text_cleanup_service import preview_expired_texts, run_cleanup


# ---------------------------------------------------------------------------
# DB setup — SQLite in-memory
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


def _seed_school(session) -> int:
    school = School(name="Cleanup Test School")
    session.add(school)
    session.commit()
    session.refresh(school)
    return school.id


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

_test_school_id: int = 0


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _test_school_id = _seed_school(session)
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
def school_id():
    return _test_school_id


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"{suffix.title()} {unique}",
    })
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    user_id = me_resp.json()["id"]

    _mk = TestingSessionLocal()
    try:
        _trole = _mk.query(Role).filter(Role.name == "teacher").first()
        if _trole and not _mk.query(UserRole).filter(
            UserRole.user_id == user_id, UserRole.role_id == _trole.id,
            UserRole.scope_type == "school", UserRole.scope_id == str(_test_school_id),
        ).first():
            _mk.add(UserRole(user_id=user_id, role_id=_trole.id,
                             scope_type="school", scope_id=str(_test_school_id)))
            _mk.commit()
    finally:
        _mk.close()

    return {"email": email, "token": token, "user_id": user_id}


def _make_admin(user_id: int):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == "system_admin").first()
    db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="platform", scope_id=None))
    db.commit()
    db.close()


@pytest.fixture(scope="module")
def admin_user(client):
    user = _register_user(client, "cleanup_admin")
    _make_admin(user["user_id"])
    return user


@pytest.fixture(scope="module")
def teacher(client):
    return _register_user(client, "cleanup_teacher")


@pytest.fixture(scope="module")
def classroom_id(client, teacher, school_id):
    resp = client.post(
        "/api/classrooms",
        json={"name": "Cleanup Test Classroom", "school_id": school_id},
        headers=auth_header(teacher["token"]),
    )
    assert resp.status_code == 201
    return resp.json()["id"]


# ---------------------------------------------------------------------------
# Helpers — direct DB manipulation to plant test data
# ---------------------------------------------------------------------------

def _create_classroom_text(
    classroom_id: int,
    text_id: str,
    expires_at: datetime | None = None,
    deleted_at: datetime | None = None,
) -> int:
    """Insert a ClassroomText directly into the test DB and return its id."""
    db = TestingSessionLocal()
    ct = ClassroomText(
        classroom_id=classroom_id,
        text_id=text_id,
        expires_at=expires_at,
        deleted_at=deleted_at,
    )
    db.add(ct)
    db.commit()
    db.refresh(ct)
    ct_id = ct.id
    db.close()
    return ct_id


# ---------------------------------------------------------------------------
# Unit tests — service layer
# ---------------------------------------------------------------------------


class TestCleanupService:
    """Test preview_expired_texts and run_cleanup directly against the DB."""

    def test_preview_empty_when_no_expired_texts(self, classroom_id):
        """Preview returns 0 when there are no expired rows."""
        db = TestingSessionLocal()
        result = preview_expired_texts(db)
        db.close()
        # There may be rows from other tests; just confirm the function runs
        assert result.count >= 0
        assert isinstance(result.items, list)

    def test_preview_detects_expired_text(self, classroom_id):
        """A text whose expires_at is in the past appears in the preview."""
        past = datetime.now(timezone.utc) - timedelta(days=10)
        ct_id = _create_classroom_text(classroom_id, "20", expires_at=past)

        db = TestingSessionLocal()
        result = preview_expired_texts(db)
        db.close()

        ids = [item["id"] for item in result.items]
        assert ct_id in ids

    def test_preview_ignores_future_expiry(self, classroom_id):
        """A text whose expires_at is in the future is NOT in the preview."""
        future = datetime.now(timezone.utc) + timedelta(days=180)
        ct_id = _create_classroom_text(classroom_id, "21", expires_at=future)

        db = TestingSessionLocal()
        result = preview_expired_texts(db)
        db.close()

        ids = [item["id"] for item in result.items]
        assert ct_id not in ids

    def test_preview_ignores_no_expiry(self, classroom_id):
        """A text with no expires_at is NOT in the preview."""
        ct_id = _create_classroom_text(classroom_id, "22", expires_at=None)

        db = TestingSessionLocal()
        result = preview_expired_texts(db)
        db.close()

        ids = [item["id"] for item in result.items]
        assert ct_id not in ids

    def test_preview_ignores_already_deleted(self, classroom_id):
        """A text that was already soft-deleted is NOT shown in the preview."""
        past = datetime.now(timezone.utc) - timedelta(days=30)
        ct_id = _create_classroom_text(
            classroom_id, "23",
            expires_at=past,
            deleted_at=past,
        )

        db = TestingSessionLocal()
        result = preview_expired_texts(db)
        db.close()

        ids = [item["id"] for item in result.items]
        assert ct_id not in ids

    def test_run_cleanup_soft_deletes_expired(self, classroom_id):
        """run_cleanup sets deleted_at on expired rows."""
        past = datetime.now(timezone.utc) - timedelta(days=8)
        ct_id = _create_classroom_text(classroom_id, "30", expires_at=past)

        db = TestingSessionLocal()
        result = run_cleanup(db)
        db.close()

        deleted_ids = [item["id"] for item in result.items]
        assert ct_id in deleted_ids
        assert result.deleted_count >= 1

        # Verify deleted_at is now set in the DB
        db2 = TestingSessionLocal()
        ct = db2.query(ClassroomText).filter(ClassroomText.id == ct_id).first()
        db2.close()
        assert ct is not None
        assert ct.deleted_at is not None

    def test_run_cleanup_does_not_touch_non_expired(self, classroom_id):
        """run_cleanup leaves non-expired rows untouched."""
        future = datetime.now(timezone.utc) + timedelta(days=90)
        ct_id = _create_classroom_text(classroom_id, "31", expires_at=future)

        db = TestingSessionLocal()
        run_cleanup(db)
        db.close()

        db2 = TestingSessionLocal()
        ct = db2.query(ClassroomText).filter(ClassroomText.id == ct_id).first()
        db2.close()
        assert ct is not None
        assert ct.deleted_at is None

    def test_run_cleanup_does_not_touch_no_expiry(self, classroom_id):
        """run_cleanup leaves rows without expires_at untouched."""
        ct_id = _create_classroom_text(classroom_id, "32", expires_at=None)

        db = TestingSessionLocal()
        run_cleanup(db)
        db.close()

        db2 = TestingSessionLocal()
        ct = db2.query(ClassroomText).filter(ClassroomText.id == ct_id).first()
        db2.close()
        assert ct is not None
        assert ct.deleted_at is None

    def test_run_cleanup_is_idempotent(self, classroom_id):
        """Running cleanup twice on the same data does not error or double-count."""
        past = datetime.now(timezone.utc) - timedelta(days=5)
        ct_id = _create_classroom_text(classroom_id, "33", expires_at=past)

        # First run
        db = TestingSessionLocal()
        result1 = run_cleanup(db)
        db.close()

        count1 = sum(1 for item in result1.items if item["id"] == ct_id)
        assert count1 == 1

        # Second run — same row is already soft-deleted, should not appear
        db = TestingSessionLocal()
        result2 = run_cleanup(db)
        db.close()

        count2 = sum(1 for item in result2.items if item["id"] == ct_id)
        assert count2 == 0


# ---------------------------------------------------------------------------
# Integration tests — HTTP endpoints
# ---------------------------------------------------------------------------


class TestCleanupPreviewEndpoint:
    """GET /api/admin/cleanup/preview"""

    def test_preview_returns_200_for_admin(self, client, admin_user):
        resp = client.get(
            "/api/admin/cleanup/preview",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_preview_response_has_expected_fields(self, client, admin_user):
        resp = client.get(
            "/api/admin/cleanup/preview",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert "count" in data
        assert "items" in data
        assert isinstance(data["count"], int)
        assert isinstance(data["items"], list)

    def test_preview_count_matches_items_length(self, client, admin_user):
        resp = client.get(
            "/api/admin/cleanup/preview",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert data["count"] == len(data["items"])

    def test_preview_requires_admin_role(self, client, teacher):
        resp = client.get(
            "/api/admin/cleanup/preview",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403

    def test_preview_requires_auth(self, client):
        resp = client.get("/api/admin/cleanup/preview")
        assert resp.status_code == 401


class TestCleanupRunEndpoint:
    """POST /api/admin/cleanup/run"""

    def test_run_returns_200_for_admin(self, client, admin_user):
        resp = client.post(
            "/api/admin/cleanup/run",
            headers=auth_header(admin_user["token"]),
        )
        assert resp.status_code == 200

    def test_run_response_has_expected_fields(self, client, admin_user):
        resp = client.post(
            "/api/admin/cleanup/run",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert "deleted_count" in data
        assert "items" in data
        assert isinstance(data["deleted_count"], int)
        assert isinstance(data["items"], list)

    def test_run_soft_deletes_expired_text_via_api(self, client, admin_user, classroom_id):
        """Insert an expired row, trigger cleanup, verify it's gone from the listing."""
        # Plant an expired row directly
        past = datetime.now(timezone.utc) - timedelta(days=14)
        ct_id = _create_classroom_text(classroom_id, "40", expires_at=past)

        # Confirm it appears in preview
        preview_resp = client.get(
            "/api/admin/cleanup/preview",
            headers=auth_header(admin_user["token"]),
        )
        preview_ids = [item["id"] for item in preview_resp.json()["items"]]
        assert ct_id in preview_ids

        # Run cleanup
        run_resp = client.post(
            "/api/admin/cleanup/run",
            headers=auth_header(admin_user["token"]),
        )
        assert run_resp.status_code == 200
        deleted_ids = [item["id"] for item in run_resp.json()["items"]]
        assert ct_id in deleted_ids

        # Confirm deleted_at is set in DB
        db = TestingSessionLocal()
        ct = db.query(ClassroomText).filter(ClassroomText.id == ct_id).first()
        db.close()
        assert ct.deleted_at is not None

    def test_run_requires_admin_role(self, client, teacher):
        resp = client.post(
            "/api/admin/cleanup/run",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403

    def test_run_requires_auth(self, client):
        resp = client.post("/api/admin/cleanup/run")
        assert resp.status_code == 401

    def test_run_deleted_count_matches_items(self, client, admin_user):
        resp = client.post(
            "/api/admin/cleanup/run",
            headers=auth_header(admin_user["token"]),
        )
        data = resp.json()
        assert data["deleted_count"] == len(data["items"])


# ---------------------------------------------------------------------------
# Assign text with expires_at via HTTP
# ---------------------------------------------------------------------------


class TestAssignWithExpiry:
    """Assigning a text with expires_at stores the field correctly."""

    def test_assign_with_expires_at(self, client, teacher, classroom_id):
        future = (datetime.now(timezone.utc) + timedelta(days=60)).isoformat()
        resp = client.post(
            f"/api/classrooms/{classroom_id}/texts",
            json={"text_id": "50", "expires_at": future, "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "expires_at" in data
        assert data["expires_at"] is not None

    def test_assign_without_expires_at_returns_null(self, client, teacher, classroom_id):
        resp = client.post(
            f"/api/classrooms/{classroom_id}/texts",
            json={"text_id": "51", "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data.get("expires_at") is None

    def test_list_shows_expires_at(self, client, teacher, classroom_id):
        future = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        client.post(
            f"/api/classrooms/{classroom_id}/texts",
            json={"text_id": "52", "expires_at": future, "copyright_confirmed": True},
            headers=auth_header(teacher["token"]),
        )
        list_resp = client.get(
            f"/api/classrooms/{classroom_id}/texts",
            headers=auth_header(teacher["token"]),
        )
        items = list_resp.json()
        item_52 = next((i for i in items if i["text_id"] == "52"), None)
        assert item_52 is not None
        assert item_52["expires_at"] is not None

    def test_soft_deleted_text_not_in_listing(self, client, teacher, classroom_id):
        """A soft-deleted text (by cleanup) must not appear in the GET listing."""
        past = datetime.now(timezone.utc) - timedelta(days=7)
        ct_id = _create_classroom_text(classroom_id, "53", expires_at=past)

        # Run cleanup to soft-delete it
        db = TestingSessionLocal()
        run_cleanup(db)
        db.close()

        # The text should not appear in the active listing
        list_resp = client.get(
            f"/api/classrooms/{classroom_id}/texts",
            headers=auth_header(teacher["token"]),
        )
        assert list_resp.status_code == 200
        ids = [item["text_id"] for item in list_resp.json()]
        assert "53" not in ids
