"""TDD tests for the gamification service (XP, badges, streaks, levels).

Pure-logic tests use no DB. Service-level tests use SQLite in-memory.
"""
from __future__ import annotations

import pytest
from datetime import date, datetime, timezone, timedelta

from app.models.gamification import (
    BADGE_CATALOGUE,
    LEVEL_THRESHOLDS,
    LEVEL_NAMES,
    StudentBadge,
    StudentStreak,
    StudentXPLog,
    level_progress,
    xp_to_level,
)


# ── Fixtures: in-memory SQLite database ───────────────────────────────────────


@pytest.fixture()
def db_session():
    """Create an isolated in-memory SQLite DB for each test."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.models.base import Base
    # Import all models so they register their tables
    import app.models  # noqa: F401

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _make_user(db_session, user_id: int = 1):
    """Insert a minimal User row so FK constraints pass."""
    from sqlalchemy import text
    # Insert directly to avoid importing full User model with its hashing
    db_session.execute(
        text(
            "INSERT INTO users (id, email, password_hash, name, is_active, email_verified,"
            " onboarding_completed, created_at, updated_at)"
            " VALUES (:id, :email, 'x', :name, 1, 0, 0,"
            " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {"id": user_id, "email": f"student{user_id}@test.com", "name": f"Student{user_id}"},
    )
    db_session.commit()


def _make_session(db_session, session_id: int = 1, student_id: int = 1, status: str = "completed"):
    """Insert a minimal LearningSession row."""
    from sqlalchemy import text
    db_session.execute(
        text(
            "INSERT INTO learning_sessions (id, student_id, status, current_step, started_at)"
            " VALUES (:id, :student_id, :status, 1, CURRENT_TIMESTAMP)"
        ),
        {"id": session_id, "student_id": student_id, "status": status},
    )
    db_session.commit()


# ── Unit tests: level calculation (pure functions, no DB) ─────────────────────


class TestXpToLevel:
    def test_zero_xp_is_level_1(self):
        assert xp_to_level(0) == 1

    def test_99_xp_is_level_1(self):
        assert xp_to_level(99) == 1

    def test_exactly_100_xp_is_level_2(self):
        assert xp_to_level(100) == 2

    def test_249_xp_is_level_2(self):
        assert xp_to_level(249) == 2

    def test_250_xp_is_level_3(self):
        assert xp_to_level(250) == 3

    def test_4000_xp_is_level_10(self):
        assert xp_to_level(4000) == 10

    def test_9999_xp_capped_at_level_10(self):
        assert xp_to_level(9999) == 10

    def test_negative_xp_is_level_1(self):
        assert xp_to_level(-10) == 1


class TestLevelProgress:
    def test_returns_all_required_fields(self):
        result = level_progress(0)
        for key in ("level", "level_name", "total_xp", "current_level_xp",
                    "next_level_xp", "xp_to_next", "progress_pct"):
            assert key in result

    def test_level_1_at_0_xp(self):
        result = level_progress(0)
        assert result["level"] == 1
        assert result["level_name"] == "初學者"
        assert result["progress_pct"] == 0

    def test_level_1_halfway(self):
        result = level_progress(50)
        assert result["level"] == 1
        assert result["progress_pct"] == 50

    def test_level_2_name(self):
        result = level_progress(100)
        assert result["level_name"] == "求知者"

    def test_max_level_progress_100(self):
        result = level_progress(4000)
        assert result["progress_pct"] == 100
        assert result["xp_to_next"] == 0
        assert result["next_level_xp"] is None

    def test_level_name_count_matches_thresholds(self):
        assert len(LEVEL_NAMES) == len(LEVEL_THRESHOLDS)


class TestLevelProgressEdge:
    def test_xp_exactly_at_threshold(self):
        for i, threshold in enumerate(LEVEL_THRESHOLDS[1:], start=2):
            result = level_progress(threshold)
            assert result["level"] == i, f"XP={threshold} should be level {i}"

    def test_progress_never_exceeds_100(self):
        for xp in range(0, 5000, 50):
            result = level_progress(xp)
            assert result["progress_pct"] <= 100


class TestBadgeCatalogue:
    """Tests for badge catalogue completeness — issue #527."""

    def test_first_session_badge_exists(self):
        assert "first_session" in BADGE_CATALOGUE

    def test_first_session_has_chinese_name(self):
        badge = BADGE_CATALOGUE["first_session"]
        assert "name" in badge
        # Name must not be the raw English key
        assert badge["name"] != "first_session"
        # Should contain at least one CJK character
        assert any("\u4e00" <= ch <= "\u9fff" for ch in badge["name"])

    def test_all_badges_have_chinese_names(self):
        """Regression: every badge in BADGE_CATALOGUE must have a non-empty Chinese name."""
        for key, info in BADGE_CATALOGUE.items():
            name = info.get("name", "")
            assert name, f"Badge {key!r} is missing 'name'"
            assert name != key, f"Badge {key!r} name is the same as the key (raw English)"
            assert any("\u4e00" <= ch <= "\u9fff" for ch in name), (
                f"Badge {key!r} name {name!r} has no Chinese characters"
            )


