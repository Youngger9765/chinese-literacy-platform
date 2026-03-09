"""
Tests for Cross-Text Learning Pattern Analysis — Issue #253.

Covers:
- cross_text_analysis_service unit tests (pure logic)
- GET /api/learning/cross-text-analysis/{student_id} endpoint

Uses SQLite in-memory DB to avoid external dependencies.

Run with:
    cd backend && python -m pytest tests/test_cross_text_analysis.py -v
"""

import sys
import os
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

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
from app.models.session import LearningSession, CharacterError
from app.models.text import Text
from app.services.cross_text_analysis_service import (
    analyze_cross_text_patterns,
    _build_text_type_performance,
    _build_vocabulary_growth,
    _build_common_error_patterns,
    MIN_SESSIONS_FOR_ANALYSIS,
)

# ---------------------------------------------------------------------------
# DB setup
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
    {"name": "student", "display_name": "Student", "scope_level": "class"},
    {"name": "parent", "display_name": "Parent", "scope_level": "family"},
]


@pytest.fixture(scope="module")
def db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    for r in SEED_ROLES:
        if not session.query(Role).filter_by(name=r["name"]).first():
            session.add(Role(**r))
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client(db):
    def _override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _register_and_login(client, suffix: str = "student") -> dict:
    """Register a user and return {token, user_id}."""
    uid = _uid()
    email = f"{suffix}_{uid}@test.com"
    res = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "Password123!",
            "name": f"{suffix} {uid}",
            "terms_accepted": True,
            "copyright_confirmed": True,
        },
    )
    assert res.status_code == 201, res.text
    token = res.json()["access_token"]
    me = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    return {"token": token, "user_id": me.json()["id"]}


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_text_in_db(db, title: str, genre: str = "記敘文", category: str = "Fable", grade: int = 5) -> Text:
    text = Text(
        title=title,
        paragraphs=["段落一"],
        char_count=10,
        grade=grade,
        grade_code=f"G{grade}-1",
        genre=genre,
        text_type="單",
        category=category,
        vocabulary=[{"word": f"詞{_uid()}", "definition": "測試"}],
    )
    db.add(text)
    db.flush()
    return text


def _make_completed_session(db, student_id: int, text: Text, score: float = 80.0) -> LearningSession:
    s = LearningSession(
        student_id=student_id,
        text_id=text.id,
        story_slug=f"slug-{text.id}",
        status="completed",
        current_step=6,
        overall_score=score,
        completed_at=datetime.now(timezone.utc),
    )
    db.add(s)
    db.flush()
    return s


# ---------------------------------------------------------------------------
# Unit tests — pure service functions with mocked data
# ---------------------------------------------------------------------------


class TestBuildTextTypePerformance:
    """Pure logic tests — no DB required."""

    def _mock_text(self, genre: str, category: str, grade: int) -> MagicMock:
        t = MagicMock()
        t.genre = genre
        t.category = category
        t.grade = grade
        return t

    def _mock_session(self, score: float | None) -> MagicMock:
        s = MagicMock(spec=LearningSession)
        s.overall_score = score
        s.accuracy = None
        return s

    def test_empty_input_returns_empty_lists(self):
        result = _build_text_type_performance([])
        assert result["by_genre"] == []
        assert result["by_category"] == []
        assert result["by_grade"] == []

    def test_groups_by_genre_and_averages(self):
        t1 = self._mock_text("記敘文", "Fable", 5)
        t2 = self._mock_text("記敘文", "Fable", 5)
        t3 = self._mock_text("說明文", "Science", 6)
        pairs = [
            (self._mock_session(80.0), t1),
            (self._mock_session(90.0), t2),
            (self._mock_session(70.0), t3),
        ]
        result = _build_text_type_performance(pairs)
        genres = {g["label"]: g for g in result["by_genre"]}

        assert "記敘文" in genres
        assert "說明文" in genres
        assert genres["記敘文"]["avg_score"] == 85.0
        assert genres["記敘文"]["attempts"] == 2
        assert genres["說明文"]["avg_score"] == 70.0

    def test_skips_sessions_without_score(self):
        t1 = self._mock_text("議論文", "Opinion", 7)
        pairs = [(self._mock_session(None), t1)]
        result = _build_text_type_performance(pairs)
        assert result["by_genre"] == []

    def test_skips_sessions_without_text(self):
        s = self._mock_session(85.0)
        pairs = [(s, None)]
        result = _build_text_type_performance(pairs)
        assert result["by_genre"] == []


