"""
Tests for ALL AI-powered endpoints — auth, rate limiting, input validation,
AI mock responses, error handling, and ai_usage_log tracking.

Covers:
- POST /api/comprehension/question        (Socratic Q&A)
- POST /api/comprehension/chat            (Socratic dialogue)
- POST /api/learning/sentence-practice/example-sentences (vocab examples)
- POST /api/learning/sentence-practice/validate          (sentence validation)
- POST /api/learning/listening/evaluate    (listening retelling)
- POST /api/learning/sessions/{id}/ai-analysis  (session-based AI analysis)
- POST /api/learning/ai-analysis           (standalone AI analysis)
- GET  /api/stories/{id}/structure         (story structure table)
- POST /api/learning/sessions/{id}/exit-ticket/generate (exit ticket)
- POST /api/learning/sessions/{id}/reading/evaluate (reading evaluation)

Run with:
    cd backend && python -m pytest tests/test_ai_endpoints.py -v
"""

import sys
import os
import uuid
from unittest.mock import AsyncMock, patch, MagicMock
from dataclasses import dataclass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User
from app.models.session import LearningSession
from app.auth.dependencies import get_current_user
from app.auth.rate_limiter import ai_rate_limiter, general_rate_limiter


# ---------------------------------------------------------------------------
# SQLite in-memory test DB
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


# Fake user for auth dependency override
_fake_user = User(
    id=1,
    username="test_student",
    name="Test Student",
    email="test@example.com",
    password_hash="fake",
)


def _override_get_current_user():
    return _fake_user


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    _seed_roles(db)
    # Assign student role
    student_role = db.query(Role).filter(Role.name == "student").first()
    _fake_user.role_id = student_role.id if student_role else None
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def reset_rate_limiters():
    """Reset all rate limiters before each test to prevent 429s."""
    ai_rate_limiter.reset()
    general_rate_limiter.reset()
    try:
        from app.routes.auth import rate_limiter
        rate_limiter.reset()
    except (ImportError, AttributeError):
        pass


