"""TDD tests for the word-baby reward/feed/query service (#3780).

Covers the security-sensitive core: reward determination must be idempotent
and must use an injectable RNG (production uses `secrets.SystemRandom()`;
tests inject a fake deterministic RNG so results are controllable — this is
NOT the same thing as the public deterministic hash the security review
banned; it's dependency injection for testability, the fake RNG never ships).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


@pytest.fixture()
def db_session():
    import app.models  # noqa: F401
    from app.models.base import Base

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
    db_session.execute(
        text(
            "INSERT INTO users (id, email, password_hash, name, is_active, email_verified,"
            " onboarding_completed, created_at, updated_at)"
            " VALUES (:id, :email, 'x', :name, 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {"id": user_id, "email": f"student{user_id}@test.com", "name": f"Student{user_id}"},
    )
    db_session.commit()


class _FakeRng:
    """Deterministic stand-in for secrets.SystemRandom() in tests.

    `random_values` is consumed in order, one call = one value, so a test can
    script exactly which branch (drop/no-drop, which rarity, caught/duplicate)
    a given call takes without touching any real randomness source.
    """

    def __init__(self, random_values=None, choice_index=0):
        self._random_values = list(random_values or [])
        self._choice_index = choice_index

    def random(self) -> float:
        if not self._random_values:
            return 0.999999  # default: "never happens" for anything left unscripted
        return self._random_values.pop(0)

    def choice(self, seq):
        return seq[self._choice_index % len(seq)]


def _now():
    return datetime(2026, 10, 26, 12, 0, 0, tzinfo=timezone.utc)


class TestAwardStationRewardsIdempotency:
    def test_same_station_only_rewarded_once(self, db_session):
        from app.services.word_baby_service import award_station_rewards

        _make_user(db_session, 1)
        rng = _FakeRng(random_values=[0.01, 0.01])  # force both fragment + encounter
        log1 = award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="vocab-definition",
            now=_now(), rng=rng,
        )
        db_session.commit()

        # Second call — even with an rng that WOULD force a different result if
        # re-rolled — must return the SAME persisted row, untouched.
        rng2 = _FakeRng(random_values=[0.999999, 0.999999])  # would force "no drop" if re-rolled
        log2 = award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="vocab-definition",
            now=_now(), rng=rng2,
        )

        assert log1.id == log2.id
        assert log1.fragment_awarded == log2.fragment_awarded
        from app.models.word_baby import StudentStationRewardLog
        count = (
            db_session.query(StudentStationRewardLog)
            .filter_by(student_id=1, lesson_uid="L0001", station="vocab-definition")
            .count()
        )
        assert count == 1

    def test_same_station_different_lesson_rewards_independently(self, db_session):
        from app.services.word_baby_service import award_station_rewards

        _make_user(db_session, 1)
        rng = _FakeRng(random_values=[0.01, 0.999999])
        award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="lesson-intro",
            now=_now(), rng=rng,
        )
        db_session.commit()
        rng2 = _FakeRng(random_values=[0.01, 0.999999])
        award_station_rewards(
            db_session, student_id=1, lesson_uid="L0002", station="lesson-intro",
            now=_now(), rng=rng2,
        )
        db_session.commit()

        from app.models.word_baby import StudentStationRewardLog
        assert db_session.query(StudentStationRewardLog).filter_by(student_id=1).count() == 2


class TestFragmentDrop:
    def test_fragment_dropped_adds_to_wallet(self, db_session):
        from app.services.word_baby_service import award_station_rewards
        from app.models.word_baby import StudentFragmentWallet

        _make_user(db_session, 1)
        # random() call order: [fragment_roll, encounter_roll]
        rng = _FakeRng(random_values=[0.01, 0.999999])  # drop fragment, no encounter
        award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="vocab-definition",
            now=_now(), rng=rng,
        )
        db_session.commit()

        wallet = db_session.query(StudentFragmentWallet).filter_by(student_id=1, flavor="語文基礎").first()
        assert wallet is not None
        assert wallet.quantity == 1

    def test_fragment_not_dropped_below_threshold_miss(self, db_session):
        from app.services.word_baby_service import award_station_rewards
        from app.models.word_baby import StudentFragmentWallet

        _make_user(db_session, 1)
        rng = _FakeRng(random_values=[0.999999, 0.999999])  # miss both rolls
        log = award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="vocab-definition",
            now=_now(), rng=rng,
        )
        db_session.commit()

        assert log.fragment_awarded is False
        wallet = db_session.query(StudentFragmentWallet).filter_by(student_id=1, flavor="語文基礎").first()
        assert wallet is None  # never created, not created-with-zero


class TestEncounterCatch:
    def test_encounter_catches_a_new_baby(self, db_session):
        from app.services.word_baby_service import award_station_rewards
        from app.models.word_baby import StudentWordBabyState

        _make_user(db_session, 1)
        # fragment roll misses (0.999999); encounter roll hits common tier (0.001, well
        # under common's base rate) -> picks index 0 of eligible candidates via choice
        rng = _FakeRng(random_values=[0.999999, 0.001], choice_index=0)
        log = award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="vocab-definition",
            now=_now(), rng=rng,
        )
        db_session.commit()

        assert log.encounter_result == "caught"
        assert log.encounter_baby_id is not None
        owned = db_session.query(StudentWordBabyState).filter_by(student_id=1).all()
        assert len(owned) == 1
        assert owned[0].baby_id == log.encounter_baby_id
        assert owned[0].stage_index == 1

    def test_duplicate_encounter_grants_bonus_fragments_not_second_copy(self, db_session):
        from app.services.word_baby_service import award_station_rewards
        from app.models.word_baby import StudentWordBabyState, StudentFragmentWallet
        from app.services import word_baby_config as config

        _make_user(db_session, 1)
        # First: catch every eligible common baby for this station's flavor so the
        # next encounter at the same rarity+flavor has nobody new left to catch.
        flavor = config.get_station_flavor("vocab-definition")
        common_candidates = [
            bid for bid in config.babies_by_flavor()[flavor]
            if config.get_baby(bid)["rarity"] == "common"
        ]
        for i, bid in enumerate(common_candidates):
            db_session.add(
                StudentWordBabyState(student_id=1, baby_id=bid, stage_index=1, last_cared_at=_now())
            )
        db_session.commit()

        rng = _FakeRng(random_values=[0.999999, 0.001], choice_index=0)  # hit common tier again
        log = award_station_rewards(
            db_session, student_id=1, lesson_uid="L0002", station="vocab-definition",
            now=_now(), rng=rng,
        )
        db_session.commit()

        assert log.encounter_result == "duplicate"
        # no new state rows beyond the ones we pre-seeded
        assert db_session.query(StudentWordBabyState).filter_by(student_id=1).count() == len(common_candidates)
        wallet = db_session.query(StudentFragmentWallet).filter_by(student_id=1, flavor=flavor).first()
        assert wallet is not None
        assert wallet.quantity > 0


class TestUnknownStation:
    def test_station_not_in_mapping_still_logs_idempotently(self, db_session):
        """A station outside the 15-station table (data-quality gap, or future
        content type) must not crash and must not be re-rolled on every call."""
        from app.services.word_baby_service import award_station_rewards
        from app.models.word_baby import StudentStationRewardLog

        _make_user(db_session, 1)
        rng = _FakeRng()
        log1 = award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="not-a-real-station",
            now=_now(), rng=rng,
        )
        db_session.commit()
        log2 = award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="not-a-real-station",
            now=_now(), rng=_FakeRng(),
        )

        assert log1.id == log2.id
        assert log1.fragment_awarded is False
        assert (
            db_session.query(StudentStationRewardLog)
            .filter_by(student_id=1, lesson_uid="L0001", station="not-a-real-station")
            .count()
            == 1
        )


class TestConcurrentRewardDoesNotCrashOrDoubleReward:
    """code-reviewer finding: two near-simultaneous requests for the same
    station both pass the "existing is None" check before either commits —
    the DB unique constraint catches the second INSERT, but that must not
    surface as an unhandled IntegrityError up through the caller."""

    def test_integrity_error_on_insert_is_recovered_by_refetching_existing(self, db_session, monkeypatch):
        from app.services import word_baby_service
        from app.models.word_baby import StudentStationRewardLog

        _make_user(db_session, 1)

        # Simulate "someone else already committed this exact row microseconds
        # ago": insert it directly (bypassing the function under test), so when
        # the function's own attempt collides, the unique constraint fires for
        # real — not a mocked exception.
        winner = StudentStationRewardLog(
            student_id=1, lesson_uid="L0001", station="vocab-definition",
            fragment_awarded=True, fragment_flavor="語文基礎", encounter_result="none",
        )
        db_session.add(winner)
        db_session.commit()

        # Force our own call to believe no row exists yet (simulating the race
        # window where its own SELECT ran before the winner's COMMIT became
        # visible to it) by monkeypatching the existence check once.
        original_get_existing = word_baby_service._get_existing_log
        call_count = {"n": 0}

        def _fake_get_existing(db, student_id, lesson_uid, station):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return None  # first check: pretend nothing exists yet (the race)
            return original_get_existing(db, student_id, lesson_uid, station)

        monkeypatch.setattr(word_baby_service, "_get_existing_log", _fake_get_existing)

        rng = _FakeRng(random_values=[0.999999, 0.999999])
        result = word_baby_service.award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="vocab-definition",
            now=_now(), rng=rng,
        )

        # Must not raise; must return the pre-existing (winning) row, not crash
        # or silently create a second one.
        assert result.id == winner.id
        assert (
            db_session.query(StudentStationRewardLog)
            .filter_by(student_id=1, lesson_uid="L0001", station="vocab-definition")
            .count()
            == 1
        )

    def test_losing_side_effects_are_rolled_back_not_double_counted(self, db_session, monkeypatch):
        """If our losing attempt would have also dropped a fragment, that
        fragment must not silently land in the wallet once we discover we lost
        the race — otherwise two concurrent requests inflate the wallet even
        though only one reward_log row exists."""
        from app.services import word_baby_service
        from app.models.word_baby import StudentStationRewardLog, StudentFragmentWallet

        _make_user(db_session, 1)
        winner = StudentStationRewardLog(
            student_id=1, lesson_uid="L0001", station="vocab-definition",
            fragment_awarded=False, encounter_result="none",
        )
        db_session.add(winner)
        db_session.commit()

        original_get_existing = word_baby_service._get_existing_log
        call_count = {"n": 0}

        def _fake_get_existing(db, student_id, lesson_uid, station):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return None
            return original_get_existing(db, student_id, lesson_uid, station)

        monkeypatch.setattr(word_baby_service, "_get_existing_log", _fake_get_existing)

        rng = _FakeRng(random_values=[0.01, 0.999999])  # our losing attempt WOULD drop a fragment
        word_baby_service.award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="vocab-definition",
            now=_now(), rng=rng,
        )

        wallet = db_session.query(StudentFragmentWallet).filter_by(student_id=1, flavor="語文基礎").first()
        assert wallet is None or wallet.quantity == 0
