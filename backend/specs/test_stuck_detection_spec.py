"""
Spec: stuck-detection — struggling-student detection thresholds + recommendation rules.

Canonical source: backend/app/services/stuck_detection_service.py
Related issue: #91
Module spec: specs/modules/stuck-detection/INTENT.md

Two tiers in one file:
- build_recommendations(): pure rule-based, no DB — runs in < 1 ms.
- detect_stuck_points(): DB-coupled — uses an in-memory SQLite DB. FK enforcement
  is intentionally OFF (phantom student_id) so we test detection logic, not
  referential integrity. JSONB→JSON patching comes from specs/conftest.py.
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.models import Base
from app.models.session import CharacterError, LearningSession
from app.services.stuck_detection_service import (
    ACCURACY_DECLINE_SESSIONS,
    CHARACTER_ERROR_THRESHOLD,
    LOOKBACK_DAYS,
    STUCK_ATTEMPT_THRESHOLD,
    build_recommendations,
    detect_stuck_points,
)

_STUDENT_ID = 999  # phantom; FK not enforced in SQLite here


# ===========================================================================
# Tier 1 — pure: build_recommendations rule mapping
# ===========================================================================

def _empty_stuck():
    return {"story_stuck": [], "character_stuck": [], "is_declining": False, "accuracy_trend": []}


class TestRecommendationRules:
    def test_no_stuck_points_returns_single_encouragement(self):
        recs = build_recommendations(_empty_stuck())
        assert len(recs) == 1
        assert recs[0]["type"] == "encouragement"

    def test_declining_produces_declining_rec(self):
        data = _empty_stuck()
        data["is_declining"] = True
        types = [r["type"] for r in build_recommendations(data)]
        assert "declining" in types

    def test_story_stuck_recs_capped_at_three(self):
        data = _empty_stuck()
        data["story_stuck"] = [
            {"story_slug": f"s{i}", "attempt_count": 3, "best_accuracy": 50.0} for i in range(5)
        ]
        story_recs = [r for r in build_recommendations(data) if r["type"] == "story_stuck"]
        assert len(story_recs) == 3

    def test_character_stuck_recs_capped_at_five(self):
        data = _empty_stuck()
        data["character_stuck"] = [
            {"character": chr(0x4E00 + i), "error_count": 3} for i in range(8)
        ]
        char_recs = [r for r in build_recommendations(data) if r["type"] == "character_stuck"]
        assert len(char_recs) == 5

    def test_every_rec_has_action(self):
        data = _empty_stuck()
        data["is_declining"] = True
        data["story_stuck"] = [{"story_slug": "s", "attempt_count": 3, "best_accuracy": 40.0}]
        data["character_stuck"] = [{"character": "難", "error_count": 4}]
        for rec in build_recommendations(data):
            assert rec.get("action")


# ===========================================================================
# Tier 2 — DB-coupled: detect_stuck_points thresholds
# ===========================================================================

_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


@pytest.fixture()
def db():
    Base.metadata.create_all(bind=_engine)
    session = _Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=_engine)


def _add_inprogress(db, *, story_slug):
    """An in_progress session — the only rows the partial unique index covers."""
    db.add(
        LearningSession(
            student_id=_STUDENT_ID,
            story_slug=story_slug,
            status="in_progress",
            current_step=1,
            started_at=datetime.now(timezone.utc),
            full_reading_attempts=[],
        )
    )
    db.commit()


def _add_session(db, *, story_slug=None, accuracy=None, days_ago=1):
    started = datetime.now(timezone.utc) - timedelta(days=days_ago)
    row = LearningSession(
        student_id=_STUDENT_ID,
        story_slug=story_slug,
        accuracy=accuracy,
        status="completed",
        current_step=1,
        started_at=started,
        full_reading_attempts=[],  # NOT NULL JSONB; default stripped for SQLite
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


class TestStorySlugDrift:
    """detect_stuck_points groups multiple LearningSession rows by story_slug to
    find a story "attempted 3+ times". But the current schema enforces
    UNIQUE(student_id, story_slug) — a student can have at most ONE session per
    story_slug — so the story_stuck branch is unreachable via repeated sessions.
    This is real drift: the #91 logic predates the uniqueness constraint.
    """

    def test_uniqueness_applies_only_to_in_progress_sessions(self, db):
        """The constraint is partial, and these tests used to miss that.

        The real index is
            unique(student_id, story_slug)
            where status = 'in_progress' and story_slug is not null

        SQLite has no partial indexes unless the WHERE clause is carried over,
        and the specs' copy of the metadata patch used to drop it — so the test
        database enforced uniqueness on every row, stricter than production.
        These tests were written against that artefact, and one of them
        concluded from it that story_stuck detection was dead code.

        Completed sessions sharing a slug are exactly what repeated practice
        looks like, and production has always allowed them.
        """
        from sqlalchemy.exc import IntegrityError

        _add_session(db, story_slug="dup", accuracy=50.0)
        _add_session(db, story_slug="dup", accuracy=60.0)  # completed: allowed

        _add_inprogress(db, story_slug="live")
        with pytest.raises(IntegrityError):
            _add_inprogress(db, story_slug="live")
        db.rollback()

    def test_story_stuck_triggers_on_repeated_attempts(self, db):
        for acc in (50.0, 51.0, 52.0):
            _add_session(db, story_slug="stuck", accuracy=acc)
        result = detect_stuck_points(_STUDENT_ID, db)
        assert any(s["story_slug"] == "stuck" for s in result["story_stuck"])


class TestCharacterStuck:
    def test_character_with_threshold_errors_is_flagged(self, db):
        sess = _add_session(db, story_slug="cs", accuracy=60.0)
        for _ in range(CHARACTER_ERROR_THRESHOLD):
            db.add(CharacterError(session_id=sess.id, character="難", error_type="pronunciation"))
        db.commit()
        result = detect_stuck_points(_STUDENT_ID, db)
        chars = [c["character"] for c in result["character_stuck"]]
        assert "難" in chars

    def test_character_below_threshold_not_flagged(self, db):
        sess = _add_session(db, story_slug="cs2", accuracy=60.0)
        for _ in range(CHARACTER_ERROR_THRESHOLD - 1):
            db.add(CharacterError(session_id=sess.id, character="易", error_type="pronunciation"))
        db.commit()
        result = detect_stuck_points(_STUDENT_ID, db)
        assert all(c["character"] != "易" for c in result["character_stuck"])


class TestDecliningTrend:
    def test_strictly_declining_accuracy_flags_declining(self, db):
        # story_slug=None avoids UNIQUE(student_id, story_slug); trend uses all sessions.
        # most-recent-last; strictly declining over the last ACCURACY_DECLINE_SESSIONS
        accs = [90.0, 80.0, 70.0]
        for i, acc in enumerate(accs):
            _add_session(db, story_slug=None, accuracy=acc, days_ago=len(accs) - i)
        result = detect_stuck_points(_STUDENT_ID, db)
        assert result["is_declining"] is True

    def test_improving_accuracy_not_declining(self, db):
        accs = [70.0, 80.0, 90.0]
        for i, acc in enumerate(accs):
            _add_session(db, story_slug=None, accuracy=acc, days_ago=len(accs) - i)
        result = detect_stuck_points(_STUDENT_ID, db)
        assert result["is_declining"] is False


class TestLookbackWindow:
    def test_sessions_older_than_lookback_excluded(self, db):
        # sessions older than the 30-day window must not appear in the trend
        for acc in (50.0, 51.0, 52.0):
            _add_session(db, story_slug=None, accuracy=acc, days_ago=LOOKBACK_DAYS + 5)
        result = detect_stuck_points(_STUDENT_ID, db)
        assert result["accuracy_trend"] == []
        assert result["story_stuck"] == []
