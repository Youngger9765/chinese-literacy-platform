"""SqlAlchemyStoryPackStore — the DB-backed StoryPackStore (2026-10-16,
issue #3594 comment: Young approved the `story_packs` table +
`league_seasons.story_pack_key` FK, generalized from a league-only name).
These tests exercise the real store against a real schema (via
Base.metadata.create_all on SQLite, same pattern as every other model test
in this suite — tests/conftest.py patches JSONB -> JSON for SQLite).

Covers: store CRUD (list/get/upsert/delete), the full resolve_pack_for_season
fallback chain, FK-respecting season assignment, and that an invalid pack
payload is rejected before ever reaching the store (schema validation, not a
DB constraint).
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.league import LeagueSeason
from app.models.story_pack import StoryPackRow
from app.models.user import User
from app.services.story_pack_defaults import MYTH_PACK_KEY, SONG_PACK_KEY, TANG_PACK_KEY
from app.services.story_pack_store import (
    SqlAlchemyStoryPackStore,
    StoryPackStoreError,
    resolve_pack_for_season,
)
from app.services import story_pack_service as svc
from app.schemas.story_pack import StoryPack

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _fk(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def _schema():
    """Base.metadata.create_all() builds the schema but — unlike the real
    alembic migration (7e0ca622e3d8_*.py) — does not run its data seed. The
    FK (league_seasons.story_pack_key -> story_packs.key) is real, so any
    test that assigns a BUILTIN key to a season needs that row to actually
    exist, exactly like production does after the migration runs. Seed it
    here so these tests exercise the real constraint rather than quietly
    disabling foreign_keys enforcement to dodge it."""
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        from app.services.story_pack_defaults import BUILTIN_PACKS

        for key, pack in BUILTIN_PACKS.items():
            conn.execute(
                StoryPackRow.__table__.insert().values(
                    key=key, content=pack.model_dump(mode="json"), is_builtin=True
                )
            )
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    s = Session()
    try:
        yield s
    finally:
        s.close()


def _make_user(db) -> User:
    u = User(
        email=f"{uuid.uuid4().hex}@example.com",
        password_hash="x",
        name="Teacher",
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _make_season(db, user: User, *, story_pack_key: str | None = None) -> LeagueSeason:
    now = datetime.now(timezone.utc)
    season = LeagueSeason(
        kind="invitational",
        name="測試賽季",
        invitation_id=None,
        game_start=now,
        game_end=now + timedelta(days=1),
        weights_snapshot={},
        created_by=user.id,
        story_pack_key=story_pack_key,
    )
    db.add(season)
    db.commit()
    db.refresh(season)
    return season


VALID_PACK_PAYLOAD = {
    "era": "明",
    "title": "鄭和下西洋賽",
    "intro": ["船隊出航，兩班讀家一起補給遠航的糧草。"],
    "faction_labels": ["船隊東路", "船隊西路"],
    "energy_bar_label": "補給",
    "milestones": [{"ratio": 1.0, "message": "補給齊全，啟航"}],
    "chest": {"name": "寶船寶箱", "description": "全班過半參與即可開啟", "art": {"kind": "emoji", "value": "🚢"}},
    "badges": [
        {"key": "individual_badge", "name": "領航勳章", "description": "個人達標", "art": {"kind": "emoji", "value": "⭐"}},
        {"key": "class_badge", "name": "船隊勳章", "description": "班級達標", "art": {"kind": "emoji", "value": "🏅"}},
    ],
    "result_copy": {"win": "勝利", "lose": "再接再厲", "draw": "平手"},
}


class TestCrud:
    def test_list_custom_empty_by_default(self, db):
        store = SqlAlchemyStoryPackStore(db)
        assert store.list_custom() == {}

    def test_upsert_then_get_round_trips(self, db):
        store = SqlAlchemyStoryPackStore(db)
        pack = StoryPack(key="ming-voyage", **VALID_PACK_PAYLOAD)
        store.upsert_custom(pack)

        fetched = store.get_custom("ming-voyage")
        assert fetched is not None
        assert fetched.title == "鄭和下西洋賽"

        # Persisted as a real row, not process memory.
        row = db.query(StoryPackRow).filter(StoryPackRow.key == "ming-voyage").one()
        assert row.is_builtin is False
        assert row.content["title"] == "鄭和下西洋賽"

    def test_upsert_is_update_not_duplicate(self, db):
        store = SqlAlchemyStoryPackStore(db)
        pack = StoryPack(key="ming-voyage", **VALID_PACK_PAYLOAD)
        store.upsert_custom(pack)
        updated_payload = dict(VALID_PACK_PAYLOAD, title="鄭和下西洋賽（修訂版）")
        store.upsert_custom(StoryPack(key="ming-voyage", **updated_payload))

        rows = db.query(StoryPackRow).filter(StoryPackRow.key == "ming-voyage").all()
        assert len(rows) == 1
        assert store.get_custom("ming-voyage").title == "鄭和下西洋賽（修訂版）"

    def test_cannot_upsert_over_builtin_key(self, db):
        store = SqlAlchemyStoryPackStore(db)
        pack = StoryPack(key=TANG_PACK_KEY, **VALID_PACK_PAYLOAD)
        with pytest.raises(StoryPackStoreError) as exc:
            store.upsert_custom(pack)
        assert exc.value.status_code == 409

    def test_delete_removes_row(self, db):
        store = SqlAlchemyStoryPackStore(db)
        store.upsert_custom(StoryPack(key="ming-voyage", **VALID_PACK_PAYLOAD))
        assert store.delete_custom("ming-voyage") is True
        assert store.get_custom("ming-voyage") is None
        assert db.query(StoryPackRow).filter(StoryPackRow.key == "ming-voyage").first() is None

    def test_delete_missing_returns_false(self, db):
        store = SqlAlchemyStoryPackStore(db)
        assert store.delete_custom("does-not-exist") is False

    def test_cannot_delete_builtin(self, db):
        store = SqlAlchemyStoryPackStore(db)
        with pytest.raises(StoryPackStoreError) as exc:
            store.delete_custom(TANG_PACK_KEY)
        assert exc.value.status_code == 409

    def test_delete_clears_season_override_first(self, db):
        """The FK (league_seasons.story_pack_key -> story_packs.key) would
        otherwise block the delete outright — this proves the store clears
        the dangling reference rather than crashing or leaving orphaned
        state."""
        store = SqlAlchemyStoryPackStore(db)
        user = _make_user(db)
        store.upsert_custom(StoryPack(key="ming-voyage", **VALID_PACK_PAYLOAD))
        season = _make_season(db, user, story_pack_key="ming-voyage")

        assert store.delete_custom("ming-voyage") is True

        db.refresh(season)
        assert season.story_pack_key is None


class TestSeasonAssignment:
    def test_get_season_story_pack_key_reads_real_column(self, db):
        store = SqlAlchemyStoryPackStore(db)
        user = _make_user(db)
        store.upsert_custom(StoryPack(key="ming-voyage", **VALID_PACK_PAYLOAD))
        season = _make_season(db, user, story_pack_key="ming-voyage")

        assert store.get_season_story_pack_key(season.id) == "ming-voyage"

    def test_set_season_story_pack_key_writes_real_column(self, db):
        store = SqlAlchemyStoryPackStore(db)
        user = _make_user(db)
        season = _make_season(db, user)
        store.set_season_story_pack_key(season.id, SONG_PACK_KEY)

        db.refresh(season)
        assert season.story_pack_key == SONG_PACK_KEY

    def test_set_season_story_pack_key_clear_with_none(self, db):
        store = SqlAlchemyStoryPackStore(db)
        user = _make_user(db)
        season = _make_season(db, user, story_pack_key=TANG_PACK_KEY)
        store.set_season_story_pack_key(season.id, None)

        db.refresh(season)
        assert season.story_pack_key is None

    def test_set_season_story_pack_key_missing_season_raises_404(self, db):
        store = SqlAlchemyStoryPackStore(db)
        with pytest.raises(StoryPackStoreError) as exc:
            store.set_season_story_pack_key(999999, TANG_PACK_KEY)
        assert exc.value.status_code == 404


class TestActiveKeyPointer:
    """Issue #4052: the platform-wide "active default" pointer used to live
    ONLY in a process-local module dict (`_active_key_state`) — fixed by
    migration f6g7actvpack1_*.py (`story_packs.is_active_default` + a
    partial unique index). These tests exercise the real column, not the
    old in-memory fallback (which no longer exists in this module at all)."""

    def test_defaults_to_none(self, db):
        store = SqlAlchemyStoryPackStore(db)
        assert store.get_active_key() is None

    def test_set_then_get(self, db):
        store = SqlAlchemyStoryPackStore(db)
        store.set_active_key(SONG_PACK_KEY)
        assert store.get_active_key() == SONG_PACK_KEY

    def test_set_active_key_none_clears_it(self, db):
        store = SqlAlchemyStoryPackStore(db)
        store.set_active_key(SONG_PACK_KEY)
        store.set_active_key(None)
        assert store.get_active_key() is None

    def test_setting_a_new_default_unsets_the_previous_one(self, db):
        """The partial unique index (`ix_story_packs_single_active_default`)
        allows at most one TRUE row — this proves set_active_key's
        clear-then-set actually clears, not just that the index would
        reject a second TRUE (that's test_only_one_row_can_be_active_* in
        TestSingleActiveDefaultInvariant below)."""
        store = SqlAlchemyStoryPackStore(db)
        store.set_active_key(SONG_PACK_KEY)
        store.set_active_key(TANG_PACK_KEY)

        assert store.get_active_key() == TANG_PACK_KEY
        song_row = db.query(StoryPackRow).filter(StoryPackRow.key == SONG_PACK_KEY).one()
        assert song_row.is_active_default is False

    def test_set_active_key_missing_key_raises_404(self, db):
        store = SqlAlchemyStoryPackStore(db)
        with pytest.raises(StoryPackStoreError) as exc:
            store.set_active_key("does-not-exist")
        assert exc.value.status_code == 404

    def test_concurrent_set_active_key_raises_friendly_error_not_500(self, db, monkeypatch):
        """Issue #4052 code review: two admins clicking "設為平台預設" at the
        same instant could both pass the clear-then-set sequence before
        either commits, so both try to leave a row TRUE — the partial
        unique index is the backstop, but an uncaught IntegrityError from
        it must not leak as a raw 500. Simulated deterministically (no
        real threads/concurrency needed) by making commit() itself raise
        IntegrityError — exactly what the losing concurrent transaction
        sees in production."""
        store = SqlAlchemyStoryPackStore(db)

        def _raise_integrity_error():
            raise IntegrityError(
                "UPDATE story_packs SET is_active_default=true ...",
                {},
                Exception("UNIQUE constraint failed: story_packs.is_active_default"),
            )

        monkeypatch.setattr(db, "commit", _raise_integrity_error)

        with pytest.raises(StoryPackStoreError) as exc:
            store.set_active_key(TANG_PACK_KEY)

        assert exc.value.status_code == 409
        assert "另一位管理員" in exc.value.message

    def test_service_layer_turns_store_integrity_error_into_service_error(self, db, monkeypatch):
        """Issue #4052 code review: story_pack_service.set_active_pack
        previously did NOT catch StoryPackStoreError from
        store.set_active_key — unlike every other service function that
        wraps its store call. A raw StoryPackStoreError reaching the route
        layer (admin_story_packs.py only catches StoryPackServiceError)
        would be an unhandled 500."""
        store = SqlAlchemyStoryPackStore(db)

        def _raise_integrity_error():
            raise IntegrityError("UPDATE story_packs ...", {}, Exception("UNIQUE constraint failed"))

        monkeypatch.setattr(db, "commit", _raise_integrity_error)

        with pytest.raises(svc.StoryPackServiceError) as exc:
            svc.set_active_pack(store, TANG_PACK_KEY)

        assert exc.value.status_code == 409
        assert "另一位管理員" in exc.value.message

    def test_delete_custom_clears_active_key_if_it_pointed_there(self, db):
        store = SqlAlchemyStoryPackStore(db)
        store.upsert_custom(StoryPack(key="ming-voyage", **VALID_PACK_PAYLOAD))
        store.set_active_key("ming-voyage")
        store.delete_custom("ming-voyage")
        assert store.get_active_key() is None

    def test_independent_sessions_see_the_same_default_after_one_sets_it(self, db):
        """This is the issue's acceptance test: "a backend test proving two
        independent sessions/app instances read the same default after one
        sets it". `db` (store1's session) and `db2` (store2's, opened and
        closed independently, never sharing a session or a transaction)
        stand in for two separate Cloud Run replicas — the real production
        topology this bug hit (staging up to 8 replicas, prod up to 12).

        This exact test, run against the OLD process-local
        `_active_key_state` dict implementation, was NOT red in a single
        pytest process — a bare "two store instances, same process" test
        passes even with the bug, because both instances share the same
        Python module memory (that's what the now-removed
        `test_shared_across_store_instances_same_process` documented). The
        bug only manifests across OS process boundaries, which a single
        pytest process cannot literally fork. To make this test meaningful
        against the historical bug, it was verified by hand (see the PR
        description's red/green evidence) against a modified old
        implementation that reset `_active_key_state` between the two
        sessions, simulating "a fresh replica with no shared memory" — that
        variant returned None (red). Against the real column (this test,
        as committed), persistence lives in Postgres/SQLite itself, so two
        truly independent sessions agree regardless of process boundaries."""
        store1 = SqlAlchemyStoryPackStore(db)
        store1.set_active_key(TANG_PACK_KEY)

        db2 = Session()
        try:
            store2 = SqlAlchemyStoryPackStore(db2)
            assert store2.get_active_key() == TANG_PACK_KEY
        finally:
            db2.close()


class TestSingleActiveDefaultInvariant:
    """The partial unique index (`ix_story_packs_single_active_default`,
    migration f6g7actvpack1_*.py) is a DB-level guarantee, not just
    application discipline in `set_active_key` — these tests go around
    the store entirely and hit the table directly to prove the index
    itself (not just well-behaved application code) enforces it."""

    def test_two_rows_cannot_both_be_marked_active_default(self, db):
        db.execute(
            sa_update(StoryPackRow)
            .where(StoryPackRow.key == TANG_PACK_KEY)
            .values(is_active_default=True)
        )
        db.commit()
        # SQLite raises at statement-execution time (not deferred to
        # commit) for an immediate UNIQUE index — wrap the execute() call
        # itself, not just the commit.
        with pytest.raises(IntegrityError):
            db.execute(
                sa_update(StoryPackRow)
                .where(StoryPackRow.key == SONG_PACK_KEY)
                .values(is_active_default=True)
            )
        db.rollback()

    def test_multiple_false_rows_are_fine(self, db):
        """Negative control for the test above — the partial index only
        covers TRUE rows (`WHERE is_active_default`), so this must NOT
        raise; if it did, the index would be mis-specified as a full
        (non-partial) unique index instead."""
        db.execute(sa_update(StoryPackRow).values(is_active_default=False))
        db.commit()  # every builtin row is now False — must not raise


class TestFallbackChain:
    """resolve_pack_for_season's 3-step chain (PRD §13.4):
    season.story_pack_key -> platform active default -> builtin default.
    """

    def test_season_override_wins(self, db):
        store = SqlAlchemyStoryPackStore(db)
        user = _make_user(db)
        store.set_active_key(SONG_PACK_KEY)
        season = _make_season(db, user, story_pack_key=TANG_PACK_KEY)

        pack = resolve_pack_for_season(store, season)
        assert pack.key == TANG_PACK_KEY

    def test_falls_back_to_active_default_when_no_season_override(self, db):
        store = SqlAlchemyStoryPackStore(db)
        user = _make_user(db)
        store.set_active_key(SONG_PACK_KEY)
        season = _make_season(db, user, story_pack_key=None)

        pack = resolve_pack_for_season(store, season)
        assert pack.key == SONG_PACK_KEY

    def test_falls_back_to_builtin_default_when_nothing_set(self, db):
        store = SqlAlchemyStoryPackStore(db)
        user = _make_user(db)
        season = _make_season(db, user, story_pack_key=None)

        pack = resolve_pack_for_season(store, season)
        assert pack.key == MYTH_PACK_KEY  # DEFAULT_PACK_KEY (Young 2026-10-16)

    def test_custom_pack_as_season_override(self, db):
        store = SqlAlchemyStoryPackStore(db)
        user = _make_user(db)
        store.upsert_custom(StoryPack(key="ming-voyage", **VALID_PACK_PAYLOAD))
        season = _make_season(db, user, story_pack_key="ming-voyage")

        pack = resolve_pack_for_season(store, season)
        assert pack.key == "ming-voyage"
        assert pack.title == "鄭和下西洋賽"


class TestInvalidPackRejected:
    """Schema validation happens at the service layer, BEFORE any row is
    written — the DB is never asked to store an invalid payload."""

    def test_missing_required_field_rejected(self, db):
        store = SqlAlchemyStoryPackStore(db)
        bad_payload = dict(VALID_PACK_PAYLOAD)
        bad_payload.pop("result_copy")
        with pytest.raises(svc.StoryPackServiceError) as exc:
            svc.upsert_custom_pack(store, {**bad_payload, "key": "bad-pack"})
        assert exc.value.status_code == 422
        assert store.get_custom("bad-pack") is None

    def test_unknown_field_rejected(self, db):
        store = SqlAlchemyStoryPackStore(db)
        bad_payload = dict(VALID_PACK_PAYLOAD, badge_threshold=9999)
        with pytest.raises(svc.StoryPackServiceError) as exc:
            svc.upsert_custom_pack(store, {**bad_payload, "key": "bad-pack-2"})
        assert exc.value.status_code == 422
        assert store.get_custom("bad-pack-2") is None

    def test_wrong_badge_keys_rejected(self, db):
        store = SqlAlchemyStoryPackStore(db)
        bad_payload = dict(VALID_PACK_PAYLOAD)
        bad_payload["badges"] = [
            {"key": "individual_badge", "name": "A", "description": "a", "art": {"kind": "emoji", "value": "⭐"}},
            {"key": "individual_badge", "name": "B", "description": "b", "art": {"kind": "emoji", "value": "⭐"}},
        ]
        with pytest.raises(svc.StoryPackServiceError) as exc:
            svc.upsert_custom_pack(store, {**bad_payload, "key": "bad-pack-3"})
        assert exc.value.status_code == 422
        assert store.get_custom("bad-pack-3") is None

    def test_banned_political_term_rejected(self, db):
        """Young 2026-10-16 neutrality gate exercised through the full
        store+service path, not just the schema unit test."""
        store = SqlAlchemyStoryPackStore(db)
        bad_payload = dict(VALID_PACK_PAYLOAD, title="中國風雲賽")
        with pytest.raises(svc.StoryPackServiceError) as exc:
            svc.upsert_custom_pack(store, {**bad_payload, "key": "bad-pack-4"})
        assert exc.value.status_code == 422
        assert store.get_custom("bad-pack-4") is None


class TestActiveKeyNPlusOneFix:
    """Issue #4052 code review: get_active_key() became a real DB query
    (was a free process-dict lookup). routes/league.py's GET /my-history
    loops over a student's seasons calling get_pack_for_season() once per
    season — without passing the pre-fetched active_key in, that would
    re-query get_active_key() once per season (N+1, scaling with however
    many seasons a long-time student has accumulated). These tests count
    actual calls to the store's get_active_key(), not just inspect code,
    so a future regression (someone drops the `active_key=` kwarg from
    the route's call site) would be caught here too — this is a unit-level
    proof of the mechanism the route relies on, not a route-level
    integration test (which would additionally require wiring a full
    season/team/roster fixture graph unrelated to what's being proven)."""

    def _counting_store(self, db) -> tuple[SqlAlchemyStoryPackStore, dict]:
        store = SqlAlchemyStoryPackStore(db)
        call_count = {"n": 0}
        real_get_active_key = store.get_active_key

        def _counting_get_active_key():
            call_count["n"] += 1
            return real_get_active_key()

        store.get_active_key = _counting_get_active_key  # type: ignore[method-assign]
        return store, call_count

    def test_resolving_n_seasons_with_prefetched_active_key_queries_it_once_total(self, db):
        store, call_count = self._counting_store(db)
        store.set_active_key(SONG_PACK_KEY)
        user = _make_user(db)
        seasons = [_make_season(db, user, story_pack_key=None) for _ in range(5)]

        # Mirrors routes/league.py's GET /my-history: fetch the platform
        # default ONCE before the loop...
        active_key = store.get_active_key()
        assert call_count["n"] == 1

        # ...then resolve every season's pack by passing that same value in
        # — none of these 5 calls should touch get_active_key() again.
        for season in seasons:
            pack = svc.get_pack_for_season(store, season, active_key=active_key)
            assert pack.key == SONG_PACK_KEY

        assert call_count["n"] == 1, "get_active_key() must not be re-queried inside the loop"

    def test_negative_control_omitting_active_key_queries_once_per_season(self, db):
        """Proves the counting mechanism above has real teeth — this is
        the OLD calling convention (the actual bug, if the route forgot to
        pass active_key), and it SHOULD cost one query per season. If this
        assertion ever started failing, the test above would no longer be
        trustworthy evidence of a fix."""
        store, call_count = self._counting_store(db)
        store.set_active_key(SONG_PACK_KEY)
        user = _make_user(db)
        seasons = [_make_season(db, user, story_pack_key=None) for _ in range(5)]

        for season in seasons:
            svc.get_pack_for_season(store, season)  # active_key omitted on purpose

        assert call_count["n"] == 5
