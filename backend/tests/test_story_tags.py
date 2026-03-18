"""
Tests for the story tag system (Issue #422).

Covers:
- GET  /api/teacher/story-tags/{story_ref}   — get tags for a story
- PUT  /api/teacher/story-tags/{story_ref}   — upsert tags
- DELETE /api/teacher/story-tags/{story_ref} — clear tags
- GET  /api/teacher/story-tags               — list all tags

Uses SQLite in-memory DB to avoid any external dependency.

NOTE: The story_tags table requires a DB migration to go live.
These tests verify API behavior and model logic.

Run with:
    cd backend
    python -m pytest tests/test_story_tags.py -v
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
from app.models.school import School


# ---------------------------------------------------------------------------
# Test database setup (SQLite in-memory with StaticPool)
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
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "class"},
    {"name": "student", "display_name": "Student", "scope_level": "class"},
    {"name": "parent", "display_name": "Parent", "scope_level": "class"},
]


def get_test_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = get_test_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


def _make_teacher(client, suffix: str = "t") -> str:
    """Register + verify + login a teacher, return access_token."""
    uid = uuid.uuid4().hex[:8]
    email = f"{suffix}_{uid}@test.com"
    password = "Test1234!"

    reg = client.post(
        "/api/auth/register",
        json={"name": f"Teacher {uid}", "email": email, "password": password},
    )
    assert reg.status_code in (200, 201), reg.text
    verification_token = reg.json().get("verification_token")

    # Verify email (required before login)
    if verification_token:
        ver = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert ver.status_code == 200, ver.text

    login = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


@pytest.fixture(scope="module")
def teacher_token(client):
    """Register and authenticate a teacher, return JWT access token."""
    db = TestingSessionLocal()
    try:
        if not db.query(Role).first():
            for r in SEED_ROLES:
                db.add(Role(**r))
            db.commit()
    finally:
        db.close()

    return _make_teacher(client)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGetStoryTag:
    def test_returns_empty_defaults_when_no_tag_exists(self, client, teacher_token):
        """GET a story that has no tag yet → default empty response."""
        res = client.get(
            "/api/teacher/story-tags/999",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["story_ref"] == "999"
        assert data["difficulty_level"] is None
        assert data["custom_tags"] == []

    def test_requires_auth(self, client):
        res = client.get("/api/teacher/story-tags/1")
        assert res.status_code == 401


class TestUpsertStoryTag:
    def test_set_difficulty_level(self, client, teacher_token):
        """PUT with difficulty_level → returns saved difficulty."""
        res = client.put(
            "/api/teacher/story-tags/1",
            json={"difficulty_level": "hard", "custom_tags": []},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["difficulty_level"] == "hard"
        assert data["story_ref"] == "1"

    def test_set_custom_tags(self, client, teacher_token):
        """PUT with custom_tags → returns saved tags."""
        res = client.put(
            "/api/teacher/story-tags/2",
            json={"difficulty_level": "easy", "custom_tags": ["重要考題", "期末複習"]},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["difficulty_level"] == "easy"
        assert "重要考題" in data["custom_tags"]
        assert "期末複習" in data["custom_tags"]

    def test_update_existing_tag(self, client, teacher_token):
        """PUT on same story_ref updates the record."""
        # First set
        client.put(
            "/api/teacher/story-tags/3",
            json={"difficulty_level": "easy", "custom_tags": ["old"]},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        # Update
        res = client.put(
            "/api/teacher/story-tags/3",
            json={"difficulty_level": "medium", "custom_tags": ["new"]},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["difficulty_level"] == "medium"
        assert data["custom_tags"] == ["new"]

    def test_invalid_difficulty_returns_422(self, client, teacher_token):
        """PUT with invalid difficulty_level → 422."""
        res = client.put(
            "/api/teacher/story-tags/4",
            json={"difficulty_level": "extreme"},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert res.status_code == 422

    def test_too_many_tags_returns_422(self, client, teacher_token):
        """PUT with more than 10 tags → 422."""
        tags = [f"tag{i}" for i in range(11)]
        res = client.put(
            "/api/teacher/story-tags/5",
            json={"custom_tags": tags},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert res.status_code == 422

    def test_teacher_text_ref_format(self, client, teacher_token):
        """PUT with 'text:{id}' story_ref → works."""
        res = client.put(
            "/api/teacher/story-tags/text:42",
            json={"difficulty_level": "medium", "custom_tags": ["自訂課文"]},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["story_ref"] == "text:42"

    def test_requires_auth(self, client):
        res = client.put(
            "/api/teacher/story-tags/1",
            json={"difficulty_level": "easy"},
        )
        assert res.status_code == 401

    def test_clear_difficulty_with_null(self, client, teacher_token):
        """PUT with difficulty_level: null clears the override."""
        # Set first
        client.put(
            "/api/teacher/story-tags/10",
            json={"difficulty_level": "hard", "custom_tags": []},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        # Clear by sending null explicitly (JSON null)
        res = client.put(
            "/api/teacher/story-tags/10",
            json={"difficulty_level": None, "custom_tags": []},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert res.status_code == 200


class TestDeleteStoryTag:
    def test_delete_existing_tag(self, client, teacher_token):
        """DELETE removes the tag record → subsequent GET returns defaults."""
        client.put(
            "/api/teacher/story-tags/20",
            json={"difficulty_level": "hard", "custom_tags": ["x"]},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        del_res = client.delete(
            "/api/teacher/story-tags/20",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert del_res.status_code == 204

        get_res = client.get(
            "/api/teacher/story-tags/20",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        data = get_res.json()
        assert data["difficulty_level"] is None
        assert data["custom_tags"] == []

    def test_delete_nonexistent_is_204(self, client, teacher_token):
        """DELETE on a story with no tag record → still 204 (idempotent)."""
        res = client.delete(
            "/api/teacher/story-tags/9999",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert res.status_code == 204

    def test_requires_auth(self, client):
        res = client.delete("/api/teacher/story-tags/1")
        assert res.status_code == 401


class TestListStoryTags:
    def test_list_returns_own_tags(self, client, teacher_token):
        """GET /teacher/story-tags returns list of teacher's tags."""
        # Ensure at least one tag exists (from prior tests)
        res = client.get(
            "/api/teacher/story-tags",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    def test_requires_auth(self, client):
        res = client.get("/api/teacher/story-tags")
        assert res.status_code == 401


class TestTagIsolation:
    def test_teachers_cannot_see_each_other_tags(self, client, teacher_token):
        """Tags are scoped per teacher — other teacher's tags not returned."""
        # Register a second teacher
        token2 = _make_teacher(client, suffix="t2")

        # Teacher 1 sets a tag on story_ref "50"
        client.put(
            "/api/teacher/story-tags/50",
            json={"difficulty_level": "hard", "custom_tags": ["T1_only"]},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )

        # Teacher 2 should see defaults (not T1's tag)
        res2 = client.get(
            "/api/teacher/story-tags/50",
            headers={"Authorization": f"Bearer {token2}"},
        )
        assert res2.status_code == 200
        assert res2.json()["difficulty_level"] is None
        assert res2.json()["custom_tags"] == []
