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
    def test_station_not_in_mapping_returns_none_and_writes_no_row(self, db_session):
        """Security review finding (2026-10-27): a station outside the
        15-station table previously still got a (fragment_awarded=False) log
        row written, purely to stay idempotent against repeat calls. Simpler
        and safer: there's nothing to make idempotent for a station that was
        never real — just return None, write nothing."""
        from app.services.word_baby_service import award_station_rewards
        from app.models.word_baby import StudentStationRewardLog

        _make_user(db_session, 1)
        result = award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="not-a-real-station",
            now=_now(), rng=_FakeRng(),
        )
        db_session.commit()

        assert result is None
        assert (
            db_session.query(StudentStationRewardLog)
            .filter_by(student_id=1, lesson_uid="L0001", station="not-a-real-station")
            .count()
            == 0
        )

    def test_calling_it_twice_for_an_unknown_station_still_writes_nothing(self, db_session):
        """Repeat calls for the same bogus station must both be no-ops — there's
        no idempotency ledger entry to check against, it just always returns
        None without touching the DB."""
        from app.services.word_baby_service import award_station_rewards
        from app.models.word_baby import StudentStationRewardLog

        _make_user(db_session, 1)
        award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="not-a-real-station",
            now=_now(), rng=_FakeRng(),
        )
        award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station="not-a-real-station",
            now=_now(), rng=_FakeRng(),
        )
        db_session.commit()

        assert (
            db_session.query(StudentStationRewardLog)
            .filter_by(student_id=1, lesson_uid="L0001", station="not-a-real-station")
            .count()
            == 0
        )

    def test_station_string_longer_than_column_width_is_rejected(self, db_session):
        """Defensive input validation: the `station` column is String(50) — a
        malicious/garbage client sending an absurdly long string must be
        rejected before it ever reaches the DB, not truncated or crash."""
        from app.services.word_baby_service import award_station_rewards
        from app.models.word_baby import StudentStationRewardLog

        _make_user(db_session, 1)
        huge_station = "x" * 500
        result = award_station_rewards(
            db_session, student_id=1, lesson_uid="L0001", station=huge_station,
            now=_now(), rng=_FakeRng(),
        )
        db_session.commit()

        assert result is None
        assert db_session.query(StudentStationRewardLog).filter_by(student_id=1).count() == 0


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


class TestWalletIncrementIsAtomicNotReadModifyWrite:
    """Security review finding (2026-10-27): the old `_add_to_wallet` did a
    client-side read-then-increment (`wallet = query().first(); wallet.quantity
    += amount` — the actual UPDATE SQL is deferred by SQLAlchemy until
    flush/commit). Two overlapping sessions can both read the exact same
    pre-increment snapshot before either has committed anything; the later
    commit silently overwrites with its own stale-computed literal instead of
    stacking on top of the winner's already-committed value — one increment
    is lost, with NO error raised anywhere (that's what makes it dangerous).

    Reproduced here with a FILE-BASED (not in-memory) SQLite database and two
    genuinely independent `Session` objects — in-memory SQLite doesn't share
    state across separate connections, so a file-based DB is the only way to
    make two distinct sessions see each other's committed data within one
    test, matching how two independent HTTP requests (each with their own
    SQLAlchemy Session) would actually behave.

    **Why this test accepts either "correct sum" or "a locking error" as
    passing for the fixed version** (not just "correct sum"): the fix changes
    `_add_to_wallet` to send `UPDATE ... SET quantity = quantity + :amount`
    to the database **immediately** (not deferred to commit like the old
    ORM-attribute version). SQLite enforces a single writer across the
    *entire database file* (unlike Postgres's per-row locking), so when both
    sessions attempt their write with neither having committed yet, the
    second one hits SQLite's coarse whole-file lock and raises
    `OperationalError: database is locked` outright — in Postgres (what
    production actually runs), the equivalent would instead silently BLOCK
    the second writer until the first commits, then correctly compute from
    the post-commit value, with no error at all. Both outcomes are genuine
    proof the increment is atomic; the one outcome that must NEVER happen —
    and is exactly what the old code produced — is a *successful* commit
    that silently lands on the wrong total.
    """

    def test_two_truly_overlapping_increments_never_silently_lose_one(self, tmp_path):
        from sqlalchemy import create_engine
        from sqlalchemy.exc import OperationalError
        from sqlalchemy.orm import sessionmaker

        import app.models  # noqa: F401
        from app.models.base import Base
        from app.models.word_baby import StudentFragmentWallet
        from app.services.word_baby_service import _add_to_wallet

        db_path = tmp_path / "wb_wallet_atomic_check.sqlite3"
        engine = create_engine(f"sqlite:///{db_path}")
        Base.metadata.create_all(engine)
        SessionLocal = sessionmaker(bind=engine)

        setup = SessionLocal()
        _make_user(setup, 1)
        setup.add(StudentFragmentWallet(student_id=1, flavor="x", quantity=0))
        setup.commit()
        setup.close()

        session_a = SessionLocal()
        session_b = SessionLocal()
        try:
            # Neither session has committed anything yet — both are about to
            # act on the exact same pre-increment state. This is the precise
            # race window the old client-side read-modify-write lost data in.
            _add_to_wallet(session_a, 1, "x", 3)
            _add_to_wallet(session_b, 1, "x", 5)
            session_a.commit()
            session_b.commit()
        except OperationalError:
            # Acceptable: SQLite's coarse whole-file lock refused the
            # overlapping write outright rather than silently computing a
            # wrong value — see class docstring.
            return
        finally:
            session_a.close()
            session_b.close()

        verify = SessionLocal()
        wallet = verify.query(StudentFragmentWallet).filter_by(student_id=1, flavor="x").first()
        # If both writes succeeded, their sum MUST be correct (0 + 3 + 5 =
        # 8) — the old code would land on 5 here (session_b's commit, having
        # read the stale quantity=0, silently overwrote session_a's +3).
        assert wallet.quantity == 8
        verify.close()
        engine.dispose()

    def test_wallet_quantity_can_never_go_negative_at_the_db_level(self, tmp_path):
        """Belt-and-suspenders for the same finding: even if some future
        caller passes a negative `amount` or otherwise computes a bad value,
        the DB-level CheckConstraint (migration f6185ba9cbf7) must reject it
        outright — this is deliberately testing the CONSTRAINT, not
        `_add_to_wallet` (which never passes negative amounts itself)."""
        from sqlalchemy import create_engine
        from sqlalchemy.exc import IntegrityError
        from sqlalchemy.orm import sessionmaker

        import app.models  # noqa: F401
        from app.models.base import Base
        from app.models.word_baby import StudentFragmentWallet

        db_path = tmp_path / "wb_wallet_checkconstraint_check.sqlite3"
        engine = create_engine(f"sqlite:///{db_path}")
        Base.metadata.create_all(engine)
        SessionLocal = sessionmaker(bind=engine)

        setup = SessionLocal()
        _make_user(setup, 1)
        setup.commit()

        setup.add(StudentFragmentWallet(student_id=1, flavor="x", quantity=-1))
        with pytest.raises(IntegrityError):
            setup.commit()
        setup.rollback()
        setup.close()
        engine.dispose()


