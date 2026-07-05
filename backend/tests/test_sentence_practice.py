"""
Tests for sentence practice API endpoints (Issue #109, #927).

Covers:
- POST /api/learning/sentence-practice/example-sentences
- POST /api/learning/sentence-practice/validate

Uses SQLite in-memory DB. AI calls are mocked via unittest.mock.

Run with:
    cd backend
    python -m pytest tests/test_sentence_practice.py -v
"""

import sys
import os
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
from app.auth.rate_limiter import ai_limit_10_per_min, ai_limit_5_per_min

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


@pytest.fixture(scope="module")
def db_engine():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        for role_data in SEED_ROLES:
            conn.execute(
                Role.__table__.insert().prefix_with("OR IGNORE"),
                role_data,
            )
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session(db_engine):
    connection = db_engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    async def _no_rate_limit():
        pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[ai_limit_10_per_min] = _no_rate_limit
    app.dependency_overrides[ai_limit_5_per_min] = _no_rate_limit
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_student_and_login(client: TestClient) -> str:
    """Create a user directly in the DB (bypasses self-reg restriction and email verification).

    Students cannot self-register since issue #457 — they're created by teachers.
    We insert the user directly into the test DB with email_verified=True.
    The sentence practice endpoint only requires a valid authenticated user, not a specific role.
    """
    import uuid
    from app.auth.password import hash_password
    from app.models.user import User as UserModel

    unique = uuid.uuid4().hex[:8]
    email = f"testuser_{unique}@example.com"
    password = "TestPass123!"

    db = TestingSessionLocal()
    try:
        user = UserModel(
            email=email,
            password_hash=hash_password(password),
            name=f"Test User {unique}",
            email_verified=True,
            is_active=True,
        )
        db.add(user)
        db.commit()
    finally:
        db.close()

    login_res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_res.status_code == 200, f"Login failed: {login_res.text}"
    return login_res.json()["access_token"]


# ---------------------------------------------------------------------------
# Tests: example-sentences endpoint
# ---------------------------------------------------------------------------