# ── Integration tests: process_session_completion ─────────────────────────────


class TestProcessSessionCompletion:
    """Integration tests using in-memory SQLite."""

    def test_base_xp_awarded(self, db_session):
        from app.services.gamification_service import process_session_completion
        _make_user(db_session, 1)
        _make_session(db_session, 1, 1)

        result = process_session_completion(db_session, student_id=1, session_id=1)
        assert result["xp_earned"] >= 20

    def test_result_has_required_keys(self, db_session):
        from app.services.gamification_service import process_session_completion
        _make_user(db_session, 1)
        _make_session(db_session, 1, 1)

        result = process_session_completion(db_session, student_id=1, session_id=1)
        for key in ("xp_earned", "new_total_xp", "level_info", "streak", "badges_unlocked"):
            assert key in result

    def test_first_story_bonus_on_no_prior_xp(self, db_session):
        from app.services.gamification_service import process_session_completion
        _make_user(db_session, 1)
        _make_session(db_session, 1, 1)

        result = process_session_completion(db_session, student_id=1, session_id=1)
        # session_complete(20) + first_story(30) = 50 minimum
        assert result["xp_earned"] >= 50

    def test_accuracy_90_bonus(self, db_session):
        from app.services.gamification_service import process_session_completion
        _make_user(db_session, 1)
        _make_session(db_session, 1, 1)
        _make_session(db_session, 2, 1)  # second session

        # Seed prior XP so it's not first story
        db_session.add(StudentXPLog(student_id=1, event_type="session_complete", xp_earned=20, session_id=1))
        db_session.commit()

        result = process_session_completion(db_session, student_id=1, session_id=2,
                                            reading_accuracy=95.0)
        # Should include accuracy_90 bonus
        event_types = [e["event_type"] for e in result["xp_breakdown"]]
        assert "accuracy_90" in event_types

    def test_accuracy_70_bonus(self, db_session):
        from app.services.gamification_service import process_session_completion
        _make_user(db_session, 1)
        _make_session(db_session, 1, 1)
        _make_session(db_session, 2, 1)

        db_session.add(StudentXPLog(student_id=1, event_type="session_complete", xp_earned=20, session_id=1))
        db_session.commit()

        result = process_session_completion(db_session, student_id=1, session_id=2,
                                            reading_accuracy=75.0)
        event_types = [e["event_type"] for e in result["xp_breakdown"]]
        assert "accuracy_70" in event_types
        assert "accuracy_90" not in event_types

    def test_comprehension_passed_bonus(self, db_session):
        from app.services.gamification_service import process_session_completion
        _make_user(db_session, 1)
        _make_session(db_session, 1, 1)

        result = process_session_completion(db_session, student_id=1, session_id=1,
                                            comprehension_passed=True)
        event_types = [e["event_type"] for e in result["xp_breakdown"]]
        assert "comprehension_pass" in event_types

    def test_first_story_badge_unlocked(self, db_session):
        from app.services.gamification_service import process_session_completion
        _make_user(db_session, 1)
        _make_session(db_session, 1, 1)

        result = process_session_completion(db_session, student_id=1, session_id=1)
        assert "first_story" in result["badges_unlocked"]

    def test_first_story_badge_not_awarded_twice(self, db_session):
        from app.services.gamification_service import process_session_completion
        _make_user(db_session, 1)
        _make_session(db_session, 1, 1)
        _make_session(db_session, 2, 1)

        result1 = process_session_completion(db_session, student_id=1, session_id=1)
        assert "first_story" in result1["badges_unlocked"]

        result2 = process_session_completion(db_session, student_id=1, session_id=2)
        assert "first_story" not in result2["badges_unlocked"]

    def test_new_total_xp_accumulates(self, db_session):
        from app.services.gamification_service import process_session_completion
        _make_user(db_session, 1)
        _make_session(db_session, 1, 1)
        _make_session(db_session, 2, 1)

        r1 = process_session_completion(db_session, student_id=1, session_id=1)
        r2 = process_session_completion(db_session, student_id=1, session_id=2)
        assert r2["new_total_xp"] > r1["new_total_xp"]

    def test_level_info_in_result(self, db_session):
        from app.services.gamification_service import process_session_completion
        _make_user(db_session, 1)
        _make_session(db_session, 1, 1)

        result = process_session_completion(db_session, student_id=1, session_id=1)
        lv = result["level_info"]
        assert lv["level"] >= 1
        assert lv["level_name"] in LEVEL_NAMES