class TestFeedBabyUsesRowLockingInProduction:
    """Security review finding (2026-10-27), continued: `feed_baby()` reads
    the owned-baby state and the whole wallet, then decides in Python how
    much to deduct and whether a stage completes. Without row locking, two
    overlapping feed requests for the same student could both read the
    pre-deduction snapshot and both decide "I can afford this", double-
    spending fragments that only exist once.

    `.with_for_update()` is a silent no-op on SQLite (confirmed by direct
    probing — no FOR UPDATE clause is emitted, no error raised either), so
    its actual locking behaviour can't be exercised by this repo's SQLite
    test suite. What CAN be verified deterministically, independent of which
    DB engine is running the tests, is that the query SQLAlchemy would send
    to a REAL Postgres database genuinely includes `FOR UPDATE` — i.e. that
    `feed_baby` actually requests the lock, not just that it runs without
    error on SQLite (which it would do either way, locked or not)."""

    def test_feed_baby_state_query_requests_for_update_on_postgres(self, db_session, monkeypatch):
        """`Query` objects are immutable — each `.filter_by()` / `.with_for_
        update()` call returns a NEW object rather than mutating in place.
        Spying on `db.query(Model)` (the first link in the chain) only ever
        captures the UN-chained base query, before `.with_for_update()` was
        even applied — it would always look identical regardless of whether
        the fix is present. Instead, patch `Query.first`/`Query.all` (the
        terminal methods `feed_baby` actually calls) to capture `self` at
        the point of execution, by which time every chained modifier —
        including `.with_for_update()` — has already been applied."""
        from sqlalchemy.dialects import postgresql
        from sqlalchemy.orm import Query

        from app.models.word_baby import StudentWordBabyState, StudentFragmentWallet
        from app.services import word_baby_service

        captured_queries = []
        original_first = Query.first
        original_all = Query.all

        def _spy_first(self):
            captured_queries.append(self)
            return original_first(self)

        def _spy_all(self):
            captured_queries.append(self)
            return original_all(self)

        monkeypatch.setattr(Query, "first", _spy_first)
        monkeypatch.setattr(Query, "all", _spy_all)

        _make_user(db_session, 1)
        baby_id = next(iter(config_babies_first_id()))
        db_session.add(StudentWordBabyState(student_id=1, baby_id=baby_id, stage_index=1))
        db_session.commit()

        try:
            word_baby_service.feed_baby(db_session, student_id=1, baby_id=baby_id, now=_now())
        except Exception:
            pass  # not asserting feed outcome here — only which SQL was built

        state_queries = [
            q for q in captured_queries
            if q.column_descriptions and q.column_descriptions[0]["type"] is StudentWordBabyState
        ]
        wallet_queries = [
            q for q in captured_queries
            if q.column_descriptions and q.column_descriptions[0]["type"] is StudentFragmentWallet
        ]
        assert state_queries, "feed_baby must query StudentWordBabyState"
        assert wallet_queries, "feed_baby must query StudentFragmentWallet"

        for q in state_queries + wallet_queries:
            compiled = str(q.statement.compile(dialect=postgresql.dialect()))
            assert "FOR UPDATE" in compiled.upper(), (
                f"expected FOR UPDATE in the Postgres-compiled SQL, got: {compiled}"
            )


def config_babies_first_id() -> list[str]:
    from app.services import word_baby_config as config

    return [next(iter(config.load_babies().keys()))]
