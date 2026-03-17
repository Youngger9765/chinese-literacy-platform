"""
Tests for the error correction mechanism (Issue #248).

Covers:
- GET  /api/learning/students/{id}/error-patterns
- GET  /api/learning/students/{id}/recommended-vocab
- POST /api/learning/students/{id}/error-corrections

Uses SQLite in-memory DB to avoid any external dependency.
conftest.py patches JSONB -> JSON for SQLite compatibility.

Run with:
    cd backend && python -m pytest tests/test_error_correction.py -v
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
from app.models.user import Role
from app.models.session import LearningSession, CharacterError, ErrorCorrection

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


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    """Create all tables once, seed roles, override get_db, and clean up at end."""
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


def _register_user(client, suffix: str | None = None) -> dict:
    """Register a user and return {email, password, token, name, id}.

    Uses the new auth flow: register -> verify-email (dev mode token) -> login.
    """
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"err_user_{unique}@example.com"
    password = "SecurePass123!"
    name = f"Error User {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201, resp.text
    # Dev mode returns a verification_token to bypass email confirmation
    verification_token = resp.json().get("verification_token")
    assert verification_token is not None, "Expected dev-mode verification_token"
    verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
    assert verify_resp.status_code == 200, verify_resp.text
    # Now login to obtain a JWT
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]

    # Get user ID from /api/users/me
    me_resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    user_id = me_resp.json()["id"]

    return {
        "email": email,
        "password": password,
        "name": name,
        "token": token,
        "id": user_id,
    }


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def student_a(client):
    """First test student."""
    return _register_user(client, "student_a")


@pytest.fixture(scope="module")
def student_b(client):
    """Second test student."""
    return _register_user(client, "student_b")


def _create_session_with_errors(db_session, student_id: int, characters: list[str], started_at=None):
    """Helper: create a learning session and add character errors."""
    session = LearningSession(
        student_id=student_id,
        story_slug="test-story",
        status="completed",
        current_step=6,
    )
    if started_at:
        session.started_at = started_at
    db_session.add(session)
    db_session.flush()

    for char in characters:
        error = CharacterError(
            session_id=session.id,
            character=char,
            error_type="mispronunciation",
        )
        db_session.add(error)
    db_session.commit()
    return session


@pytest.fixture(scope="module")
def seeded_errors(student_a, student_b):
    """Seed error data: student_a has repeated errors, student_b has minimal errors."""
    db = TestingSessionLocal()
    try:
        # Student A: character '大' in 3 sessions, '小' in 2 sessions, '中' in 1 session
        _create_session_with_errors(db, student_a["id"], ["大", "小", "中"])
        _create_session_with_errors(db, student_a["id"], ["大", "小"])
        _create_session_with_errors(db, student_a["id"], ["大"])

        # Student B: only 1 error per character (should not appear in patterns)
        _create_session_with_errors(db, student_b["id"], ["人", "天"])
    finally:
        db.close()


# ===========================================================================
# GET /api/learning/students/{id}/error-patterns
# ===========================================================================


class TestErrorPatterns:
    def test_returns_200(self, client, student_a, seeded_errors):
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/error-patterns",
            headers=auth_header(student_a["token"]),
        )
        assert resp.status_code == 200

    def test_returns_repeated_errors_only(self, client, student_a, seeded_errors):
        """Characters with error_count >= 2 should appear."""
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/error-patterns",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        chars = [p["character"] for p in data["patterns"]]
        # '大' has 3 errors, '小' has 2 — both should appear
        assert "大" in chars
        assert "小" in chars

    def test_single_occurrence_filtered_out(self, client, student_a, seeded_errors):
        """Characters with only 1 error should NOT appear."""
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/error-patterns",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        chars = [p["character"] for p in data["patterns"]]
        # '中' only has 1 error
        assert "中" not in chars

    def test_sorted_by_error_count_desc(self, client, student_a, seeded_errors):
        """Results should be sorted by total_error_count descending."""
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/error-patterns",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        counts = [p["total_error_count"] for p in data["patterns"]]
        assert counts == sorted(counts, reverse=True)

    def test_pattern_fields(self, client, student_a, seeded_errors):
        """Each pattern should have all required fields."""
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/error-patterns",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        assert len(data["patterns"]) >= 1
        pattern = data["patterns"][0]
        assert "character" in pattern
        assert "total_error_count" in pattern
        assert "sessions_with_error" in pattern
        assert "last_error_date" in pattern
        assert "suggested_practice" in pattern
        assert "is_corrected" in pattern

    def test_no_errors_for_other_student(self, client, student_b, seeded_errors):
        """Student B has only single occurrences — no patterns returned."""
        resp = client.get(
            f"/api/learning/students/{student_b['id']}/error-patterns",
            headers=auth_header(student_b["token"]),
        )
        data = resp.json()
        assert data["total"] == 0
        assert data["patterns"] == []

    def test_requires_auth(self, client, student_a):
        resp = client.get(f"/api/learning/students/{student_a['id']}/error-patterns")
        assert resp.status_code == 401

    def test_access_denied_for_other_student(self, client, student_a, student_b):
        """Student A cannot access student B's error patterns."""
        resp = client.get(
            f"/api/learning/students/{student_b['id']}/error-patterns",
            headers=auth_header(student_a["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# GET /api/learning/students/{id}/recommended-vocab
# ===========================================================================


class TestRecommendedVocab:
    def test_returns_200(self, client, student_a, seeded_errors):
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/recommended-vocab",
            headers=auth_header(student_a["token"]),
        )
        assert resp.status_code == 200

    def test_returns_errored_characters(self, client, student_a, seeded_errors):
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/recommended-vocab",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        chars = [item["character"] for item in data["items"]]
        assert "大" in chars

    def test_vocab_item_fields(self, client, student_a, seeded_errors):
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/recommended-vocab",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        assert len(data["items"]) >= 1
        item = data["items"][0]
        assert "character" in item
        assert "error_count" in item
        assert "related_words" in item
        assert "zhuyin" in item

    def test_limit_of_10(self, client, student_a):
        """Even with many errored characters, only top 10 should be returned."""
        # Seed extra errors to exceed 10 distinct characters
        db = TestingSessionLocal()
        try:
            chars = list("天地人和風雨雪雲山水河海")
            _create_session_with_errors(db, student_a["id"], chars)
            _create_session_with_errors(db, student_a["id"], chars)
        finally:
            db.close()

        resp = client.get(
            f"/api/learning/students/{student_a['id']}/recommended-vocab",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        assert len(data["items"]) <= 10

    def test_mastered_excluded(self, client, student_a, seeded_errors):
        """Characters marked as mastered should not appear in recommendations."""
        # Mark '大' as mastered
        client.post(
            f"/api/learning/students/{student_a['id']}/error-corrections",
            json={"character": "大", "correction_type": "mastered"},
            headers=auth_header(student_a["token"]),
        )

        resp = client.get(
            f"/api/learning/students/{student_a['id']}/recommended-vocab",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        chars = [item["character"] for item in data["items"]]
        assert "大" not in chars

    def test_30_day_filter(self, client):
        """Only errors from the last 30 days should be included."""
        user = _register_user(client, "old_errors")
        db = TestingSessionLocal()
        try:
            old_date = datetime.now(timezone.utc) - timedelta(days=60)
            # Create old session with errors
            _create_session_with_errors(db, user["id"], ["古", "古"], started_at=old_date)
            _create_session_with_errors(db, user["id"], ["古"], started_at=old_date)
        finally:
            db.close()

        resp = client.get(
            f"/api/learning/students/{user['id']}/recommended-vocab",
            headers=auth_header(user["token"]),
        )
        data = resp.json()
        chars = [item["character"] for item in data["items"]]
        assert "古" not in chars

    def test_requires_auth(self, client, student_a):
        resp = client.get(f"/api/learning/students/{student_a['id']}/recommended-vocab")
        assert resp.status_code == 401


# ===========================================================================
# POST /api/learning/students/{id}/error-corrections
# ===========================================================================


class TestErrorCorrections:
    def test_mark_practiced_returns_201(self, client, student_a):
        resp = client.post(
            f"/api/learning/students/{student_a['id']}/error-corrections",
            json={"character": "小", "correction_type": "practice"},
            headers=auth_header(student_a["token"]),
        )
        assert resp.status_code == 201

    def test_mark_mastered_returns_201(self, client, student_a):
        resp = client.post(
            f"/api/learning/students/{student_a['id']}/error-corrections",
            json={"character": "中", "correction_type": "mastered"},
            headers=auth_header(student_a["token"]),
        )
        assert resp.status_code == 201

    def test_correction_response_fields(self, client, student_a):
        resp = client.post(
            f"/api/learning/students/{student_a['id']}/error-corrections",
            json={"character": "人", "correction_type": "practice"},
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        assert "id" in data
        assert data["student_id"] == student_a["id"]
        assert data["character"] == "人"
        assert data["correction_type"] == "practice"
        assert "created_at" in data

    def test_invalid_correction_type_returns_422(self, client, student_a):
        resp = client.post(
            f"/api/learning/students/{student_a['id']}/error-corrections",
            json={"character": "大", "correction_type": "invalid"},
            headers=auth_header(student_a["token"]),
        )
        assert resp.status_code == 422

    def test_empty_character_returns_422(self, client, student_a):
        resp = client.post(
            f"/api/learning/students/{student_a['id']}/error-corrections",
            json={"character": "", "correction_type": "practice"},
            headers=auth_header(student_a["token"]),
        )
        assert resp.status_code == 422

    def test_cannot_mark_for_other_student(self, client, student_a, student_b):
        """Student A cannot mark corrections for student B."""
        resp = client.post(
            f"/api/learning/students/{student_b['id']}/error-corrections",
            json={"character": "大", "correction_type": "practice"},
            headers=auth_header(student_a["token"]),
        )
        assert resp.status_code == 403

    def test_requires_auth(self, client, student_a):
        resp = client.post(
            f"/api/learning/students/{student_a['id']}/error-corrections",
            json={"character": "大", "correction_type": "practice"},
        )
        assert resp.status_code == 401

    def test_mastered_marks_is_corrected_in_patterns(self, client):
        """After marking a character as mastered, it should show is_corrected=True in patterns."""
        user = _register_user(client, "corrected_test")
        db = TestingSessionLocal()
        try:
            _create_session_with_errors(db, user["id"], ["星", "星"])
            _create_session_with_errors(db, user["id"], ["星"])
        finally:
            db.close()

        # Check patterns before correction
        resp = client.get(
            f"/api/learning/students/{user['id']}/error-patterns",
            headers=auth_header(user["token"]),
        )
        data = resp.json()
        star_pattern = [p for p in data["patterns"] if p["character"] == "星"]
        assert len(star_pattern) == 1
        assert star_pattern[0]["is_corrected"] is False
        assert star_pattern[0]["suggested_practice"] is True

        # Mark as mastered
        resp = client.post(
            f"/api/learning/students/{user['id']}/error-corrections",
            json={"character": "星", "correction_type": "mastered"},
            headers=auth_header(user["token"]),
        )
        assert resp.status_code == 201

        # Check patterns after correction
        resp = client.get(
            f"/api/learning/students/{user['id']}/error-patterns",
            headers=auth_header(user["token"]),
        )
        data = resp.json()
        star_pattern = [p for p in data["patterns"] if p["character"] == "星"]
        assert len(star_pattern) == 1
        assert star_pattern[0]["is_corrected"] is True
        assert star_pattern[0]["suggested_practice"] is False


# ===========================================================================
# GET /api/learning/students/{id}/story-slugs  (Issue #438)
# ===========================================================================


class TestStudentStorySlugs:
    def test_returns_200(self, client, student_a, seeded_errors):
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/story-slugs",
            headers=auth_header(student_a["token"]),
        )
        assert resp.status_code == 200

    def test_returns_distinct_slugs(self, client, student_a, seeded_errors):
        """Should return distinct story_slug values from the student's sessions."""
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/story-slugs",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        assert "slugs" in data
        assert "total" in data
        # seeded_errors uses "test-story" slug
        assert "test-story" in data["slugs"]

    def test_no_duplicates(self, client, student_a, seeded_errors):
        """Multiple sessions with same slug should produce only one entry."""
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/story-slugs",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        assert len(data["slugs"]) == len(set(data["slugs"]))

    def test_requires_auth(self, client, student_a):
        resp = client.get(f"/api/learning/students/{student_a['id']}/story-slugs")
        assert resp.status_code == 401

    def test_access_denied_for_other_student(self, client, student_a, student_b):
        resp = client.get(
            f"/api/learning/students/{student_b['id']}/story-slugs",
            headers=auth_header(student_a["token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# GET /api/learning/students/{id}/error-patterns?story_slug=  (Issue #438)
# ===========================================================================


class TestErrorPatternsStoryFilter:
    def test_filter_by_existing_slug_returns_errors(self, client, seeded_errors):
        """When filtering by a slug that has errors, results should be returned."""
        user = _register_user(client, "slug_filter_a")
        db = TestingSessionLocal()
        try:
            # Create session for slug "story-A" with 2 errors on '月'
            sess = LearningSession(
                student_id=user["id"],
                story_slug="story-A",
                status="completed",
                current_step=6,
            )
            db.add(sess)
            db.flush()
            for _ in range(2):
                db.add(CharacterError(session_id=sess.id, character="月", error_type="mispronunciation"))
            # Create session for slug "story-B" with 2 errors on '日'
            sess2 = LearningSession(
                student_id=user["id"],
                story_slug="story-B",
                status="completed",
                current_step=6,
            )
            db.add(sess2)
            db.flush()
            for _ in range(2):
                db.add(CharacterError(session_id=sess2.id, character="日", error_type="mispronunciation"))
            db.commit()
        finally:
            db.close()

        resp = client.get(
            f"/api/learning/students/{user['id']}/error-patterns?story_slug=story-A",
            headers=auth_header(user["token"]),
        )
        data = resp.json()
        chars = [p["character"] for p in data["patterns"]]
        assert "月" in chars
        # '日' is from story-B only, should not appear
        assert "日" not in chars

    def test_filter_lowered_threshold(self, client, seeded_errors):
        """When filtering by story, even single-occurrence errors should appear."""
        user = _register_user(client, "slug_filter_b")
        db = TestingSessionLocal()
        try:
            sess = LearningSession(
                student_id=user["id"],
                story_slug="story-C",
                status="completed",
                current_step=6,
            )
            db.add(sess)
            db.flush()
            # Only 1 error on '花' — normally filtered out without story_slug
            db.add(CharacterError(session_id=sess.id, character="花", error_type="mispronunciation"))
            db.commit()
        finally:
            db.close()

        # Without filter: '花' should NOT appear (only 1 error)
        resp_all = client.get(
            f"/api/learning/students/{user['id']}/error-patterns",
            headers=auth_header(user["token"]),
        )
        all_chars = [p["character"] for p in resp_all.json()["patterns"]]
        assert "花" not in all_chars

        # With story filter: '花' SHOULD appear (threshold = 1)
        resp_filtered = client.get(
            f"/api/learning/students/{user['id']}/error-patterns?story_slug=story-C",
            headers=auth_header(user["token"]),
        )
        filtered_chars = [p["character"] for p in resp_filtered.json()["patterns"]]
        assert "花" in filtered_chars

    def test_filter_nonexistent_slug_returns_empty(self, client, student_a, seeded_errors):
        """Filtering by a slug that has no errors should return an empty list."""
        resp = client.get(
            f"/api/learning/students/{student_a['id']}/error-patterns?story_slug=nonexistent-story",
            headers=auth_header(student_a["token"]),
        )
        data = resp.json()
        assert data["total"] == 0
        assert data["patterns"] == []
