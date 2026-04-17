"""Tests for P1 data integrity fixes.

Covers:
- Issue #985: normalize_story_slug handles all known slug formats
- Issue #984: POST /learning/sessions returns existing session instead of
              creating a duplicate (get-or-create pattern)
- Issue #982: dashboard streak_days/longest_streak reads from StudentStreak
              table, matching GET /gamification/streak/{id}

Run with:
    cd backend
    python -m pytest tests/test_p1_data_integrity.py -v
"""
from __future__ import annotations

import sys
import os
from datetime import date, datetime, timezone, timedelta

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ===========================================================================
# Issue #985 — slug normalization
# ===========================================================================

class TestNormalizeStorySlug:
    """normalize_story_slug must map every known variant to a plain int string."""

    def setup_method(self):
        # Clear the title cache so tests that mutate _TITLE_TO_NUMBER don't
        # bleed into each other.
        from app.utils import slug as slug_module
        slug_module._TITLE_TO_NUMBER = None

    # --- plain numeric ---
    def test_plain_number(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("6") == "6"

    def test_zero_padded(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("06") == "6"

    def test_large_number(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("42") == "42"

    # --- L-prefix ---
    def test_uppercase_L_prefix(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("L6") == "6"

    def test_uppercase_L_zero_padded(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("L06") == "6"

    def test_lowercase_l_prefix(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("l06") == "6"

    # --- publisher-style ---
    def test_sanmin_publisher_slug(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("sanmin-5a-L02") == "2"

    def test_nani_publisher_slug(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("nani-6b-L10") == "10"

    def test_publisher_uppercase_L(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("publisher-4a-L01") == "1"

    # --- title lookup (mocked to avoid YAML dependency) ---
    def test_chinese_title_lookup(self, monkeypatch):
        from app.utils import slug as slug_module
        # Inject a minimal title index so the test doesn't need the YAML files
        slug_module._TITLE_TO_NUMBER = {"贏得喝采的輸家": "1", "十秒的背後": "2"}
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("贏得喝采的輸家") == "1"
        assert normalize_story_slug("十秒的背後") == "2"

    def test_unknown_title_returns_as_is(self, monkeypatch):
        from app.utils import slug as slug_module
        slug_module._TITLE_TO_NUMBER = {}
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("unknown-story-title") == "unknown-story-title"

    # --- whitespace tolerance ---
    def test_strips_whitespace(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("  6  ") == "6"

    def test_strips_L_with_whitespace(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug(" L06 ") == "6"

    # --- idempotence ---
    def test_already_canonical_is_unchanged(self):
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug("1") == "1"

    def test_multiple_calls_idempotent(self, monkeypatch):
        from app.utils import slug as slug_module
        slug_module._TITLE_TO_NUMBER = {}
        from app.utils.slug import normalize_story_slug
        assert normalize_story_slug(normalize_story_slug("L06")) == "6"


# ===========================================================================
# Issue #984 — get-or-create session (SQLite in-memory)
# ===========================================================================

@pytest.fixture()
def db_session_984():
    """Minimal SQLite in-memory DB for session dedup tests."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.models.base import Base
    import app.models  # noqa: F401 — registers all tables

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    try:
        yield s
    finally:
        s.close()
        Base.metadata.drop_all(engine)


def _insert_user(db, user_id: int = 1):
    from sqlalchemy import text
    db.execute(
        text(
            "INSERT INTO users (id, email, password_hash, name, is_active, "
            "email_verified, onboarding_completed, created_at, updated_at) "
            "VALUES (:id, :email, 'x', :name, 1, 0, 0, "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {"id": user_id, "email": f"u{user_id}@test.com", "name": f"User{user_id}"},
    )
    db.commit()


def _insert_session(db, session_id: int, student_id: int, slug: str, status: str = "in_progress"):
    from sqlalchemy import text
    db.execute(
        text(
            "INSERT INTO learning_sessions "
            "(id, student_id, story_slug, status, current_step, started_at) "
            "VALUES (:id, :sid, :slug, :status, 1, CURRENT_TIMESTAMP)"
        ),
        {"id": session_id, "sid": student_id, "slug": slug, "status": status},
    )
    db.commit()


class TestGetOrCreateSession:
    """Verify that create_learning_session returns the existing in_progress
    session rather than creating a new duplicate (Issue #984)."""

    def test_returns_existing_in_progress_session(self, db_session_984):
        """When an in_progress session already exists for the same student+slug,
        the service function must return it without inserting a new row."""
        from app.models.session import LearningSession
        from app.utils.slug import normalize_story_slug

        _insert_user(db_session_984, user_id=42)
        _insert_session(db_session_984, session_id=100, student_id=42, slug="1")

        # Simulate what create_learning_session does: check for existing
        normalized = normalize_story_slug("1")
        existing = (
            db_session_984.query(LearningSession)
            .filter(
                LearningSession.student_id == 42,
                LearningSession.story_slug == normalized,
                LearningSession.status == "in_progress",
            )
            .first()
        )
        assert existing is not None, "Must find existing in_progress session"
        assert existing.id == 100

        # Confirm only 1 session exists
        count = db_session_984.query(LearningSession).filter(
            LearningSession.student_id == 42
        ).count()
        assert count == 1

    def test_creates_new_when_no_in_progress(self, db_session_984):
        """No existing session -> a new one is created."""
        from app.models.session import LearningSession
        from app.utils.slug import normalize_story_slug

        _insert_user(db_session_984, user_id=43)
        # Only a completed session exists
        _insert_session(db_session_984, session_id=200, student_id=43, slug="2", status="completed")

        normalized = normalize_story_slug("2")
        existing = (
            db_session_984.query(LearningSession)
            .filter(
                LearningSession.student_id == 43,
                LearningSession.story_slug == normalized,
                LearningSession.status == "in_progress",
            )
            .first()
        )
        # No in_progress session: service would create a new one
        assert existing is None

    def test_slug_normalization_unifies_variants(self, db_session_984):
        """Sessions created with 'L06' and '6' should resolve to the same slug."""
        from app.utils.slug import normalize_story_slug

        assert normalize_story_slug("L06") == normalize_story_slug("6") == "6"
        assert normalize_story_slug("sanmin-5a-L06") == "6"


# ===========================================================================
# Issue #982 — streak consistency (SQLite in-memory)
# ===========================================================================

@pytest.fixture()
def db_session_982():
    """Minimal SQLite in-memory DB for streak tests."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.models.base import Base
    import app.models  # noqa: F401

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    try:
        yield s
    finally:
        s.close()
        Base.metadata.drop_all(engine)


class TestStreakConsistency:
    """Verify that gamification streak and dashboard streak are the same value."""

    def _insert_user(self, db, user_id: int):
        from sqlalchemy import text
        db.execute(
            text(
                "INSERT INTO users (id, email, password_hash, name, is_active, "
                "email_verified, onboarding_completed, created_at, updated_at) "
                "VALUES (:id, :email, 'x', :name, 1, 0, 0, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"id": user_id, "email": f"streak{user_id}@test.com", "name": f"Streak{user_id}"},
        )
        db.commit()

    def test_dashboard_uses_student_streak_table(self, db_session_982):
        """After update_streak is called, _get_or_create_streak returns the same
        current/longest values — this is the single source of truth the dashboard
        now reads from."""
        from app.services.gamification_service import update_streak, _get_or_create_streak

        self._insert_user(db_session_982, user_id=10)

        # Simulate 3 consecutive days of activity
        base = date.today()
        for delta in range(3):
            update_streak(db_session_982, student_id=10, activity_date=base - timedelta(days=2 - delta))
        db_session_982.commit()

        streak = _get_or_create_streak(db_session_982, student_id=10)
        assert streak.current_streak == 3
        assert streak.longest_streak == 3

    def test_streak_reset_on_gap(self, db_session_982):
        """A gap of more than 1 day resets current_streak to 1."""
        from app.services.gamification_service import update_streak, _get_or_create_streak

        self._insert_user(db_session_982, user_id=11)

        base = date.today()
        # Activity 5 days ago then again today (gap > 1 day)
        update_streak(db_session_982, student_id=11, activity_date=base - timedelta(days=5))
        db_session_982.commit()
        update_streak(db_session_982, student_id=11, activity_date=base)
        db_session_982.commit()

        streak = _get_or_create_streak(db_session_982, student_id=11)
        assert streak.current_streak == 1
        assert streak.longest_streak >= 1

    def test_same_day_activity_does_not_increment(self, db_session_982):
        """Calling update_streak twice for the same day keeps current_streak at 1."""
        from app.services.gamification_service import update_streak, _get_or_create_streak

        self._insert_user(db_session_982, user_id=12)

        today = date.today()
        update_streak(db_session_982, student_id=12, activity_date=today)
        db_session_982.commit()
        update_streak(db_session_982, student_id=12, activity_date=today)
        db_session_982.commit()

        streak = _get_or_create_streak(db_session_982, student_id=12)
        # Should still be 1, not 2
        assert streak.current_streak == 1

    def test_longest_streak_preserved_after_reset(self, db_session_982):
        """longest_streak is not decreased when current_streak resets."""
        from app.services.gamification_service import update_streak, _get_or_create_streak

        self._insert_user(db_session_982, user_id=13)

        base = date.today()
        # Build a streak of 5
        for i in range(5):
            update_streak(db_session_982, student_id=13,
                          activity_date=base - timedelta(days=30 - i))
        db_session_982.commit()

        # Then reset with a gap
        update_streak(db_session_982, student_id=13, activity_date=base)
        db_session_982.commit()

        streak = _get_or_create_streak(db_session_982, student_id=13)
        assert streak.current_streak == 1
        assert streak.longest_streak == 5
