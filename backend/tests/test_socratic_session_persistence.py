"""
Tests for Socratic SessionStore DB persistence (Issue #961).

Verifies that:
- SessionStore.save() writes serialized SessionState to LearningSession.dialogue_state
- SessionStore.get() falls back to DB when in-memory cache is cold
- DB snapshot survives an in-memory cache eviction (simulates Cloud Run restart)
- SessionStore.save() with no db context writes only to in-memory cache (no crash)
- LearningSession.dialogue_state JSONB column exists on the model

Run with:
    cd backend
    python -m pytest tests/test_socratic_session_persistence.py -v
"""

import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.session import LearningSession


# ---------------------------------------------------------------------------
# SQLite in-memory test database
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


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_learning_session(db) -> int:
    """Create a minimal LearningSession row and return its id."""
    from app.models.user import User as UserModel, Role
    from app.auth.password import hash_password
    import uuid

    # Ensure a student role exists
    role = db.query(Role).filter_by(name="student").first()
    if not role:
        role = Role(name="student", display_name="Student", scope_level="school")
        db.add(role)
        db.commit()
        db.refresh(role)

    unique = uuid.uuid4().hex[:8]
    user = UserModel(
        email=f"persist_test_{unique}@example.com",
        password_hash=hash_password("Password123!"),
        name=f"PersistTest {unique}",
        email_verified=True,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    ls = LearningSession(student_id=user.id, story_slug="test-story")
    db.add(ls)
    db.commit()
    db.refresh(ls)
    return ls.id


# ---------------------------------------------------------------------------
# Tests: LearningSession.dialogue_state column exists
# ---------------------------------------------------------------------------


class TestDialogueStateColumn:
    def test_column_exists_on_model(self):
        """LearningSession must have a dialogue_state attribute."""
        assert hasattr(LearningSession, "dialogue_state"), (
            "LearningSession missing dialogue_state column. "
            "Run the Alembic migration for Issue #961."
        )

    def test_column_is_nullable_and_defaults_to_none(self):
        """A newly created LearningSession row should have dialogue_state=None."""
        db = TestingSessionLocal()
        try:
            ls_id = _make_learning_session(db)
            ls = db.query(LearningSession).filter_by(id=ls_id).one()
            assert ls.dialogue_state is None
        finally:
            db.close()

    def test_column_accepts_dict_payload(self):
        """dialogue_state should store and retrieve an arbitrary dict."""
        db = TestingSessionLocal()
        try:
            ls_id = _make_learning_session(db)
            payload = {
                "session_id": "uuid-abc",
                "story_title": "玉山",
                "understood_count": 3,
                "current_phase": "inferential",
                "conversation": [{"role": "ai", "text": "主角是誰？"}],
            }
            ls = db.query(LearningSession).filter_by(id=ls_id).one()
            ls.dialogue_state = payload
            db.commit()

            db.expire(ls)
            ls = db.query(LearningSession).filter_by(id=ls_id).one()
            assert ls.dialogue_state == payload
            assert ls.dialogue_state["understood_count"] == 3
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Tests: SessionStore DB-backed persistence
# ---------------------------------------------------------------------------


class TestSessionStoreDBPersistence:
    def _make_state(self, session_id: str = "test-session-id"):
        from app.services.socratic_agent import SessionState

        return SessionState(
            session_id=session_id,
            story_title="玉山的故事",
            story_text="玉山是台灣最高峰。\n標高3952公尺。",
            conversation=[
                {"role": "ai", "text": "課文的主角是誰？"},
                {"role": "student", "text": "玉山"},
            ],
            understood_count=2,
            total_attempts=3,
            current_phase="inferential",
            consecutive_errors=0,
            mispronounced_words=["標高"],
            accuracy=85.0,
            cpm=120.0,
            teacher_instructions=["多鼓勵"],
            genre="說明文",
            reading_strategy="摘要",
        )

    def test_save_writes_dialogue_state_to_db(self):
        """SessionStore.save() with db + db_session_id must update dialogue_state column."""
        from app.services.socratic_agent import SessionStore

        store = SessionStore()
        db = TestingSessionLocal()
        try:
            ls_id = _make_learning_session(db)
            state = self._make_state("save-test-session")

            store.save(state, db=db, db_session_id=ls_id)

            db.expire_all()
            ls = db.query(LearningSession).filter_by(id=ls_id).one()
            assert ls.dialogue_state is not None, "dialogue_state should be set after save()"
            assert ls.dialogue_state["session_id"] == "save-test-session"
            assert ls.dialogue_state["understood_count"] == 2
            assert ls.dialogue_state["current_phase"] == "inferential"
            assert ls.dialogue_state["genre"] == "說明文"
            assert ls.dialogue_state["reading_strategy"] == "摘要"
        finally:
            db.close()

    def test_get_falls_back_to_db_when_memory_cold(self):
        """SessionStore.get() with a cold cache must restore state from DB."""
        from app.services.socratic_agent import SessionStore

        store = SessionStore()
        db = TestingSessionLocal()
        try:
            ls_id = _make_learning_session(db)
            state = self._make_state("cold-cache-session")

            # Write to DB only (bypass in-memory cache by writing directly to the column)
            ls = db.query(LearningSession).filter_by(id=ls_id).one()
            ls.dialogue_state = {
                "session_id": "cold-cache-session",
                "story_title": "玉山的故事",
                "story_text": "玉山是台灣最高峰。\n標高3952公尺。",
                "conversation": [{"role": "ai", "text": "課文的主角是誰？"}],
                "understood_count": 1,
                "total_attempts": 2,
                "current_phase": "factual",
                "consecutive_errors": 0,
                "mispronounced_words": None,
                "accuracy": None,
                "cpm": None,
                "teacher_instructions": None,
                "genre": None,
                "reading_strategy": None,
                "created_at": time.time(),
            }
            db.commit()

            # Cold cache — session not in memory
            assert store._sessions.get("cold-cache-session") is None

            # get() with db context should restore from DB
            restored = store.get("cold-cache-session", db=db, db_session_id=ls_id)
            assert restored is not None, "get() should restore state from DB on cache miss"
            assert restored.session_id == "cold-cache-session"
            assert restored.understood_count == 1
            assert restored.current_phase == "factual"
            assert restored.conversation == [{"role": "ai", "text": "課文的主角是誰？"}]
        finally:
            db.close()

    def test_restored_state_is_cached_in_memory(self):
        """After DB restore, the state must also be in the in-memory cache."""
        from app.services.socratic_agent import SessionStore

        store = SessionStore()
        db = TestingSessionLocal()
        try:
            ls_id = _make_learning_session(db)

            ls = db.query(LearningSession).filter_by(id=ls_id).one()
            ls.dialogue_state = {
                "session_id": "warm-after-restore",
                "story_title": "Test",
                "story_text": "Line1\nLine2",
                "conversation": [],
                "understood_count": 0,
                "total_attempts": 0,
                "current_phase": "factual",
                "consecutive_errors": 0,
                "mispronounced_words": None,
                "accuracy": None,
                "cpm": None,
                "teacher_instructions": None,
                "genre": None,
                "reading_strategy": None,
                "created_at": time.time(),
            }
            db.commit()

            store.get("warm-after-restore", db=db, db_session_id=ls_id)

            # Second call should hit memory, not DB
            cached = store._sessions.get("warm-after-restore")
            assert cached is not None, "State should be in memory after first DB restore"
            assert cached.session_id == "warm-after-restore"
        finally:
            db.close()

    def test_save_without_db_context_does_not_crash(self):
        """save() without db context must still store state in-memory (no crash)."""
        from app.services.socratic_agent import SessionStore

        store = SessionStore()
        state = self._make_state("no-db-session")

        # Must not raise
        store.save(state)

        assert store._sessions.get("no-db-session") is not None

    def test_get_without_db_context_returns_none_on_cache_miss(self):
        """get() without db context returns None when session not in memory."""
        from app.services.socratic_agent import SessionStore

        store = SessionStore()
        result = store.get("nonexistent-session")
        assert result is None

    def test_db_snapshot_survives_memory_eviction(self):
        """Simulates Cloud Run restart: after clearing in-memory cache, DB restore works."""
        from app.services.socratic_agent import SessionStore

        store = SessionStore()
        db = TestingSessionLocal()
        try:
            ls_id = _make_learning_session(db)
            state = self._make_state("eviction-test-session")

            # Save with DB
            store.save(state, db=db, db_session_id=ls_id)

            # Simulate restart: clear in-memory cache
            store._sessions.clear()
            assert "eviction-test-session" not in store._sessions

            # Restore from DB
            restored = store.get("eviction-test-session", db=db, db_session_id=ls_id)
            assert restored is not None
            assert restored.session_id == "eviction-test-session"
            assert restored.understood_count == 2
            assert restored.story_title == "玉山的故事"
        finally:
            db.close()

    def test_serialized_fields_roundtrip_correctly(self):
        """All SessionState fields must survive JSON serialization round-trip."""
        from app.services.socratic_agent import SessionStore, SessionState

        store = SessionStore()
        db = TestingSessionLocal()
        try:
            ls_id = _make_learning_session(db)
            state = SessionState(
                session_id="roundtrip-session",
                story_title="Title With Unicode 台灣",
                story_text="Paragraph 1\nParagraph 2",
                conversation=[
                    {"role": "ai", "text": "Q1?"},
                    {"role": "student", "text": "A1"},
                    {"role": "ai", "text": "Q2?"},
                ],
                understood_count=1,
                total_attempts=2,
                current_phase="inferential",
                consecutive_errors=1,
                mispronounced_words=["台灣", "玉山"],
                accuracy=72.5,
                cpm=95.3,
                teacher_instructions=["鼓勵學生", "不要催促"],
                genre="記敘文",
                reading_strategy="預測",
            )

            store.save(state, db=db, db_session_id=ls_id)

            # Evict from memory
            store._sessions.clear()

            restored = store.get("roundtrip-session", db=db, db_session_id=ls_id)
            assert restored is not None
            assert restored.story_title == "Title With Unicode 台灣"
            assert restored.conversation == [
                {"role": "ai", "text": "Q1?"},
                {"role": "student", "text": "A1"},
                {"role": "ai", "text": "Q2?"},
            ]
            assert restored.understood_count == 1
            assert restored.total_attempts == 2
            assert restored.current_phase == "inferential"
            assert restored.consecutive_errors == 1
            assert restored.mispronounced_words == ["台灣", "玉山"]
            assert abs(restored.accuracy - 72.5) < 0.001
            assert abs(restored.cpm - 95.3) < 0.001
            assert restored.teacher_instructions == ["鼓勵學生", "不要催促"]
            assert restored.genre == "記敘文"
            assert restored.reading_strategy == "預測"
        finally:
            db.close()
