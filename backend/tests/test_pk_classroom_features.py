"""TDD for app.services.pk.classroom_features — PRD §7.4 (2026-10-16 revision:
one JSON `classrooms.feature_settings` column instead of a dedicated boolean
column). Recognized keys: "pk_human" (default False), "league" (default
False), "live_quiz" (default False) — issue #3607 extends the 真人 PK-only
accessor to also gate 跨班賽季 (league) and 課堂搶答 (live_quiz), each
default OFF per classroom, teacher opts in per class.

issue #3607 backward-compat rule: prod already has classrooms that were
using league/live_quiz before either had a toggle at all (they were simply
always-on). For THOSE TWO keys only, an absent key does not automatically
mean "off" — it falls back to "has this classroom actually used the
feature before" (a league team/season or a live-quiz game already exists
for it). An EXPLICIT value in `feature_settings` (True or False) always
wins over that fallback. `pk_human` has no such fallback: it never existed
before this toggle, so there is no legacy usage to preserve.
"""
from __future__ import annotations

import pytest

from app.services.pk import classroom_features as svc


class _FakeClassroom:
    def __init__(self, feature_settings, id=1):
        self.feature_settings = feature_settings
        self.id = id


class TestGetClassroomFeature:
    def test_empty_dict_gets_the_default_for_pk_human(self):
        c = _FakeClassroom({})
        assert svc.get_classroom_feature(c, "pk_human") is False

    def test_none_feature_settings_gets_the_default(self):
        """Defense in depth: a row written before the column had a value
        (shouldn't happen given NOT NULL + server_default, but the reader
        must not crash if it ever does)."""
        c = _FakeClassroom(None)
        assert svc.get_classroom_feature(c, "pk_human") is False

    def test_explicit_true_overrides_the_default(self):
        c = _FakeClassroom({"pk_human": True})
        assert svc.get_classroom_feature(c, "pk_human") is True

    def test_explicit_false_is_respected(self):
        c = _FakeClassroom({"pk_human": False})
        assert svc.get_classroom_feature(c, "pk_human") is False

    def test_unknown_key_raises(self):
        c = _FakeClassroom({})
        with pytest.raises(KeyError):
            svc.get_classroom_feature(c, "not_a_real_key")

    def test_league_defaults_to_false_just_like_pk_human(self):
        c = _FakeClassroom({})
        assert svc.get_classroom_feature(c, "league") is False

    def test_live_quiz_defaults_to_false_just_like_pk_human(self):
        c = _FakeClassroom({})
        assert svc.get_classroom_feature(c, "live_quiz") is False

    def test_league_explicit_true_overrides_the_default(self):
        c = _FakeClassroom({"league": True})
        assert svc.get_classroom_feature(c, "league") is True

    def test_live_quiz_explicit_true_overrides_the_default(self):
        c = _FakeClassroom({"live_quiz": True})
        assert svc.get_classroom_feature(c, "live_quiz") is True

    def test_no_db_passed_means_no_backward_compat_lookup_happens(self):
        """Without a `db` session the accessor can't check legacy usage at
        all — it must fall back to the static default, not raise or guess."""
        c = _FakeClassroom({})
        assert svc.get_classroom_feature(c, "league") is False
        assert svc.get_classroom_feature(c, "live_quiz") is False


class TestValidateFeatureSettingsPatch:
    def test_accepts_known_boolean_key(self):
        cleaned = svc.validate_feature_settings_patch({"pk_human": True})
        assert cleaned == {"pk_human": True}

    def test_accepts_league_and_live_quiz_keys(self):
        cleaned = svc.validate_feature_settings_patch({"league": True, "live_quiz": False})
        assert cleaned == {"league": True, "live_quiz": False}

    def test_rejects_unknown_key(self):
        with pytest.raises(Exception):
            svc.validate_feature_settings_patch({"made_up_feature": True})

    def test_rejects_non_boolean_value(self):
        with pytest.raises(Exception):
            svc.validate_feature_settings_patch({"pk_human": "yes"})

    def test_empty_patch_is_valid_noop(self):
        assert svc.validate_feature_settings_patch({}) == {}


