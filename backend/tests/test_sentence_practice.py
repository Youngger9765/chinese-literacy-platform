"""
Tests for sentence practice API endpoints (Issue #109).

Covers:
- POST /api/learning/sentence-practice/example-sentences
- POST /api/learning/sentence-practice/validate

Uses SQLite in-memory DB. AI calls are mocked via unittest.mock.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-109/backend
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

    app.dependency_overrides[get_db] = override_get_db
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
        """Endpoint returns exactly 2 example sentences for a valid character."""
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
                json={"character": "源", "story_title": "測試課文"},
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
                json={"character": "水", "story_title": "課文"},
            )
        assert res.status_code in (401, 403)

    def test_example_sentences_rejects_multi_char(self, client: TestClient):
        """Endpoint rejects character field with more than 1 character."""
        token = _create_student_and_login(client)
        res = client.post(
            "/api/learning/sentence-practice/example-sentences",
            json={"character": "多字", "story_title": "課文"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 422

    def test_example_sentences_handles_ai_timeout(self, client: TestClient):
        """Returns 503 when AI service times out."""
        token = _create_student_and_login(client)
        with patch(
            "app.routes.learning.learning_vocab.generate_example_sentences",
            new=AsyncMock(side_effect=TimeoutError("AI timeout")),
        ):
            res = client.post(
                "/api/learning/sentence-practice/example-sentences",
                json={"character": "水", "story_title": "課文"},
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 503

    def test_example_sentences_ai_path_returns_source_ai(self, client: TestClient):
        """When AI generates sentences in real-time, response includes source='ai'. (Issue #836)"""
        import app.services.example_sentence_cache as cache_module
        from app.services.example_sentence_cache import _reset

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
                json={"character": "源", "story_title": unique_story},
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
                json={"character": "源", "story_title": "測試課文_pregenerated"},
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
                json={"character": "源", "story_title": "測試課文_ai_cached"},
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
                    "character": "水",
                    "student_sentence": "我每天喝很多水保持健康。",
                    "story_title": "課文",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 200
        data = res.json()
        assert data["is_correct"] is True
        assert data["feedback"] != ""
        assert data["suggestion"] == ""

    def test_validate_sentence_missing_target_char(self, client: TestClient):
        """Returns is_correct=False without calling AI when char not in sentence."""
        token = _create_student_and_login(client)
        with patch(
            "app.routes.learning.learning_vocab.validate_student_sentence",
            new=AsyncMock(return_value={"is_correct": True, "feedback": "", "suggestion": ""}),
        ) as mock_ai:
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "character": "水",
                    "student_sentence": "我每天都很快樂。",  # 沒有包含「水」
                    "story_title": "課文",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            # AI should NOT be called for this pre-validation failure
            mock_ai.assert_not_called()

        assert res.status_code == 200
        data = res.json()
        assert data["is_correct"] is False
        assert "水" in data["suggestion"]

    def test_validate_incorrect_sentence(self, client: TestClient):
        """Returns is_correct=False with feedback for an incorrect sentence."""
        token = _create_student_and_login(client)
        mock_result = {
            "is_correct": False,
            "feedback": "句子語法有點問題，請再修改看看。",
            "suggestion": "試試：「這杯水很清涼。」",
        }
        with patch(
            "app.routes.learning.learning_vocab.validate_student_sentence",
            new=AsyncMock(return_value=mock_result),
        ):
            res = client.post(
                "/api/learning/sentence-practice/validate",
                json={
                    "character": "水",
                    "student_sentence": "水 是 好",
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
                "character": "水",
                "student_sentence": "我喝水。",
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
                "character": "水",
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
                    "character": "水",
                    "student_sentence": "我每天喝水保持健康。",
                    "story_title": "課文",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
        assert res.status_code == 503
