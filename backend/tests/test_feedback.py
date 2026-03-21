"""
Tests for the Feedback System API.

Covers:
- POST   /api/feedback          — any authenticated user can submit
- GET    /api/feedback          — admin only, paginated list with filters
- PATCH  /api/feedback/{id}     — admin only, update status

Uses SQLite in-memory DB to avoid external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-247/backend
    python -m pytest tests/test_feedback.py -v
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
    {"name": "org_owner", "display_name": "Org Owner", "scope_level": "organization"},
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


def _register_and_login(client, suffix: str, role_name: str | None = None) -> tuple[int, str]:
    """Register a user and return (user_id, token). Optionally assign a role."""
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": "Test1234!",
        "name": f"{suffix} user",
    })
    assert resp.status_code == 201, resp.text
    verification_token = resp.json()["verification_token"]
    client.get(f"/api/auth/verify-email?token={verification_token}")
    login_r = client.post("/api/auth/login", json={"email": email, "password": "Test1234!"})
    token = login_r.json()["access_token"]

    # Retrieve user_id via /api/users/me
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    assert me_resp.status_code == 200, me_resp.text
    user_id = me_resp.json()["id"]

    if role_name:
        db = TestingSessionLocal()
        try:
            from app.models.user import UserRole
            role = db.query(Role).filter(Role.name == role_name).first()
            assert role is not None, f"Role '{role_name}' not seeded"
            db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="platform"))
            db.commit()
        finally:
            db.close()

    return user_id, token


# ---------------------------------------------------------------------------
# Tests: POST /api/feedback
# ---------------------------------------------------------------------------


class TestSubmitFeedback:
    def test_submit_feedback_success(self, client):
        """Any authenticated user can submit feedback."""
        _, token = _register_and_login(client, "student_fb")
        resp = client.post(
            "/api/feedback",
            json={
                "category": "bug",
                "title": "Button not working",
                "description": "The submit button does nothing",
                "page_url": "/library",
            },
            headers=auth_header(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["category"] == "bug"
        assert data["title"] == "Button not working"
        assert data["description"] == "The submit button does nothing"
        assert data["page_url"] == "/library"
        assert data["status"] == "open"
        assert "id" in data
        assert "created_at" in data

    def test_submit_feedback_minimal(self, client):
        """Description and page_url are optional."""
        _, token = _register_and_login(client, "student_min")
        resp = client.post(
            "/api/feedback",
            json={"category": "feature", "title": "Add dark mode"},
            headers=auth_header(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["category"] == "feature"
        assert data["description"] is None
        assert data["page_url"] is None

    def test_submit_feedback_all_categories(self, client):
        """All valid categories are accepted."""
        _, token = _register_and_login(client, "student_cat")
        for cat in ("bug", "feature", "question", "other"):
            resp = client.post(
                "/api/feedback",
                json={"category": cat, "title": f"Test {cat}"},
                headers=auth_header(token),
            )
            assert resp.status_code == 201, f"Category '{cat}' failed: {resp.text}"

    def test_submit_feedback_invalid_category(self, client):
        """Invalid category is rejected with 422."""
        _, token = _register_and_login(client, "student_inv")
        resp = client.post(
            "/api/feedback",
            json={"category": "invalid", "title": "Bad category"},
            headers=auth_header(token),
        )
        assert resp.status_code == 422, resp.text

    def test_submit_feedback_empty_title(self, client):
        """Empty title is rejected with 422."""
        _, token = _register_and_login(client, "student_emptitle")
        resp = client.post(
            "/api/feedback",
            json={"category": "bug", "title": ""},
            headers=auth_header(token),
        )
        assert resp.status_code == 422, resp.text

    def test_submit_feedback_unauthenticated(self, client):
        """Unauthenticated request is rejected with 401."""
        resp = client.post(
            "/api/feedback",
            json={"category": "bug", "title": "Should fail"},
        )
        assert resp.status_code == 401, resp.text


# ---------------------------------------------------------------------------
# Tests: GET /api/feedback
# ---------------------------------------------------------------------------


class TestListFeedback:
    def test_admin_can_list_feedback(self, client):
        """System admin can list all feedback."""
        _, admin_token = _register_and_login(client, "admin_list", "system_admin")
        _, user_token = _register_and_login(client, "user_list")

        # Submit some feedback first
        client.post(
            "/api/feedback",
            json={"category": "bug", "title": "List test bug"},
            headers=auth_header(user_token),
        )

        resp = client.get("/api/feedback", headers=auth_header(admin_token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert "page" in data
        assert "page_size" in data
        assert data["page"] == 1
        assert isinstance(data["items"], list)

    def test_non_admin_cannot_list_feedback(self, client):
        """Regular user cannot list feedback."""
        _, token = _register_and_login(client, "regular_list")
        resp = client.get("/api/feedback", headers=auth_header(token))
        assert resp.status_code == 403, resp.text

    def test_list_feedback_unauthenticated(self, client):
        """Unauthenticated request is rejected."""
        resp = client.get("/api/feedback")
        assert resp.status_code == 401, resp.text

    def test_list_feedback_pagination(self, client):
        """Pagination parameters work correctly."""
        _, admin_token = _register_and_login(client, "admin_page", "system_admin")
        resp = client.get(
            "/api/feedback?page=1&page_size=2",
            headers=auth_header(admin_token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["page"] == 1
        assert data["page_size"] == 2
        assert len(data["items"]) <= 2

    def test_list_feedback_filter_by_category(self, client):
        """Admin can filter feedback by category."""
        _, admin_token = _register_and_login(client, "admin_cat_filter", "system_admin")
        _, user_token = _register_and_login(client, "user_cat_filter")

        client.post(
            "/api/feedback",
            json={"category": "question", "title": "Filter test question"},
            headers=auth_header(user_token),
        )

        resp = client.get(
            "/api/feedback?category=question",
            headers=auth_header(admin_token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        for item in data["items"]:
            assert item["category"] == "question"

    def test_list_feedback_filter_by_status(self, client):
        """Admin can filter feedback by status."""
        _, admin_token = _register_and_login(client, "admin_st_filter", "system_admin")
        resp = client.get(
            "/api/feedback?status=open",
            headers=auth_header(admin_token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        for item in data["items"]:
            assert item["status"] == "open"


# ---------------------------------------------------------------------------
# Tests: PATCH /api/feedback/{id}
# ---------------------------------------------------------------------------


class TestUpdateFeedbackStatus:
    def test_admin_can_update_status(self, client):
        """Admin can change feedback status."""
        _, admin_token = _register_and_login(client, "admin_upd", "system_admin")
        _, user_token = _register_and_login(client, "user_upd")

        # Submit feedback
        create_resp = client.post(
            "/api/feedback",
            json={"category": "bug", "title": "Status update test"},
            headers=auth_header(user_token),
        )
        assert create_resp.status_code == 201
        feedback_id = create_resp.json()["id"]

        # Update to in_progress
        resp = client.patch(
            f"/api/feedback/{feedback_id}",
            json={"status": "in_progress"},
            headers=auth_header(admin_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "in_progress"

    def test_admin_can_resolve_feedback(self, client):
        """Admin can mark feedback as resolved."""
        _, admin_token = _register_and_login(client, "admin_res", "system_admin")
        _, user_token = _register_and_login(client, "user_res")

        create_resp = client.post(
            "/api/feedback",
            json={"category": "feature", "title": "Resolve test"},
            headers=auth_header(user_token),
        )
        feedback_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/feedback/{feedback_id}",
            json={"status": "resolved"},
            headers=auth_header(admin_token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "resolved"

    def test_update_invalid_status(self, client):
        """Invalid status value is rejected with 422."""
        _, admin_token = _register_and_login(client, "admin_inv_st", "system_admin")
        _, user_token = _register_and_login(client, "user_inv_st")

        create_resp = client.post(
            "/api/feedback",
            json={"category": "bug", "title": "Invalid status test"},
            headers=auth_header(user_token),
        )
        feedback_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/feedback/{feedback_id}",
            json={"status": "invalid_status"},
            headers=auth_header(admin_token),
        )
        assert resp.status_code == 422, resp.text

    def test_update_nonexistent_feedback(self, client):
        """Updating a non-existent feedback returns 404."""
        _, admin_token = _register_and_login(client, "admin_notfound", "system_admin")
        resp = client.patch(
            "/api/feedback/99999",
            json={"status": "resolved"},
            headers=auth_header(admin_token),
        )
        assert resp.status_code == 404, resp.text

    def test_non_admin_cannot_update_status(self, client):
        """Regular user cannot update feedback status."""
        _, admin_token = _register_and_login(client, "admin_guard", "system_admin")
        _, user_token = _register_and_login(client, "user_guard")

        create_resp = client.post(
            "/api/feedback",
            json={"category": "bug", "title": "Guard test"},
            headers=auth_header(user_token),
        )
        feedback_id = create_resp.json()["id"]

        resp = client.patch(
            f"/api/feedback/{feedback_id}",
            json={"status": "resolved"},
            headers=auth_header(user_token),
        )
        assert resp.status_code == 403, resp.text