class TestExampleSentences:
    def test_example_sentences_returns_two_sentences(self, client: TestClient):
        """Endpoint returns exactly 2 example sentences for a valid word."""
        token = _create_student_and_login(client)
        mock_result = {
            "sentences": [
                {"sentence": "老師講述這個故事的來源。", "explanation": "來源：事物的起點或出處"},
                {"sentence": "這首歌的靈感來源於童年。", "explanation": "來源：靈感的起點"},
            ]
        }
        with patch(
            "app.routes.learning.learning_vocab.generate_example_sentences",
            new=AsyncMock(return_value=mock_result),
        ):
            res = client.post(
                "/api/learning/sentence-practice/example-sentences",
                json={"word": "來源", "story_title": "測試課文"},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 200
        data = res.json()
        assert "sentences" in data
        assert len(data["sentences"]) == 2
        for s in data["sentences"]:
            assert "sentence" in s
            assert "explanation" in s

    def test_example_sentences_requires_auth(self, client: TestClient):
        """Without auth token, endpoint returns 401 or 403."""
        with patch(
            "app.routes.learning.learning_vocab.generate_example_sentences",
            new=AsyncMock(return_value={"sentences": []}),
        ):
            res = client.post(
                "/api/learning/sentence-practice/example-sentences",
                json={"word": "來源", "story_title": "課文"},
            )
        assert res.status_code in (401, 403)

    def test_example_sentences_rejects_too_long_word(self, client: TestClient):
        """Endpoint rejects word field exceeding max_length=10."""
        token = _create_student_and_login(client)
        res = client.post(
            "/api/learning/sentence-practice/example-sentences",
            json={"word": "這個詞語超過十個字了吧", "story_title": "課文"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 422

    def test_example_sentences_accepts_multi_char_word(self, client: TestClient):
        """Endpoint accepts multi-character vocabulary words (Issue #927)."""
        token = _create_student_and_login(client)
        mock_result = {
            "sentences": [
                {"sentence": "他面對危險時非常沉著。", "explanation": "沉著：冷靜穩重"},
                {"sentence": "考試時要保持沉著的態度。", "explanation": "沉著：不慌張"},
            ]
        }
        with patch(
            "app.routes.learning.learning_vocab.generate_example_sentences",
            new=AsyncMock(return_value=mock_result),
        ):
            res = client.post(
                "/api/learning/sentence-practice/example-sentences",
                json={"word": "沉著", "story_title": "測試課文"},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 200
        assert len(res.json()["sentences"]) == 2

    def test_example_sentences_handles_ai_timeout(self, client: TestClient):
        """Returns 503 when AI service times out."""
        token = _create_student_and_login(client)
        with patch(
            "app.routes.learning.learning_vocab.generate_example_sentences",
            new=AsyncMock(side_effect=TimeoutError("AI timeout")),
        ):
            res = client.post(
                "/api/learning/sentence-practice/example-sentences",
                json={"word": "來源", "story_title": "課文"},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 503

    def test_example_sentences_ai_path_returns_source_ai(self, client: TestClient):
        """When AI generates sentences in real-time, response includes source='ai'. (Issue #836)"""
        token = _create_student_and_login(client)
        mock_result = {
            "sentences": [
                {"sentence": "河流源源不絕地流著。", "explanation": "源：水流的起點"},
                {"sentence": "這個想法來源於大自然。", "explanation": "源：事物的根本"},
            ]
        }
        # Use a unique story title to guarantee cache miss
        unique_story = "測試課文_issue836_ai"
        with patch(
            "app.routes.learning.learning_vocab.get_cached",
            return_value=None,
        ), patch(
            "app.routes.learning.learning_vocab.generate_example_sentences",
            new=AsyncMock(return_value=mock_result),
        ), patch(
            "app.routes.learning.learning_vocab.set_cached",
        ):
            res = client.post(
                "/api/learning/sentence-practice/example-sentences",
                json={"word": "來源", "story_title": unique_story},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 200
        data = res.json()
        assert "source" in data, "Response must include 'source' field (Issue #836)"
        assert data["source"] == "ai", f"Expected source='ai' for real-time generation, got '{data['source']}'"

    def test_example_sentences_pregenerated_cache_returns_source_pregenerated(self, client: TestClient):
        """When served from pregenerated cache, response includes source='pregenerated'. (Issue #836)"""
        token = _create_student_and_login(client)
        cached_data = {
            "sentences": [
                {"sentence": "這條河的來源是高山。", "explanation": "來源：事物的起點"},
                {"sentence": "她的靈感來源於童年記憶。", "explanation": "來源：根本"},
            ],
            "source": "pregenerated",
        }
        with patch(
            "app.routes.learning.learning_vocab.get_cached",
            return_value=cached_data,
        ):
            res = client.post(
                "/api/learning/sentence-practice/example-sentences",
                json={"word": "來源", "story_title": "測試課文_pregenerated"},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 200
        data = res.json()
        assert "source" in data, "Response must include 'source' field (Issue #836)"
        assert data["source"] == "pregenerated", (
            f"Expected source='pregenerated' for cached entry, got '{data['source']}'"
        )

    def test_example_sentences_ai_cached_returns_source_pregenerated(self, client: TestClient):
        """When served from AI-result cache (no source tag), response includes source='pregenerated'.
        AI-cached results also return instantly, so they use 'pregenerated' semantics. (Issue #836)"""
        token = _create_student_and_login(client)
        # AI cache entries don't have a 'source' key — they're stored by set_cached
        cached_data = {
            "sentences": [
                {"sentence": "泉水是山裡清澈的水源。", "explanation": "水源：水的來源"},
                {"sentence": "她努力工作是收入的主要來源。", "explanation": "來源：事物根本"},
            ],
            # No 'source' key — simulates a cached AI result stored by set_cached
        }
        with patch(
            "app.routes.learning.learning_vocab.get_cached",
            return_value=cached_data,
        ):
            res = client.post(
                "/api/learning/sentence-practice/example-sentences",
                json={"word": "來源", "story_title": "測試課文_ai_cached"},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 200
        data = res.json()
        assert "source" in data, "Response must include 'source' field (Issue #836)"
        assert data["source"] == "pregenerated", (
            f"Expected source='pregenerated' for cached AI result (returns instantly), got '{data['source']}'"
        )


# ---------------------------------------------------------------------------
# Tests: validate endpoint
# ---------------------------------------------------------------------------

class TestValidateSentence:
    def test_validate_correct_sentence(self, client: TestClient):
        """Returns is_correct=True for a grammatically correct sentence."""
        token = _create_student_and_login(client)
        mock_result = {
            "is_correct": True,
            "feedback": "造句非常好！",
            "suggestion": "",
        }
        with patch(
            "app.routes.learning.learning_vocab.validate_student_sentence",
            new=AsyncMock(return_value=mock_result),
        ):
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "word": "來源",
                    "student_sentence": "老師講述這個故事的來源。",
                    "story_title": "課文",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 200
        data = res.json()
        assert data["is_correct"] is True
        assert data["feedback"] != ""
        assert data["suggestion"] == ""

    def test_validate_sentence_missing_target_word(self, client: TestClient):
        """Returns is_correct=False without calling AI when word not in sentence."""
        token = _create_student_and_login(client)
        with patch(
            "app.routes.learning.learning_vocab.validate_student_sentence",
            new=AsyncMock(return_value={"is_correct": True, "feedback": "", "suggestion": ""}),
        ) as mock_ai:
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "word": "來源",
                    "student_sentence": "我每天都很快樂。",  # 沒有包含「來源」
                    "story_title": "課文",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            # AI should NOT be called for this pre-validation failure
            mock_ai.assert_not_called()

        assert res.status_code == 200
        data = res.json()
        assert data["is_correct"] is False
        assert "來源" in data["suggestion"]

    def test_validate_incorrect_sentence(self, client: TestClient):
        """Returns is_correct=False with feedback for an incorrect sentence."""
        token = _create_student_and_login(client)
        mock_result = {
            "is_correct": False,
            "feedback": "句子語法有點問題，請再修改看看。",
            "suggestion": "試試：「這本書的來源是圖書館。」",
        }
        with patch(
            "app.routes.learning.learning_vocab.validate_student_sentence",
            new=AsyncMock(return_value=mock_result),
        ):
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "word": "來源",
                    "student_sentence": "來源 是 好",
                    "story_title": "課文",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 200
        data = res.json()
        assert data["is_correct"] is False
        assert data["feedback"] != ""
        assert data["suggestion"] != ""

    def test_validate_requires_auth(self, client: TestClient):
        """Without auth token, endpoint returns 401 or 403."""
        res = client.post(
            "/api/learning/sentence-practice/validate",
            json={
                "word": "來源",
                "student_sentence": "這個故事的來源很有趣。",
                "story_title": "課文",
            },
        )
        assert res.status_code in (401, 403)

    def test_validate_rejects_empty_sentence(self, client: TestClient):
        """Endpoint rejects empty student_sentence."""
        token = _create_student_and_login(client)
        res = client.post(
            "/api/learning/sentence-practice/validate",
            json={
                "word": "來源",
                "student_sentence": "",
                "story_title": "課文",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 422

    def test_validate_handles_ai_error(self, client: TestClient):
        """Returns 503 when AI service encounters an error."""
        token = _create_student_and_login(client)
        with patch(
            "app.routes.learning.learning_vocab.validate_student_sentence",
            new=AsyncMock(side_effect=Exception("AI error")),
        ):
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "word": "來源",
                    "student_sentence": "老師講述這個故事的來源。",
                    "story_title": "課文",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 503

    def test_validate_defaults_incorrect_when_ai_omits_is_correct(self, client: TestClient):
        """Regression: a malformed-but-successful AI response missing 'is_correct'
        must NOT auto-pass the student.

        Platform invariant (see AI service memory): on ambiguous grader output,
        fail closed (is_correct=False). Defaulting a missing verdict to True marks
        any sentence correct whenever Gemini drops the field — a silent auto-pass.
        """
        token = _create_student_and_login(client)
        # Valid JSON, but the grader omitted the is_correct verdict field.
        mock_result = {"feedback": "嗯，再想想看", "suggestion": "換個說法試試"}
        with patch(
            "app.routes.learning.learning_vocab.validate_student_sentence",
            new=AsyncMock(return_value=mock_result),
        ):
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "word": "來源",
                    "student_sentence": "老師講述這個故事的來源。",
                    "story_title": "課文",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 200
        assert res.json()["is_correct"] is False, (
            "AI response missing 'is_correct' must default to False (never auto-pass)"
        )


# ---------------------------------------------------------------------------
# Tests: copy-paste detection (#928)
# ---------------------------------------------------------------------------

_FAKE_LESSON = {
    "title": "小水滴的旅行",
    "full_text": "小水滴從天上掉下來，落在一片綠色的葉子上。它順著葉子滑到地面，流進了小溪。小溪帶著它穿過森林，來到了大海。",
    "paragraphs": [
        "小水滴從天上掉下來，落在一片綠色的葉子上。",
        "它順著葉子滑到地面，流進了小溪。",
        "小溪帶著它穿過森林，來到了大海。",
    ],
}


class TestCopyPasteDetection:
    """Tests for Issue #928: reject sentences copied from the passage."""

    def test_validate_rejects_copied_sentence(self, client: TestClient):
        """Sentence that is a substring of full_text is rejected without calling AI."""
        token = _create_student_and_login(client)
        ai_mock = AsyncMock(return_value={"is_correct": True, "feedback": "", "suggestion": ""})
        with (
            patch("app.routes.learning.learning_vocab.get_lesson_by_title", return_value=_FAKE_LESSON),
            patch("app.routes.learning.learning_vocab.validate_student_sentence", new=ai_mock),
        ):
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "word": "水",
                    "student_sentence": "小水滴從天上掉下來",
                    "story_title": "小水滴的旅行",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            ai_mock.assert_not_called()

        assert res.status_code == 200
        data = res.json()
        assert data["is_correct"] is False
        assert "複製" in data["feedback"] or "相似" in data["feedback"] or "例句" in data["feedback"]

    def test_validate_rejects_paragraph_copy(self, client: TestClient):
        """Sentence matching a paragraph substring is rejected."""
        token = _create_student_and_login(client)
        ai_mock = AsyncMock(return_value={"is_correct": True, "feedback": "", "suggestion": ""})
        with (
            patch("app.routes.learning.learning_vocab.get_lesson_by_title", return_value=_FAKE_LESSON),
            patch("app.routes.learning.learning_vocab.validate_student_sentence", new=ai_mock),
        ):
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "word": "溪",
                    "student_sentence": "流進了小溪",
                    "story_title": "小水滴的旅行",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            ai_mock.assert_not_called()

        assert res.status_code == 200
        data = res.json()
        assert data["is_correct"] is False

    def test_validate_allows_original_sentence(self, client: TestClient):
        """Original sentence passes the copy check and reaches AI validation."""
        token = _create_student_and_login(client)
        ai_mock = AsyncMock(return_value={"is_correct": True, "feedback": "很棒！", "suggestion": ""})
        with (
            patch("app.routes.learning.learning_vocab.get_lesson_by_title", return_value=_FAKE_LESSON),
            patch("app.routes.learning.learning_vocab.validate_student_sentence", new=ai_mock),
        ):
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "word": "水",
                    "student_sentence": "我每天都會喝水來保持健康。",
                    "story_title": "小水滴的旅行",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            ai_mock.assert_called_once()

        assert res.status_code == 200
        assert res.json()["is_correct"] is True

    def test_validate_no_lesson_skips_copy_check(self, client: TestClient):
        """When lesson is not found, copy check is skipped and AI is called normally."""
        token = _create_student_and_login(client)
        ai_mock = AsyncMock(return_value={"is_correct": True, "feedback": "好！", "suggestion": ""})
        with (
            patch("app.routes.learning.learning_vocab.get_lesson_by_title", return_value=None),
            patch("app.routes.learning.learning_vocab.validate_student_sentence", new=ai_mock),
        ):
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "word": "水",
                    "student_sentence": "小水滴從天上掉下來",
                    "story_title": "不存在的課文",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            ai_mock.assert_called_once()

        assert res.status_code == 200
        assert res.json()["is_correct"] is True

    def test_validate_passage_sentences_passed_to_ai(self, client: TestClient):
        """passage_sentences kwarg is passed to validate_student_sentence when lesson exists."""
        token = _create_student_and_login(client)
        ai_mock = AsyncMock(return_value={"is_correct": True, "feedback": "好！", "suggestion": ""})
        with (
            patch("app.routes.learning.learning_vocab.get_lesson_by_title", return_value=_FAKE_LESSON),
            patch("app.routes.learning.learning_vocab.validate_student_sentence", new=ai_mock),
        ):
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "word": "水",
                    "student_sentence": "我喜歡在夏天喝冰水。",
                    "story_title": "小水滴的旅行",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            ai_mock.assert_called_once()
            call_kwargs = ai_mock.call_args
            assert "passage_sentences" in call_kwargs.kwargs
            assert isinstance(call_kwargs.kwargs["passage_sentences"], list)
            assert len(call_kwargs.kwargs["passage_sentences"]) > 0

        assert res.status_code == 200