class TestBuildVocabularyGrowth:
    """Pure logic tests for vocabulary accumulation."""

    def _mock_session(self, title: str) -> MagicMock:
        s = MagicMock(spec=LearningSession)
        s.completed_at = datetime.now(timezone.utc)
        s.story_slug = f"slug-{title}"
        return s

    def _mock_text(self, vocab_words: list, title: str = "課文") -> MagicMock:
        t = MagicMock(spec=Text)
        t.title = title
        t.vocabulary = [{"word": w} for w in vocab_words]
        return t

    def test_cumulative_count_increases(self):
        t1 = self._mock_text(["蝴蝶", "春天"], "課文A")
        t2 = self._mock_text(["地球", "月亮"], "課文B")
        pairs = [(self._mock_session("A"), t1), (self._mock_session("B"), t2)]
        result = _build_vocabulary_growth(pairs)

        assert len(result) == 2
        assert result[0]["new_words"] == 2
        assert result[0]["cumulative_words"] == 2
        assert result[1]["new_words"] == 2
        assert result[1]["cumulative_words"] == 4

    def test_duplicate_words_not_double_counted(self):
        t1 = self._mock_text(["共同詞"], "課文A")
        t2 = self._mock_text(["共同詞"], "課文B")
        pairs = [(self._mock_session("A"), t1), (self._mock_session("B"), t2)]
        result = _build_vocabulary_growth(pairs)

        assert result[-1]["cumulative_words"] == 1

    def test_empty_vocabulary_returns_zero_new_words(self):
        t1 = self._mock_text([], "課文A")
        pairs = [(self._mock_session("A"), t1)]
        result = _build_vocabulary_growth(pairs)
        assert result[0]["new_words"] == 0


class TestBuildCommonErrorPatterns:
    """DB-required tests for cross-session error analysis."""

    def test_returns_chars_recurring_across_multiple_texts(self, db):
        t1 = _make_text_in_db(db, f"錯誤測試A-{_uid()}", genre="記敘文", grade=5)
        t2 = _make_text_in_db(db, f"錯誤測試B-{_uid()}", genre="記敘文", grade=5)

        from app.models.user import User as UserModel
        user = UserModel(
            email=f"error_test_{_uid()}@test.com",
            password_hash="hashed",
            name="Error Test",
        )
        db.add(user)
        db.flush()
        student_id = user.id

        s1 = _make_completed_session(db, student_id, t1)
        s2 = _make_completed_session(db, student_id, t2)

        db.add(CharacterError(session_id=s1.id, character="難", error_type="pronunciation"))
        db.add(CharacterError(session_id=s2.id, character="難", error_type="pronunciation"))
        db.add(CharacterError(session_id=s1.id, character="易", error_type="tone"))
        db.commit()

        pairs = [(s1, t1), (s2, t2)]
        result = _build_common_error_patterns(student_id, pairs, db)

        chars = [e["character"] for e in result]
        assert "難" in chars
        assert "易" not in chars

        entry = next(e for e in result if e["character"] == "難")
        assert entry["text_count"] == 2
        assert entry["error_count"] == 2

    def test_empty_pairs_returns_empty_list(self, db):
        from app.models.user import User as UserModel
        user = UserModel(
            email=f"empty_pairs_{_uid()}@test.com",
            password_hash="hashed",
            name="Empty Pairs",
        )
        db.add(user)
        db.commit()
        result = _build_common_error_patterns(user.id, [], db)
        assert result == []


# ---------------------------------------------------------------------------
# Integration tests — API endpoint
# ---------------------------------------------------------------------------


