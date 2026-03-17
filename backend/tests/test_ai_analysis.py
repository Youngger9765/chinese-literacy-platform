"""
Tests for AI reading analysis endpoints.

Covers:
- POST /api/learning/sessions/{id}/ai-analysis  (session-based with caching)
- POST /api/learning/ai-analysis                 (standalone)
- 404 for invalid session
- 403 for other user's session
- Cached analysis returned without re-calling Gemini
- Response schema validation

Uses SQLite in-memory DB. Mocks the Gemini AI call.
"""

import json
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

MOCK_ANALYSIS = {
    "analysis_summary": "你的朗讀表現整體不錯，正確率達 85%，速度適中。",
    "strengths": ["發音清晰", "語速穩定"],
    "areas_for_improvement": ["注意多音字的讀法"],
    "practice_suggestions": [
        "每天朗讀 10 分鐘",
        "針對錯字反覆練習",
        "試著用更有感情的語調朗讀",
    ],
    "encouragement_message": "你已經很棒了，繼續加油！",
}

ANALYSIS_PAYLOAD = {
    "story_title": "玉山之美",
    "accuracy": 85.0,
    "cpm": 120.0,
    "error_chars": ["山", "雪"],
    "total_characters": 200,
}


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Reset AI rate limiter before each test to avoid 429s."""
    from app.auth.rate_limiter import ai_rate_limiter
    ai_rate_limiter.reset()


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


def _register_user(client, suffix: str | None = None) -> dict:
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"ai_user_{unique}@example.com"
    password = "SecurePass123!"
    name = f"AI User {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201, resp.text
    verification_token = resp.json()["verification_token"]

    resp = client.post("/api/auth/verify-email", json={
        "token": verification_token,
    })
    assert resp.status_code == 200, resp.text

    resp = client.post("/api/auth/login", json={
        "email": email,
        "password": password,
    })
    assert resp.status_code == 200, resp.text
    return {
        "email": email,
        "password": password,
        "name": name,
        "token": resp.json()["access_token"],
    }


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def user_a(client):
    return _register_user(client, "ai_a")


@pytest.fixture(scope="module")
def user_b(client):
    return _register_user(client, "ai_b")


def _create_session(client, token: str, slug: str = "ai-test") -> int:
    resp = client.post(
        "/api/learning/sessions",
        json={"story_slug": slug},
        headers=auth_header(token),
    )
    assert resp.status_code == 201
    return resp.json()["id"]


# ===========================================================================
# POST /api/learning/sessions/{id}/ai-analysis — Session-based
# ===========================================================================


class TestSessionBasedAIAnalysis:
    @patch("app.routes.learning.generate_reading_analysis", new_callable=AsyncMock)
    def test_returns_analysis_for_valid_session(self, mock_gen, client, user_a):
        mock_gen.return_value = MOCK_ANALYSIS
        session_id = _create_session(client, user_a["token"], "analysis-valid")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["analysis_summary"] == MOCK_ANALYSIS["analysis_summary"]
        assert data["strengths"] == MOCK_ANALYSIS["strengths"]
        assert data["areas_for_improvement"] == MOCK_ANALYSIS["areas_for_improvement"]
        assert data["practice_suggestions"] == MOCK_ANALYSIS["practice_suggestions"]
        assert data["encouragement_message"] == MOCK_ANALYSIS["encouragement_message"]
        mock_gen.assert_called_once()

    @patch("app.routes.learning.generate_reading_analysis", new_callable=AsyncMock)
    def test_cached_analysis_returned_without_calling_gemini(self, mock_gen, client, user_a):
        mock_gen.return_value = MOCK_ANALYSIS
        session_id = _create_session(client, user_a["token"], "analysis-cache")

        # First call — generates and caches
        resp1 = client.post(
            f"/api/learning/sessions/{session_id}/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        assert resp1.status_code == 200
        assert mock_gen.call_count == 1

        # Second call — should return cached, no additional Gemini call
        resp2 = client.post(
            f"/api/learning/sessions/{session_id}/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        assert resp2.status_code == 200
        assert resp2.json() == resp1.json()
        # Still only 1 call — the second hit the cache
        assert mock_gen.call_count == 1

    def test_404_for_invalid_session(self, client, user_a):
        resp = client.post(
            "/api/learning/sessions/999999/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Session not found"

    def test_403_for_other_users_session(self, client, user_a, user_b):
        session_id = _create_session(client, user_b["token"], "analysis-forbidden")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Not your session"

    def test_401_without_auth(self, client):
        resp = client.post(
            "/api/learning/sessions/1/ai-analysis",
            json=ANALYSIS_PAYLOAD,
        )
        assert resp.status_code == 401

    @patch("app.routes.learning.generate_reading_analysis", new_callable=AsyncMock)
    def test_response_schema(self, mock_gen, client, user_a):
        mock_gen.return_value = MOCK_ANALYSIS
        session_id = _create_session(client, user_a["token"], "analysis-schema")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        # Verify all required fields exist and have correct types
        assert isinstance(data["analysis_summary"], str)
        assert isinstance(data["strengths"], list)
        assert isinstance(data["areas_for_improvement"], list)
        assert isinstance(data["practice_suggestions"], list)
        assert isinstance(data["encouragement_message"], str)
        assert len(data["strengths"]) > 0
        assert len(data["practice_suggestions"]) > 0

    @patch("app.routes.learning.generate_reading_analysis", new_callable=AsyncMock)
    def test_503_when_gemini_fails(self, mock_gen, client, user_a):
        mock_gen.side_effect = RuntimeError("Gemini connection error")
        session_id = _create_session(client, user_a["token"], "analysis-503")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 503
        assert "AI service" in resp.json()["detail"]

    @patch("app.routes.learning.generate_reading_analysis", new_callable=AsyncMock)
    def test_503_on_timeout(self, mock_gen, client, user_a):
        mock_gen.side_effect = TimeoutError("AI response timeout (30s)")
        session_id = _create_session(client, user_a["token"], "analysis-timeout")

        resp = client.post(
            f"/api/learning/sessions/{session_id}/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 503
        assert "timeout" in resp.json()["detail"].lower()


# ===========================================================================
# POST /api/learning/ai-analysis — Standalone
# ===========================================================================


class TestStandaloneAIAnalysis:
    @patch("app.routes.learning.generate_reading_analysis", new_callable=AsyncMock)
    def test_standalone_returns_analysis(self, mock_gen, client, user_a):
        mock_gen.return_value = MOCK_ANALYSIS

        resp = client.post(
            "/api/learning/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["analysis_summary"] == MOCK_ANALYSIS["analysis_summary"]
        assert data["strengths"] == MOCK_ANALYSIS["strengths"]
        mock_gen.assert_called_once()

    def test_standalone_401_without_auth(self, client):
        resp = client.post(
            "/api/learning/ai-analysis",
            json=ANALYSIS_PAYLOAD,
        )
        assert resp.status_code == 401

    @patch("app.routes.learning.generate_reading_analysis", new_callable=AsyncMock)
    def test_standalone_503_when_gemini_fails(self, mock_gen, client, user_a):
        mock_gen.side_effect = RuntimeError("Gemini unavailable")

        resp = client.post(
            "/api/learning/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 503

    def test_standalone_422_invalid_accuracy(self, client, user_a):
        bad_payload = {**ANALYSIS_PAYLOAD, "accuracy": 150.0}
        resp = client.post(
            "/api/learning/ai-analysis",
            json=bad_payload,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422

    def test_standalone_422_missing_required_field(self, client, user_a):
        incomplete = {"accuracy": 85.0}
        resp = client.post(
            "/api/learning/ai-analysis",
            json=incomplete,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 422

    @patch("app.routes.learning.generate_reading_analysis", new_callable=AsyncMock)
    def test_standalone_response_schema(self, mock_gen, client, user_a):
        mock_gen.return_value = MOCK_ANALYSIS

        resp = client.post(
            "/api/learning/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(user_a["token"]),
        )
        data = resp.json()
        expected_keys = {
            "analysis_summary", "strengths", "areas_for_improvement",
            "practice_suggestions", "encouragement_message",
        }
        assert set(data.keys()) == expected_keys

    @patch("app.routes.learning.generate_reading_analysis", new_callable=AsyncMock)
    def test_standalone_accepts_comprehension_and_vocab_data(self, mock_gen, client, user_a):
        """Issue #415: AI analysis should accept optional comprehension and vocab data."""
        mock_gen.return_value = MOCK_ANALYSIS

        rich_payload = {
            **ANALYSIS_PAYLOAD,
            "comprehension_score": 78.0,
            "vocab_practiced_count": 5,
            "vocab_total_count": 8,
            "dictation_correct_count": 6,
            "dictation_total_count": 8,
        }
        resp = client.post(
            "/api/learning/ai-analysis",
            json=rich_payload,
            headers=auth_header(user_a["token"]),
        )
        assert resp.status_code == 200
        # Verify the extra fields were passed through to generate_reading_analysis
        call_kwargs = mock_gen.call_args[0][0]
        assert call_kwargs.get("comprehension_score") == 78.0
        assert call_kwargs.get("vocab_practiced_count") == 5
        assert call_kwargs.get("vocab_total_count") == 8


