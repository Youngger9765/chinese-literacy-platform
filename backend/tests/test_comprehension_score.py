"""
Tests for the 3-level comprehension scoring API (Issue #243).

Covers:
- POST /api/learning/sessions/{id}/comprehension-score
  - Success with mock Gemini response
  - Cached scores returned without re-calling Gemini
  - 404 for invalid session
  - 403 for other user's session
  - 401 for unauthenticated requests
  - Score ranges are valid (0-100)
  - All 3 sub-scores present
  - 503 on Gemini failure

Run with:
    cd backend && python -m pytest tests/test_comprehension_score.py -v
"""

import sys
import os
import uuid
from unittest.mock import AsyncMock, patch

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


@pytest.fixture(autouse=True)
def reset_rate_limiters():
    """Reset all rate limiters before each test."""
    from app.auth.rate_limiter import ai_rate_limiter, general_rate_limiter
    from app.routes.auth import rate_limiter
    ai_rate_limiter.reset()
    general_rate_limiter.reset()
    rate_limiter.reset()


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _register_user(client, suffix: str | None = None) -> dict:
    """Register a user, verify email (dev mode), login, and return {email, password, token, name}.

    Updated for Issue #460: register no longer auto-verifies or returns an access token.
    We use the verification_token returned in dev mode to verify, then login.
    """
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"comp_score_{unique}@example.com"
    password = "SecurePass123!"
    name = f"CompScore User {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201, resp.text

    # Verify email using the dev-mode verification_token
    verification_token = resp.json().get("verification_token")
    if verification_token:
        verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert verify_resp.status_code == 200, verify_resp.text

    # Login to get a JWT access token
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]

    return {
        "email": email,
        "password": password,
        "name": name,
        "token": token,
    }


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def user_a(client):
    return _register_user(client, "comp_a")


@pytest.fixture(scope="module")
def user_b(client):
    return _register_user(client, "comp_b")


# Mock Gemini response for comprehension scoring
MOCK_GEMINI_SCORE = {
    "comprehension_score": 75.0,
    "literal_score": 85.0,
    "inferential_score": 70.0,
    "evaluative_score": 65.0,
    "feedback": {
        "literal": "你能正確回答課文的基本事實，表示你有仔細閱讀。",
        "inferential": "推論能力不錯，但可以更深入思考角色的動機。",
        "evaluative": "你的觀點很有趣，但可以多連結自己的經驗。",
        "overall": "整體理解力不錯！繼續加油。",
    },
}

SCORE_REQUEST_BODY = {
    "story_title": "玉山",
    "story_text": "玉山是東北亞第一高峰，海拔約3952公尺。",
    "dialogue_turns": [
        {"role": "ai", "text": "這篇課文提到玉山的稱號是什麼？"},
        {"role": "student", "text": "東北亞第一高峰"},
        {"role": "ai", "text": "為什麼玉山會被稱為東北亞第一高峰？"},
        {"role": "student", "text": "因為它的海拔最高，有3952公尺"},
        {"role": "ai", "text": "如果你有機會爬玉山，你會怎麼準備？"},
        {"role": "student", "text": "我會帶很多水和食物，穿保暖的衣服"},
    ],
}


def _create_session(client, token: str, slug: str = "comp-test") -> int:
    resp = client.post(
        "/api/learning/sessions",
        json={"story_slug": slug},
        headers=auth_header(token),
    )
    assert resp.status_code == 201
    return resp.json()["id"]


# ===========================================================================
# POST /api/learning/sessions/{id}/comprehension-score
# ===========================================================================


