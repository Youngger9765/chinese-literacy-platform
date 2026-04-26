"""Regression tests for reading_result versioning (Issue #1183).

Tests the reading_attempt_service helper functions directly against an
in-memory SQLite DB.  FK enforcement is intentionally disabled so we can
insert LearningSession rows without creating User/School/StudentProfile
scaffolding — the behaviour under test is the snapshot logic, not referential
integrity.

Verifies:
1. snapshot_reading_result() returns None when reading_result is None (nothing to save).
2. Writing reading_result twice: snapshot_reading_result() before the second write
   creates exactly 1 ReadingAttemptHistory row holding the FIRST value.
3. LearningSession.reading_result holds the LATEST written value.
4. get_reading_history() returns snapshots ordered by attempt_no ascending.
5. History row count == total writes - 1 (first write has nothing to snapshot).

Uses SQLite in-memory DB; conftest.py patches JSONB → JSON for compatibility.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.session import LearningSession, ReadingAttemptHistory
from app.services.reading_attempt_service import get_reading_history, snapshot_reading_result

# ---------------------------------------------------------------------------
# SQLite in-memory engine — NO PRAGMA foreign_keys so we can create
# LearningSession rows without scaffolding the full User hierarchy.
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)

TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def db():
    """Provide a SQLite in-memory DB session for unit tests."""
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def learning_session(db):
    """Create a bare LearningSession (no FK enforcement → no User needed)."""
    sess = LearningSession(
        student_id=999,   # phantom student_id; FK not enforced in SQLite here
        story_slug="test-story-1183",
        status="in_progress",
        current_step=1,
        reading_result=None,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestReadingAttemptHistory:
    """Unit tests for snapshot_reading_result and get_reading_history."""

    def test_no_snapshot_when_reading_result_is_none(self, db, learning_session):
        """snapshot_reading_result on a None field returns None; no row created."""
        assert learning_session.reading_result is None

        result = snapshot_reading_result(db, learning_session)
        assert result is None

        count = (
            db.query(ReadingAttemptHistory)
            .filter(ReadingAttemptHistory.session_id == learning_session.id)
            .count()
        )
        assert count == 0, "No snapshot row should be created when reading_result is None"

    def test_snapshot_created_before_second_write(self, db, learning_session):
        """First write sets reading_result; second write snapshots the first value."""
        # Write #1 — set a value (no prior value to snapshot)
        first_result = {"accuracy": 0.75, "cpm": 100, "transcript": "first attempt"}
        learning_session.reading_result = first_result
        db.commit()
        db.refresh(learning_session)

        # Still no history row (we set from None → value, nothing was snapshotted)
        count_before = (
            db.query(ReadingAttemptHistory)
            .filter(ReadingAttemptHistory.session_id == learning_session.id)
            .count()
        )
        assert count_before == 0

        # Write #2 — snapshot the first value, then overwrite
        attempt_no = snapshot_reading_result(db, learning_session)
        assert attempt_no == 1

        second_result = {"accuracy": 0.85, "cpm": 120, "transcript": "second attempt"}
        learning_session.reading_result = second_result
        db.commit()
        db.refresh(learning_session)

        # Exactly 1 history row, holding the FIRST value
        rows = (
            db.query(ReadingAttemptHistory)
            .filter(ReadingAttemptHistory.session_id == learning_session.id)
            .all()
        )
        assert len(rows) == 1
        assert rows[0].attempt_no == 1
        assert rows[0].reading_result["accuracy"] == 0.75

        # Current session holds the SECOND value
        assert learning_session.reading_result["accuracy"] == 0.85

    def test_get_reading_history_returns_snapshots_ordered(self, db, learning_session):
        """get_reading_history() returns all snapshots sorted by attempt_no ascending."""
        # Write #3 — snapshot second value, then overwrite
        snapshot_reading_result(db, learning_session)
        third_result = {"accuracy": 0.90, "cpm": 135, "transcript": "third attempt"}
        learning_session.reading_result = third_result
        db.commit()

        history = get_reading_history(db, learning_session.id)
        # 2 snapshots: attempt_no 1 (accuracy=0.75) and attempt_no 2 (accuracy=0.85)
        assert len(history) == 2
        assert history[0]["attempt_no"] == 1
        assert history[1]["attempt_no"] == 2
        assert history[0]["reading_result"]["accuracy"] == 0.75
        assert history[1]["reading_result"]["accuracy"] == 0.85
        # Each entry has an ISO-format created_at string
        assert "T" in history[0]["created_at"]

    def test_current_session_holds_latest_value(self, db, learning_session):
        """After three writes, session.reading_result is the last-written value."""
        assert learning_session.reading_result["accuracy"] == 0.90

    def test_history_count_invariant(self, db, learning_session):
        """History rows = (number of writes) - 1: first write never has a prior to snapshot."""
        # 3 total writes → 2 history rows
        history = get_reading_history(db, learning_session.id)
        assert len(history) == 2