class TestBackwardCompatLegacyUsage:
    """issue #3607: a classroom that was already using league/live_quiz
    BEFORE the toggle existed (so `feature_settings` has never been
    written for that key) must keep working — "has it ever actually used
    this feature" substitutes for the static default, but only when the
    key is truly ABSENT. An explicit False in the column always wins,
    even over real usage history (a teacher who deliberately turns it off
    must be obeyed, not second-guessed by their own class's history).
    """

    @pytest.fixture()
    def db_session(self):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from app.models.base import Base
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

    def _classroom(self, db, *, feature_settings=None):
        from league_factories import make_classroom, make_school, make_teacher

        teacher = make_teacher(db)
        school = make_school(db)
        return make_classroom(db, school, teacher, feature_settings=feature_settings)

    def test_brand_new_classroom_with_no_history_is_off(self, db_session):
        room = self._classroom(db_session)
        assert svc.get_classroom_feature(room, "league", db=db_session) is False
        assert svc.get_classroom_feature(room, "live_quiz", db=db_session) is False

    def test_classroom_with_a_league_team_but_no_key_is_treated_as_on(self, db_session):
        from app.models.league import LeagueSeason, LeagueTeam

        room = self._classroom(db_session)
        season = LeagueSeason(
            kind="invitational", name="test season",
            game_start=__import__("datetime").datetime(2026, 1, 1, tzinfo=__import__("datetime").timezone.utc),
            game_end=__import__("datetime").datetime(2026, 1, 8, tzinfo=__import__("datetime").timezone.utc),
            weights_snapshot={}, created_by=room.teacher_id,
        )
        db_session.add(season)
        db_session.flush()
        db_session.add(LeagueTeam(season_id=season.id, classroom_id=room.id, grade=4, registered_by=room.teacher_id))
        db_session.commit()

        assert svc.get_classroom_feature(room, "league", db=db_session) is True
        # live_quiz has no history for this room — must stay off.
        assert svc.get_classroom_feature(room, "live_quiz", db=db_session) is False

    def test_classroom_with_a_live_quiz_game_but_no_key_is_treated_as_on(self, db_session):
        from datetime import datetime, timedelta, timezone
        from app.models.live_quiz import LiveQuizGame

        room = self._classroom(db_session)
        now = datetime.now(timezone.utc)
        db_session.add(
            LiveQuizGame(
                code="123456", host_teacher_id=room.teacher_id, classroom_id=room.id,
                status="ended", settings={}, rounds_snapshot=[], seed=1, version=1,
                created_at=now, expires_at=now + timedelta(hours=3),
            )
        )
        db_session.commit()

        assert svc.get_classroom_feature(room, "live_quiz", db=db_session) is True
        assert svc.get_classroom_feature(room, "league", db=db_session) is False

    def test_explicit_false_wins_even_with_history(self, db_session):
        """The teacher's explicit off beats their own class's history."""
        from app.models.live_quiz import LiveQuizGame
        from datetime import datetime, timedelta, timezone

        room = self._classroom(db_session, feature_settings={"live_quiz": False})
        now = datetime.now(timezone.utc)
        db_session.add(
            LiveQuizGame(
                code="654321", host_teacher_id=room.teacher_id, classroom_id=room.id,
                status="ended", settings={}, rounds_snapshot=[], seed=1, version=1,
                created_at=now, expires_at=now + timedelta(hours=3),
            )
        )
        db_session.commit()

        assert svc.get_classroom_feature(room, "live_quiz", db=db_session) is False

    def test_explicit_true_also_short_circuits_without_needing_a_db(self, db_session):
        """Explicit True must not even need the `db` probe — same contract
        as pk_human's existing "no db argument" call sites."""
        room = self._classroom(db_session, feature_settings={"league": True})
        assert svc.get_classroom_feature(room, "league") is True

    def test_history_lookup_is_scoped_to_the_classroom_not_global(self, db_session):
        """A DIFFERENT classroom's league team must not leak an ON result
        onto this one."""
        from app.models.league import LeagueSeason, LeagueTeam

        room = self._classroom(db_session)
        other_room = self._classroom(db_session)
        season = LeagueSeason(
            kind="invitational", name="test season",
            game_start=__import__("datetime").datetime(2026, 1, 1, tzinfo=__import__("datetime").timezone.utc),
            game_end=__import__("datetime").datetime(2026, 1, 8, tzinfo=__import__("datetime").timezone.utc),
            weights_snapshot={}, created_by=other_room.teacher_id,
        )
        db_session.add(season)
        db_session.flush()
        db_session.add(
            LeagueTeam(season_id=season.id, classroom_id=other_room.id, grade=4, registered_by=other_room.teacher_id)
        )
        db_session.commit()

        assert svc.get_classroom_feature(room, "league", db=db_session) is False
        assert svc.get_classroom_feature(other_room, "league", db=db_session) is True

    def test_pk_human_has_no_legacy_fallback_even_with_a_db(self, db_session):
        """pk_human never existed before this toggle — there is no history
        to look up, so passing `db` must not change its behavior at all."""
        room = self._classroom(db_session)
        assert svc.get_classroom_feature(room, "pk_human", db=db_session) is False