# ===========================================================================
# generate_reading_analysis — enriched prompt (Issue #415)
# ===========================================================================


class TestGenerateReadingAnalysisEnrichedPrompt:
    """Tests that the AI service includes comprehension/vocab data in the prompt."""

    @patch("app.services.ai_service.generate_structured_response", new_callable=AsyncMock)
    def test_prompt_includes_comprehension_score_when_provided(self, mock_structured):
        """Issue #415: comprehension_score should appear in the AI prompt."""
        import asyncio
        from app.services.ai_service import generate_reading_analysis

        mock_structured.return_value = {
            "analysis_summary": "Test",
            "strengths": ["Good"],
            "areas_for_improvement": ["Work harder"],
            "practice_suggestions": ["Practice daily"],
            "encouragement_message": "Keep going!",
        }

        session_data = {
            "story_title": "Test Story",
            "accuracy": 80.0,
            "cpm": 100.0,
            "error_chars": [],
            "total_characters": 150,
            "comprehension_score": 75.0,
        }

        asyncio.get_event_loop().run_until_complete(generate_reading_analysis(session_data))

        # The system_prompt passed to generate_structured_response should mention comprehension
        call_args = mock_structured.call_args
        system_prompt = call_args[1].get("system_prompt") or call_args[0][0]
        user_content = str(call_args)
        assert "75" in user_content  # comprehension score appears somewhere in the call

    @patch("app.services.ai_service.generate_structured_response", new_callable=AsyncMock)
    def test_prompt_works_without_optional_fields(self, mock_structured):
        """Issue #415: analysis should still work with only reading data."""
        import asyncio
        from app.services.ai_service import generate_reading_analysis

        mock_structured.return_value = {
            "analysis_summary": "Test",
            "strengths": ["Good"],
            "areas_for_improvement": ["Work harder"],
            "practice_suggestions": ["Practice daily"],
            "encouragement_message": "Keep going!",
        }

        session_data = {
            "story_title": "Test Story",
            "accuracy": 80.0,
            "cpm": 100.0,
            "error_chars": [],
            "total_characters": 150,
            # No comprehension_score, vocab data, etc.
        }

        result = asyncio.get_event_loop().run_until_complete(
            generate_reading_analysis(session_data)
        )
        assert result["analysis_summary"] == "Test"