# ── Integration tests: update_streak ─────────────────────────────────────────


class TestUpdateStreak:
    def test_first_activity_creates_streak(self, db_session):
        from app.services.gamification_service import update_streak
        _make_user(db_session, 1)

        streak = update_streak(db_session, student_id=1, activity_date=date(2026, 3, 9))
        assert streak.current_streak == 1
        assert streak.longest_streak == 1

    def test_consecutive_day_extends_streak(self, db_session):
        from app.services.gamification_service import update_streak
        _make_user(db_session, 1)

        update_streak(db_session, student_id=1, activity_date=date(2026, 3, 8))
        streak = update_streak(db_session, student_id=1, activity_date=date(2026, 3, 9))
        assert streak.current_streak == 2
        assert streak.longest_streak == 2

    def test_same_day_does_not_extend_streak(self, db_session):
        from app.services.gamification_service import update_streak
        _make_user(db_session, 1)

        update_streak(db_session, student_id=1, activity_date=date(2026, 3, 9))
        streak = update_streak(db_session, student_id=1, activity_date=date(2026, 3, 9))
        assert streak.current_streak == 1

    def test_gap_resets_streak(self, db_session):
        from app.services.gamification_service import update_streak
        _make_user(db_session, 1)

        update_streak(db_session, student_id=1, activity_date=date(2026, 3, 1))
        update_streak(db_session, student_id=1, activity_date=date(2026, 3, 2))
        # Gap of 3 days
        streak = update_streak(db_session, student_id=1, activity_date=date(2026, 3, 9))
        assert streak.current_streak == 1

    def test_longest_streak_preserved_after_reset(self, db_session):
        from app.services.gamification_service import update_streak
        _make_user(db_session, 1)

        # Build a 3-day streak
        for d in [date(2026, 3, 1), date(2026, 3, 2), date(2026, 3, 3)]:
            update_streak(db_session, student_id=1, activity_date=d)
        # Gap — reset
        streak = update_streak(db_session, student_id=1, activity_date=date(2026, 3, 9))
        assert streak.current_streak == 1
        assert streak.longest_streak == 3