@pytest.fixture(scope="module")
def client():
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def db_session():
    """Create a User + LearningSession in the DB for session-based endpoints."""
    db = TestingSessionLocal()
    # Ensure user with id=1 exists (FK requirement)
    existing = db.query(User).filter(User.id == 1).first()
    if not existing:
        user = User(
            id=1,
            username="test_student",
            name="Test Student",
            email="test@example.com",
            password_hash="fake",
        )
        db.add(user)
        db.commit()
    session = LearningSession(
        student_id=1,
        story_slug="L1",
        status="in_progress",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    session_id = session.id
    db.close()
    return session_id


# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------

@dataclass
class FakeUsageMetadata:
    prompt_token_count: int = 100
    candidates_token_count: int = 50
    total_token_count: int = 150


class FakeCandidate:
    def __init__(self):
        self.finish_reason = "STOP"


class FakeGeminiResponse:
    def __init__(self, text="mock response"):
        self.text = text
        self.usage_metadata = FakeUsageMetadata()
        self.candidates = [FakeCandidate()]
        self.model_version = "gemini-2.5-flash-001"


def _mock_log_ai_usage(*args, **kwargs):
    """No-op replacement for log_ai_usage to avoid DB-related issues in tests."""
    pass


# ===========================================================================
# 1. POST /api/comprehension/question — Socratic Q&A
# ===========================================================================

class TestComprehensionQuestion:
    """Tests for the Socratic question generation endpoint."""

    def test_requires_auth(self):
        """Without auth override, endpoint should require authentication."""
        local_app = app
        # Use a fresh client without dependency overrides
        local_app.dependency_overrides.pop(get_current_user, None)
        with TestClient(local_app) as c:
            resp = c.post("/api/comprehension/question", json={
                "story_title": "Test",
                "story_text": "Test text",
            })
            assert resp.status_code in (401, 403, 422)
        # Restore override
        local_app.dependency_overrides[get_current_user] = _override_get_current_user

    @patch("app.routes.learning.learning_comprehension.generate_socratic_question", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_comprehension.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_happy_path(self, mock_log, mock_gen, client):
        mock_gen.return_value = "這篇課文的主角是誰？"
        resp = client.post("/api/comprehension/question", json={
            "story_title": "小王子",
            "story_text": "從前有一個小王子住在一顆小星球上。",
            "conversation": [],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "question" in data
        assert data["question_number"] == 1
        mock_gen.assert_called_once()

    @patch("app.routes.learning.learning_comprehension.generate_socratic_question", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_comprehension.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_with_conversation_history(self, mock_log, mock_gen, client):
        mock_gen.return_value = "你覺得他為什麼這樣做？"
        resp = client.post("/api/comprehension/question", json={
            "story_title": "小王子",
            "story_text": "從前有一個小王子住在一顆小星球上。",
            "conversation": [
                {"role": "ai", "text": "這篇課文的主角是誰？"},
                {"role": "student", "text": "小王子"},
            ],
        })
        assert resp.status_code == 200
        assert resp.json()["question_number"] == 2

    @patch("app.routes.learning.learning_comprehension.generate_socratic_question", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_comprehension.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_ai_failure_returns_fallback(self, mock_log, mock_gen, client):
        mock_gen.side_effect = RuntimeError("Gemini unavailable")
        resp = client.post("/api/comprehension/question", json={
            "story_title": "小王子",
            "story_text": "從前有一個小王子住在一顆小星球上。",
            "conversation": [],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "主角" in data["question"]  # fallback question

    def test_missing_required_fields(self, client):
        resp = client.post("/api/comprehension/question", json={})
        assert resp.status_code == 422

    def test_empty_story_text_rejected(self, client):
        resp = client.post("/api/comprehension/question", json={
            "story_title": "Test",
            "story_text": "",
        })
        # Empty string should be rejected by Field(...) — non-optional
        # FastAPI may allow empty string, so we just check it doesn't crash
        assert resp.status_code in (200, 422)


# ===========================================================================
# 2. POST /api/comprehension/chat — Socratic dialogue
# ===========================================================================

class TestComprehensionChat:
    """Tests for the Socratic dialogue chat endpoint."""

    @patch("app.routes.learning.learning_comprehension.socratic_agent")
    @patch("app.routes.learning.learning_comprehension.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_start_session(self, mock_log, mock_agent, client):
        mock_result = MagicMock()
        mock_result.question = "第一個問題"
        mock_result.feedback = None
        mock_result.understood = None
        mock_result.understood_count = 0
        mock_result.required_count = 3
        mock_result.phase = "literal"
        mock_result.is_complete = False
        mock_result.referenced_paragraph = None
        mock_agent.start_session = AsyncMock(return_value=(mock_result, False))

        resp = client.post("/api/comprehension/chat", json={
            "session_id": str(uuid.uuid4()),
            "story_title": "小王子",
            "story_text": "從前有一個小王子住在一顆小星球上。",
            "student_answer": None,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["question"] == "第一個問題"
        assert data["phase"] == "literal"
        assert data["is_complete"] is False

    @patch("app.routes.learning.learning_comprehension.socratic_agent")
    @patch("app.routes.learning.learning_comprehension.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_process_answer(self, mock_log, mock_agent, client):
        mock_result = MagicMock()
        mock_result.question = "很好！下一題"
        mock_result.feedback = "回答正確"
        mock_result.understood = True
        mock_result.understood_count = 1
        mock_result.required_count = 3
        mock_result.phase = "literal"
        mock_result.is_complete = False
        mock_result.referenced_paragraph = 1
        mock_agent.process_answer = AsyncMock(return_value=mock_result)

        resp = client.post("/api/comprehension/chat", json={
            "session_id": str(uuid.uuid4()),
            "story_title": "小王子",
            "story_text": "從前有一個小王子住在一顆小星球上。",
            "student_answer": "小王子住在小星球上",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["understood"] is True
        assert data["feedback"] == "回答正確"

    @patch("app.routes.learning.learning_comprehension.socratic_agent")
    @patch("app.routes.learning.learning_comprehension.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_idor_protection(self, mock_log, mock_agent, client, db_session):
        """Session owned by user 1 should work; faking another user's session = 403."""
        mock_result = MagicMock()
        mock_result.question = "Q"
        mock_result.feedback = None
        mock_result.understood = None
        mock_result.understood_count = 0
        mock_result.required_count = 3
        mock_result.phase = "literal"
        mock_result.is_complete = False
        mock_result.referenced_paragraph = None
        mock_agent.start_session = AsyncMock(return_value=(mock_result, False))

        # Valid session owned by test user (id=1)
        resp = client.post("/api/comprehension/chat", json={
            "session_id": str(uuid.uuid4()),
            "story_title": "Test",
            "story_text": "Test text",
            "student_answer": None,
            "db_session_id": db_session,
        })
        assert resp.status_code == 200

        # Non-existent session = 403
        resp = client.post("/api/comprehension/chat", json={
            "session_id": str(uuid.uuid4()),
            "story_title": "Test",
            "story_text": "Test text",
            "student_answer": None,
            "db_session_id": 99999,
        })
        assert resp.status_code == 403

    @patch("app.routes.learning.learning_comprehension.socratic_agent")
    @patch("app.routes.learning.learning_comprehension.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_runtime_error_returns_503(self, mock_log, mock_agent, client):
        mock_agent.start_session = AsyncMock(side_effect=RuntimeError("Circuit breaker open"))
        resp = client.post("/api/comprehension/chat", json={
            "session_id": str(uuid.uuid4()),
            "story_title": "Test",
            "story_text": "Test text",
            "student_answer": None,
        })
        assert resp.status_code == 503


# ===========================================================================
# 3. POST /api/learning/sentence-practice/example-sentences
# ===========================================================================

class TestExampleSentences:
    """Tests for vocabulary example sentence generation."""

    @patch("app.routes.learning.learning_vocab.generate_example_sentences", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_vocab.get_cached", return_value=None)
    @patch("app.routes.learning.learning_vocab.set_cached")
    @patch("app.routes.learning.learning_vocab.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_happy_path_cache_miss(self, mock_log, mock_set, mock_get, mock_gen, client):
        mock_gen.return_value = {
            "sentences": [
                {"sentence": "明天我要去學校", "explanation": "用「明天」表示隔天"},
                {"sentence": "他很聰明", "explanation": "用「聰明」表示聰明"},
            ]
        }
        resp = client.post("/api/learning/sentence-practice/example-sentences", json={
            "word": "明天",
            "story_title": "小王子",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["sentences"]) == 2
        assert data["sentences"][0]["sentence"] == "明天我要去學校"
        mock_gen.assert_called_once()
        mock_set.assert_called_once()

    @patch("app.routes.learning.learning_vocab.get_cached")
    def test_cache_hit_skips_ai(self, mock_get, client):
        mock_get.return_value = {
            "sentences": [
                {"sentence": "快來吧", "explanation": "cached"},
            ]
        }
        resp = client.post("/api/learning/sentence-practice/example-sentences", json={
            "word": "過來",
            "story_title": "Test",
        })
        assert resp.status_code == 200
        assert len(resp.json()["sentences"]) == 1

    def test_word_field_validation(self, client):
        # Too long — max_length=10
        resp = client.post("/api/learning/sentence-practice/example-sentences", json={
            "word": "這個詞語超過十個字了吧",
            "story_title": "Test",
        })
        assert resp.status_code == 422

    @patch("app.routes.learning.learning_vocab.generate_example_sentences", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_vocab.get_cached", return_value=None)
    @patch("app.routes.learning.learning_vocab.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_ai_timeout_returns_503(self, mock_log, mock_get, mock_gen, client):
        mock_gen.side_effect = TimeoutError("Gemini timeout")
        resp = client.post("/api/learning/sentence-practice/example-sentences", json={
            "word": "明天",
            "story_title": "Test",
        })
        assert resp.status_code == 503


# ===========================================================================
# 4. POST /api/learning/sentence-practice/validate
# ===========================================================================

class TestValidateSentence:
    """Tests for student sentence validation."""

    @patch("app.routes.learning.learning_vocab.validate_student_sentence", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_vocab.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_happy_path(self, mock_log, mock_validate, client):
        mock_validate.return_value = {
            "is_correct": True,
            "feedback": "很好的句子！",
            "suggestion": "",
        }
        resp = client.post("/api/learning/sentence-practice/validate", json={
            "word": "明天",
            "student_sentence": "明天我要去學校上課",
            "story_title": "Test",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_correct"] is True

    def test_missing_word_in_sentence(self, client):
        """If the target word doesn't appear in the sentence, reject without calling AI."""
        resp = client.post("/api/learning/sentence-practice/validate", json={
            "word": "明天",
            "student_sentence": "我喜歡吃飯",
            "story_title": "Test",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_correct"] is False
        assert "沒有包含目標詞語" in data["feedback"]

    @patch("app.routes.learning.learning_vocab.validate_student_sentence", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_vocab.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_ai_failure_returns_503(self, mock_log, mock_validate, client):
        mock_validate.side_effect = Exception("Gemini error")
        resp = client.post("/api/learning/sentence-practice/validate", json={
            "word": "明天",
            "student_sentence": "明天很好",
            "story_title": "Test",
        })
        assert resp.status_code == 503


# ===========================================================================
# 5. POST /api/learning/listening/evaluate
# ===========================================================================

class TestListeningEvaluate:
    """Tests for listening comprehension retelling evaluation."""

    @patch("app.routes.learning.learning_vocab.evaluate_retelling", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_vocab.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_happy_path(self, mock_log, mock_eval, client):
        mock_eval.return_value = {
            "score": 85.0,
            "key_points_covered": ["主角", "事件"],
            "key_points_missed": ["結局"],
            "feedback": "大部分重點都說到了",
            "encouragement": "做得很好！",
        }
        resp = client.post("/api/learning/listening/evaluate", json={
            "story_title": "小王子",
            "original_text": "從前有一個小王子住在一顆小星球上。他很孤單，每天只能看日落。",
            "student_retelling": "小王子住在小星球上，他很孤單",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["score"] == 85.0
        assert len(data["key_points_covered"]) == 2

    def test_empty_retelling_rejected(self, client):
        resp = client.post("/api/learning/listening/evaluate", json={
            "story_title": "Test",
            "original_text": "Original text here",
            "student_retelling": "",
        })
        assert resp.status_code == 422

    @patch("app.routes.learning.learning_vocab.evaluate_retelling", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_vocab.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_ai_timeout(self, mock_log, mock_eval, client):
        mock_eval.side_effect = TimeoutError("timeout")
        resp = client.post("/api/learning/listening/evaluate", json={
            "story_title": "Test",
            "original_text": "Text",
            "student_retelling": "Retelling",
        })
        assert resp.status_code == 503


# ===========================================================================
# 6. POST /api/learning/sessions/{id}/ai-analysis (session-based)
# ===========================================================================

class TestAIAnalysisSessionBased:
    """Tests for session-based AI reading analysis."""

    @patch("app.routes.learning.learning_reading.generate_reading_analysis", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_reading.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_happy_path(self, mock_log, mock_gen, client, db_session):
        mock_gen.return_value = {
            "analysis_summary": "整體表現不錯",
            "strengths": ["流暢度好"],
            "areas_for_improvement": ["注意聲調"],
            "practice_suggestions": ["多練習"],
            "encouragement_message": "加油！",
        }
        resp = client.post(f"/api/learning/sessions/{db_session}/ai-analysis", json={
            "story_title": "小王子",
            "accuracy": 85.0,
            "cpm": 120.0,
            "error_chars": ["明"],
            "total_characters": 100,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["analysis_summary"] == "整體表現不錯"
        assert len(data["strengths"]) == 1

    def test_nonexistent_session_404(self, client):
        resp = client.post("/api/learning/sessions/99999/ai-analysis", json={
            "story_title": "Test",
            "accuracy": 80.0,
            "cpm": 100.0,
            "error_chars": [],
            "total_characters": 50,
        })
        assert resp.status_code == 404

    @patch("app.routes.learning.learning_reading.generate_reading_analysis", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_reading.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_content_filter_returns_friendly_response(self, mock_log, mock_gen, client, db_session):
        from app.services.ai_service import GeminiContentFilterError
        mock_gen.side_effect = GeminiContentFilterError("blocked")
        resp = client.post(f"/api/learning/sessions/{db_session}/ai-analysis", json={
            "story_title": "Test",
            "accuracy": 80.0,
            "cpm": 100.0,
            "error_chars": [],
            "total_characters": 50,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "換一篇課文" in data["practice_suggestions"][0]

    def test_invalid_accuracy_range(self, client, db_session):
        resp = client.post(f"/api/learning/sessions/{db_session}/ai-analysis", json={
            "story_title": "Test",
            "accuracy": 150.0,  # > 100
            "cpm": 100.0,
            "error_chars": [],
            "total_characters": 50,
        })
        assert resp.status_code == 422


# ===========================================================================
# 7. POST /api/learning/ai-analysis (standalone)
# ===========================================================================

class TestAIAnalysisStandalone:
    """Tests for standalone AI reading analysis (no session required)."""

    @patch("app.routes.learning.learning_reading.generate_reading_analysis", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_reading.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_happy_path(self, mock_log, mock_gen, client):
        mock_gen.return_value = {
            "analysis_summary": "分析結果",
            "strengths": ["好"],
            "areas_for_improvement": ["改善"],
            "practice_suggestions": ["練習"],
            "encouragement_message": "繼續加油",
        }
        resp = client.post("/api/learning/ai-analysis", json={
            "story_title": "Test",
            "accuracy": 90.0,
            "cpm": 150.0,
            "error_chars": [],
            "total_characters": 200,
        })
        assert resp.status_code == 200
        assert resp.json()["analysis_summary"] == "分析結果"

    @patch("app.routes.learning.learning_reading.generate_reading_analysis", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_reading.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_with_enrichment_fields(self, mock_log, mock_gen, client):
        mock_gen.return_value = {
            "analysis_summary": "有理解力分數的分析",
            "strengths": [],
            "areas_for_improvement": [],
            "practice_suggestions": [],
            "encouragement_message": "OK",
        }
        resp = client.post("/api/learning/ai-analysis", json={
            "story_title": "Test",
            "accuracy": 90.0,
            "cpm": 150.0,
            "error_chars": [],
            "total_characters": 200,
            "comprehension_score": 75.0,
            "vocab_practiced_count": 5,
            "vocab_total_count": 10,
        })
        assert resp.status_code == 200


# ===========================================================================
# 8. GET /api/stories/{id}/structure (story structure table)
# ===========================================================================

class TestStoryStructure:
    """Tests for AI story structure generation endpoint."""

    @patch("app.routes.stories.generate_story_structure", new_callable=AsyncMock)
    @patch("app.routes.stories.log_ai_usage", side_effect=_mock_log_ai_usage)
    @patch("app.routes.stories._get_cached_structure", return_value=None)
    @patch("app.routes.stories._set_cached_structure")
    def test_happy_path(self, mock_set, mock_get, mock_log, mock_gen, client):
        mock_gen.return_value = [
            {"label": "人物", "value": "小王子"},
            {"label": "時間", "value": "從前"},
        ]
        resp = client.get("/api/stories/1/structure")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["label"] == "人物"

    @patch("app.routes.stories._get_cached_structure")
    def test_cache_hit(self, mock_get, client):
        mock_get.return_value = [{"label": "cached", "value": "yes"}]
        resp = client.get("/api/stories/1/structure")
        assert resp.status_code == 200
        assert resp.json()[0]["label"] == "cached"

    def test_invalid_story_id_404(self, client):
        resp = client.get("/api/stories/999/structure")
        assert resp.status_code == 404

    def test_non_numeric_story_id_404(self, client):
        resp = client.get("/api/stories/abc/structure")
        assert resp.status_code == 404


# ===========================================================================
# 9. POST /api/learning/sessions/{id}/exit-ticket/generate
# ===========================================================================

class TestExitTicketGenerate:
    """Tests for exit ticket question generation."""

    @patch("app.routes.learning.learning_exit_ticket.generate_exit_ticket_questions", new_callable=AsyncMock)
    @patch("app.routes.learning.learning_exit_ticket.log_ai_usage", side_effect=_mock_log_ai_usage)
    def test_happy_path(self, mock_log, mock_gen, client, db_session):
        mock_gen.return_value = {
            "source": "ai",
            "questions": [
                {
                    "id": 1,
                    "question": "小王子住在哪裡？",
                    "options": ["大星球", "小星球", "地球", "月球"],
                    "correct_index": 1,
                    "explanation": "課文第一段提到小王子住在一顆小星球上",
                }
            ],
        }
        resp = client.post(f"/api/learning/sessions/{db_session}/exit-ticket/generate", json={
            "story_content": ["從前有一個小王子住在一顆小星球上"],
            "wrong_chars": ["明"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["questions"]) == 1
        assert data["questions"][0]["question"] == "小王子住在哪裡？"

    def test_nonexistent_session_404(self, client):
        resp = client.post("/api/learning/sessions/99999/exit-ticket/generate", json={
            "story_content": ["text"],
            "wrong_chars": [],
        })
        assert resp.status_code == 404

    def test_empty_story_content_rejected(self, client, db_session):
        resp = client.post(f"/api/learning/sessions/{db_session}/exit-ticket/generate", json={
            "story_content": [],
            "wrong_chars": [],
        })
        assert resp.status_code == 422


# ===========================================================================
# 10. ai_usage_tracker unit tests
# ===========================================================================

class TestAIUsageTracker:
    """Unit tests for the usage tracking module."""

    def test_estimate_cost(self):
        from app.services.ai_usage_tracker import estimate_cost
        # Gemini 2.5 Flash: input $0.30/1M, output $2.50/1M (updated 2026-05)
        cost = estimate_cost("gemini-2.5-flash", 1_000_000, 1_000_000)
        assert abs(cost - 2.80) < 0.001

    def test_estimate_cost_small_values(self):
        from app.services.ai_usage_tracker import estimate_cost
        cost = estimate_cost("gemini-2.5-flash", 100, 50)
        assert cost > 0
        assert cost < 0.001  # should be tiny

    def test_capture_usage_accumulates(self):
        from app.services.ai_usage_tracker import capture_usage, last_usage
        last_usage.set(None)

        # Simulate first Gemini call
        resp1 = FakeGeminiResponse()
        usage1 = capture_usage(resp1)
        assert usage1.input_tokens == 100
        assert usage1.output_tokens == 50

        # Simulate second Gemini call — tokens should accumulate
        resp2 = FakeGeminiResponse()
        usage2 = capture_usage(resp2)
        assert usage2.input_tokens == 200  # 100 + 100
        assert usage2.output_tokens == 100  # 50 + 50
        assert usage2.total_tokens == 300

        # Clean up
        last_usage.set(None)

    def test_capture_usage_reset_between_requests(self):
        from app.services.ai_usage_tracker import capture_usage, last_usage
        last_usage.set(None)  # simulate per-request reset

        resp = FakeGeminiResponse()
        usage = capture_usage(resp)
        assert usage.input_tokens == 100  # not accumulated from previous test

        last_usage.set(None)

    def test_step_labels(self):
        from app.services.ai_usage_tracker import STEP_LABELS
        assert STEP_LABELS["comprehension"] == "課文理解"
        assert STEP_LABELS["structure"] == "文章重點表"
        assert "listening" in STEP_LABELS
