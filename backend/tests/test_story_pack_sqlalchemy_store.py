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


@pytest.fixture(autouse=True)
def _reset_active_key():
    """`get_active_key`/`set_active_key` are process-local module state (see
    story_pack_store.py docstring) — reset between tests so they don't
    bleed, same concern InMemoryStoryPackStore's tests already had to
    handle via constructing a fresh instance per test."""
    import app.services.story_pack_store as store_mod

    store_mod._active_key_state["key"] = None
    yield
    store_mod._active_key_state["key"] = None


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
    def test_defaults_to_none(self, db):
        store = SqlAlchemyStoryPackStore(db)
        assert store.get_active_key() is None

    def test_set_then_get(self, db):
        store = SqlAlchemyStoryPackStore(db)
        store.set_active_key(SONG_PACK_KEY)
        assert store.get_active_key() == SONG_PACK_KEY

    def test_shared_across_store_instances_same_process(self, db):
        """Documents the deliberate scope: unlike pack content and season
        assignment, the active-key pointer is process-local, not per
        Session/request — see SqlAlchemyStoryPackStore's class docstring."""
        SqlAlchemyStoryPackStore(db).set_active_key(TANG_PACK_KEY)
        assert SqlAlchemyStoryPackStore(db).get_active_key() == TANG_PACK_KEY

    def test_delete_custom_clears_active_key_if_it_pointed_there(self, db):
        store = SqlAlchemyStoryPackStore(db)
        store.upsert_custom(StoryPack(key="ming-voyage", **VALID_PACK_PAYLOAD))
        store.set_active_key("ming-voyage")
        store.delete_custom("ming-voyage")
        assert store.get_active_key() is None


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