class TestComprehensionScore:
    @patch("app.routes.learning.learning_comprehension_score.evaluate_comprehension", new_callable=AsyncMock)
    def test_score_returns_200_with_valid_data(self, mock_eval, client, user_a):
        mock_eval.return_value = MOCK_GEMINI_SCORE
        session_id = _create_session(client, user_a["token"], "score-200")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["comprehension_score"] == 75.0
        assert data["literal_score"] == 85.0
        assert data["inferential_score"] == 70.0
        assert data["evaluative_score"] == 65.0
        assert "feedback" in data
        assert data["feedback"]["literal"] is not None
        assert data["feedback"]["overall"] is not None

    @patch("app.routes.learning.learning_comprehension_score.evaluate_comprehension", new_callable=AsyncMock)
    def test_all_three_subscores_present(self, mock_eval, client, user_a):
        mock_eval.return_value = MOCK_GEMINI_SCORE
        session_id = _create_session(client, user_a["token"], "subscores")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert "literal_score" in data
        assert "inferential_score" in data
        assert "evaluative_score" in data

    @patch("app.routes.learning.learning_comprehension_score.evaluate_comprehension", new_callable=AsyncMock)
    def test_scores_in_valid_range(self, mock_eval, client, user_a):
        mock_eval.return_value = MOCK_GEMINI_SCORE
        session_id = _create_session(client, user_a["token"], "range")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        for key in ("comprehension_score", "literal_score", "inferential_score", "evaluative_score"):
            assert 0 <= data[key] <= 100, f"{key}={data[key]} out of range"

    @patch("app.routes.learning.learning_comprehension_score.evaluate_comprehension", new_callable=AsyncMock)
    def test_cached_scores_returned_without_recalling_gemini(self, mock_eval, client, user_a):
        mock_eval.return_value = MOCK_GEMINI_SCORE
        session_id = _create_session(client, user_a["token"], "cache-test")

        # First call — should call Gemini
        resp1 = client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header(user_a["token"]),
        )
        assert resp1.status_code == 200
        assert mock_eval.call_count == 1

        # Second call — should return cached, NOT call Gemini again
        resp2 = client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header(user_a["token"]),
        )
        assert resp2.status_code == 200
        assert mock_eval.call_count == 1  # Still 1, not 2

        # Verify same scores returned
        assert resp1.json()["comprehension_score"] == resp2.json()["comprehension_score"]

    def test_not_found_returns_404(self, client, user_a):
        resp = client.post(
            "/api/learning/sessions/999999/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Session not found"

    def test_other_users_session_returns_403(self, client, user_a, user_b):
        session_id = _create_session(client, user_b["token"], "owned-by-b")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Not your session"

    def test_requires_auth(self, client):
        resp = client.post(
            "/api/learning/sessions/1/comprehension-score",
            json=SCORE_REQUEST_BODY,
        )
        assert resp.status_code == 401

    def test_invalid_token_returns_401(self, client):
        resp = client.post(
            "/api/learning/sessions/1/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header("invalid.jwt.token"),
        )
        assert resp.status_code == 401

    @patch("app.routes.learning.learning_comprehension_score.evaluate_comprehension", new_callable=AsyncMock)
    def test_gemini_failure_returns_503(self, mock_eval, client, user_a):
        mock_eval.side_effect = RuntimeError("AI service error")
        session_id = _create_session(client, user_a["token"], "gemini-fail")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 503
        assert "unavailable" in resp.json()["detail"].lower()

    def test_empty_dialogue_returns_422(self, client, user_a):
        session_id = _create_session(client, user_a["token"], "empty-dialogue")
        body = {
            "story_title": "Test",
            "story_text": "Test story text.",
            "dialogue_turns": [],
        }
        resp = client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=body,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422

    def test_missing_story_title_returns_422(self, client, user_a):
        session_id = _create_session(client, user_a["token"], "missing-title")
        body = {
            "story_text": "Test story text.",
            "dialogue_turns": [{"role": "ai", "text": "Question?"}],
        }
        resp = client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=body,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422

    @patch("app.routes.learning.learning_comprehension_score.evaluate_comprehension", new_callable=AsyncMock)
    def test_scores_persisted_in_session_detail(self, mock_eval, client, user_a):
        """Verify that comprehension scores appear in the session detail response."""
        mock_eval.return_value = MOCK_GEMINI_SCORE
        session_id = _create_session(client, user_a["token"], "persist-check")

        # Score the session
        client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header(user_a["token"]),
        )

        # Fetch session detail
        resp = client.get(
            f"/api/learning/sessions/{session_id}",
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        assert data["comprehension_score"] == 75.0
        assert data["literal_score"] == 85.0
        assert data["inferential_score"] == 70.0
        assert data["evaluative_score"] == 65.0

    @patch("app.routes.learning.learning_comprehension_score.evaluate_comprehension", new_callable=AsyncMock)
    def test_feedback_structure(self, mock_eval, client, user_a):
        mock_eval.return_value = MOCK_GEMINI_SCORE
        session_id = _create_session(client, user_a["token"], "feedback-struct")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/comprehension-score",
            json=SCORE_REQUEST_BODY,
            headers=auth_header(user_a["token"]),
        )
        feedback = resp.json()["feedback"]
        assert "literal" in feedback
        assert "inferential" in feedback
        assert "evaluative" in feedback
        assert "overall" in feedback