class TestCrossTextAnalysisEndpoint:
    """Integration tests for GET /api/learning/cross-text-analysis/{student_id}."""

    def test_student_can_access_own_analysis(self, client):
        data = _register_and_login(client, "self_access")
        res = client.get(
            f"/api/learning/cross-text-analysis/{data['user_id']}",
            headers=_headers(data["token"]),
        )
        assert res.status_code == 200
        body = res.json()
        assert body["student_id"] == data["user_id"]
        assert "has_enough_data" in body
        assert "summary" in body

    def test_student_cannot_access_other_student_analysis(self, client):
        student_a = _register_and_login(client, "cross_a")
        student_b = _register_and_login(client, "cross_b")

        res = client.get(
            f"/api/learning/cross-text-analysis/{student_b['user_id']}",
            headers=_headers(student_a["token"]),
        )
        assert res.status_code == 403

    def test_returns_not_enough_data_for_new_student(self, client):
        data = _register_and_login(client, "newstudent")
        res = client.get(
            f"/api/learning/cross-text-analysis/{data['user_id']}",
            headers=_headers(data["token"]),
        )
        assert res.status_code == 200
        body = res.json()
        assert body["has_enough_data"] is False
        assert body["total_completed_texts"] == 0

    def test_404_for_nonexistent_student(self, client):
        data = _register_and_login(client, "requester404")
        res = client.get(
            "/api/learning/cross-text-analysis/999999",
            headers=_headers(data["token"]),
        )
        assert res.status_code == 404

    def test_requires_authentication(self, client):
        res = client.get("/api/learning/cross-text-analysis/1")
        assert res.status_code == 401

    def test_returns_full_analysis_with_enough_data(self, client, db):
        data = _register_and_login(client, "datarich")
        student_id = data["user_id"]

        t1 = _make_text_in_db(db, f"跨文一-{_uid()}", genre="記敘文", grade=5)
        t2 = _make_text_in_db(db, f"跨文二-{_uid()}", genre="說明文", grade=6)
        _make_completed_session(db, student_id, t1, score=82.0)
        _make_completed_session(db, student_id, t2, score=75.0)
        db.commit()

        res = client.get(
            f"/api/learning/cross-text-analysis/{student_id}",
            headers=_headers(data["token"]),
        )
        assert res.status_code == 200
        body = res.json()
        assert body["has_enough_data"] is True
        assert body["total_completed_texts"] >= MIN_SESSIONS_FOR_ANALYSIS
        assert len(body["text_type_performance"]["by_genre"]) >= 1
        assert body["summary"]["strongest_genre"] is not None
        assert isinstance(body["vocabulary_growth"], list)
        assert isinstance(body["difficulty_progression"], list)
        assert isinstance(body["common_error_patterns"], list)


class TestAnalyzeCrossTextPatterns:
    """Unit tests for top-level service function using the DB."""

    def test_not_enough_data_flag(self, db):
        from app.models.user import User as UserModel
        user = UserModel(
            email=f"nodata_{_uid()}@test.com",
            password_hash="hashed",
            name="No Data",
        )
        db.add(user)
        db.commit()

        result = analyze_cross_text_patterns(user.id, db)
        assert result["has_enough_data"] is False
        assert result["total_completed_texts"] == 0
        assert result["summary"]["strongest_genre"] is None
        assert result["summary"]["total_vocabulary_words"] == 0

    def test_result_structure_with_enough_data(self, db):
        from app.models.user import User as UserModel
        user = UserModel(
            email=f"struct_{_uid()}@test.com",
            password_hash="hashed",
            name="Struct Student",
        )
        db.add(user)
        db.flush()

        t1 = _make_text_in_db(db, f"結構一-{_uid()}", genre="記敘文", grade=5)
        t2 = _make_text_in_db(db, f"結構二-{_uid()}", genre="說明文", grade=6)
        _make_completed_session(db, user.id, t1, score=88.0)
        _make_completed_session(db, user.id, t2, score=72.0)
        db.commit()

        result = analyze_cross_text_patterns(user.id, db)

        assert result["has_enough_data"] is True
        assert result["total_completed_texts"] >= 2
        assert isinstance(result["text_type_performance"], dict)
        assert isinstance(result["vocabulary_growth"], list)
        assert isinstance(result["difficulty_progression"], list)
        assert isinstance(result["common_error_patterns"], list)
        assert isinstance(result["summary"], dict)
        assert "strongest_genre" in result["summary"]
        assert "weakest_genre" in result["summary"]
        assert "total_vocabulary_words" in result["summary"]
        assert "recurring_error_chars" in result["summary"]

    def test_strongest_genre_identified(self, db):
        from app.models.user import User as UserModel
        user = UserModel(
            email=f"genre_{_uid()}@test.com",
            password_hash="hashed",
            name="Genre Student",
        )
        db.add(user)
        db.flush()

        for _ in range(2):
            t = _make_text_in_db(db, f"高分-{_uid()}", genre="記敘文", grade=5)
            _make_completed_session(db, user.id, t, score=95.0)

        t_low = _make_text_in_db(db, f"低分-{_uid()}", genre="說明文", grade=6)
        _make_completed_session(db, user.id, t_low, score=50.0)
        db.commit()

        result = analyze_cross_text_patterns(user.id, db)
        assert result["has_enough_data"] is True
        assert result["summary"]["strongest_genre"] == "記敘文"
