"""Persistence boundary for custom (non-builtin) `StoryPack`s.

DB-backed as of 2026-10-16 (Young approved the migration — issue #3594
comment, "同意建主題表"; generalized the same day from league-only
`league_themes`/`ThemeStore` to the mode-agnostic `story_packs`/
`StoryPackStore` named here — see app/models/story_pack.py and
alembic/versions/7e0ca622e3d8_*.py). `SqlAlchemyStoryPackStore` is the
production implementation: custom pack content, per-season assignment
(`league_seasons.story_pack_key`), AND the platform-wide active-default
pointer (`story_packs.is_active_default`) are all durable and shared
across Cloud Run replicas via Postgres.

`InMemoryStoryPackStore` is kept for tests (`test_story_pack_service.py`
builds one per test for total isolation) — it is NOT used in production
for any state anymore (see history below for what used to be true).

HISTORY (issue #4052, resolved 2026-11-14): until this fix, the
platform-wide "active default" pointer lived ONLY in a process-local
module dict (`_active_key_state`), because Young's 2026-10-16 approval
covered exactly two schema changes (the `story_packs` table and
`league_seasons.story_pack_key`) and no column existed yet for "which pack
is the platform default". Cloud Run runs multiple replicas (staging up to
8, prod up to 12) — each had its OWN copy of that dict, so which pack a
student saw depended on which replica answered their request (staging
repro: 18/30 vs 12/30 queries disagreed). Young separately approved the
`story_packs.is_active_default` column + partial unique index 2026-11-14
(migration f6g7actvpack1_*.py) after a STOP report found no existing
settings/config table to reuse — see that migration's docstring for the
full schema and backfill decision (none: there was never a persisted
value to migrate, only ephemeral process memory).

MVP scope (2026-10-16): the season-assignment methods below
(`get_season_story_pack_key`/`set_season_story_pack_key`) directly query
`LeagueSeason` — a league-specific model — inside what is otherwise a
generic store. Young's own correction explicitly cut "the adapter
interface for PK/迷城" from this PR ("先 MVP，不要把重心放在劇情包擴展"), so
this impurity is accepted for now rather than building an abstraction no
second consumer exists to validate yet. When a second game mode binds to
`story_packs`, it will need its own season/match-scoped FK column and its
own small accessor — not share these two methods.

`resolve_pack_for_season` is otherwise mode-agnostic — it reads
`getattr(season, "story_pack_key", None)` first and only falls through to
`store.get_season_story_pack_key(season.id)` for callers that don't pass an
ORM object with the real column populated.
"""
from __future__ import annotations

import threading
from typing import Protocol

from sqlalchemy import text as sa_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.league import LeagueSeason
from ..models.story_pack import StoryPackRow
from ..schemas.story_pack import StoryPack
from .story_pack_defaults import BUILTIN_PACKS, DEFAULT_PACK_KEY


class StoryPackStoreError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class StoryPackStore(Protocol):
    """Storage boundary — every method here is the full surface the
    service layer needs; none of it assumes in-memory storage."""

    def list_custom(self) -> dict[str, StoryPack]: ...

    def get_custom(self, key: str) -> StoryPack | None: ...

    def upsert_custom(self, pack: StoryPack) -> StoryPack: ...

    def delete_custom(self, key: str) -> bool: ...

    def get_active_key(self) -> str | None: ...

    def set_active_key(self, key: str | None) -> None: ...

    def get_season_story_pack_key(self, season_id: int) -> str | None: ...

    def set_season_story_pack_key(self, season_id: int, key: str | None) -> None: ...


class InMemoryStoryPackStore:
    """Process-local, thread-safe. Kept ONLY for test isolation (issue
    #4052: it is NOT used for any production state anymore — see module
    docstring's HISTORY section for what used to be true before the
    `story_packs.is_active_default` column existed)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._custom: dict[str, StoryPack] = {}
        self._active_key: str | None = None
        self._season_story_pack_keys: dict[int, str] = {}

    def list_custom(self) -> dict[str, StoryPack]:
        with self._lock:
            return dict(self._custom)

    def get_custom(self, key: str) -> StoryPack | None:
        with self._lock:
            return self._custom.get(key)

    def upsert_custom(self, pack: StoryPack) -> StoryPack:
        if pack.key in BUILTIN_PACKS:
            raise StoryPackStoreError(
                f"「{pack.key}」是內建劇情包，請用新的 key 另存一份（不可覆蓋內建劇情包）",
                status_code=409,
            )
        with self._lock:
            self._custom[pack.key] = pack
            return pack

    def delete_custom(self, key: str) -> bool:
        if key in BUILTIN_PACKS:
            raise StoryPackStoreError("內建劇情包不可刪除", status_code=409)
        with self._lock:
            existed = key in self._custom
            self._custom.pop(key, None)
            if self._active_key == key:
                self._active_key = None
            for season_id, season_key in list(self._season_story_pack_keys.items()):
                if season_key == key:
                    del self._season_story_pack_keys[season_id]
            return existed

    def get_active_key(self) -> str | None:
        with self._lock:
            return self._active_key

    def set_active_key(self, key: str | None) -> None:
        with self._lock:
            self._active_key = key

    def get_season_story_pack_key(self, season_id: int) -> str | None:
        with self._lock:
            return self._season_story_pack_keys.get(season_id)

    def set_season_story_pack_key(self, season_id: int, key: str | None) -> None:
        with self._lock:
            if key is None:
                self._season_story_pack_keys.pop(season_id, None)
            else:
                self._season_story_pack_keys[season_id] = key


class SqlAlchemyStoryPackStore:
    """Production `StoryPackStore` — custom pack content, per-season
    assignment, AND the platform-wide active-default pointer are all real
    rows/columns (`story_packs.content`, `league_seasons.story_pack_key`,
    `story_packs.is_active_default`), durable and shared across Cloud Run
    replicas. See module docstring for why the season methods are a
    league-specific impurity accepted for MVP scope.

    `is_active_default` (issue #4052, migration f6g7actvpack1) used to be a
    process-local module dict — this is the fix: Young approved
    2026-11-14 after the PR #4056 STOP report found no existing settings
    table to reuse. A Postgres partial unique index
    (`ix_story_packs_single_active_default`) enforces at most one TRUE row
    at the DB level; `set_active_key` additionally clears-then-sets inside
    one transaction so a crash mid-write can't leave two TRUE rows or
    (worse) zero when the caller expected exactly one.

    Builtin packs (`is_builtin=True`) ALSO have rows in `story_packs` —
    seeded by the migration — but purely so `league_seasons.
    story_pack_key`'s FK can reference a builtin key. Every method here
    filters `is_builtin.is_(False)` so builtin rows are never returned as
    "custom" content, matching exactly what `InMemoryStoryPackStore`
    returned before (builtins were never in its `_custom` dict either) —
    `resolve_pack()` still serves builtin content from the in-code
    `BUILTIN_PACKS` dict, never from this table.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def _row(self, key: str, *, include_builtin: bool = False) -> StoryPackRow | None:
        q = self.db.query(StoryPackRow).filter(StoryPackRow.key == key)
        if not include_builtin:
            q = q.filter(StoryPackRow.is_builtin.is_(False))
        return q.first()

    def list_custom(self) -> dict[str, StoryPack]:
        rows = (
            self.db.query(StoryPackRow)
            .filter(StoryPackRow.is_builtin.is_(False))
            .all()
        )
        return {row.key: StoryPack(**row.content) for row in rows}

    def get_custom(self, key: str) -> StoryPack | None:
        row = self._row(key)
        return StoryPack(**row.content) if row is not None else None

    def upsert_custom(self, pack: StoryPack) -> StoryPack:
        if pack.key in BUILTIN_PACKS:
            raise StoryPackStoreError(
                f"「{pack.key}」是內建劇情包，請用新的 key 另存一份（不可覆蓋內建劇情包）",
                status_code=409,
            )
        # include_builtin=True here on purpose: if a row with this key
        # exists but is_builtin=True, that's the same 409 as above (a
        # builtin row existing under this key means BUILTIN_PACKS should
        # have caught it — this is the defense-in-depth path), not a normal
        # update.
        row = self._row(pack.key, include_builtin=True)
        if row is not None and row.is_builtin:
            raise StoryPackStoreError(
                f"「{pack.key}」是內建劇情包，請用新的 key 另存一份（不可覆蓋內建劇情包）",
                status_code=409,
            )
        if row is None:
            row = StoryPackRow(key=pack.key, content=pack.model_dump(mode="json"), is_builtin=False)
            self.db.add(row)
        else:
            row.content = pack.model_dump(mode="json")
        self.db.commit()
        return pack

    def delete_custom(self, key: str) -> bool:
        if key in BUILTIN_PACKS:
            raise StoryPackStoreError("內建劇情包不可刪除", status_code=409)
        row = self._row(key)
        if row is None:
            return False
        # Clear any season override that points at this key first — the FK
        # (league_seasons.story_pack_key -> story_packs.key) would otherwise
        # block the delete, and a silently-dangling override is worse than
        # falling back to the active default / builtin (same fallback chain
        # resolve_pack_for_season always applies for a missing key).
        self.db.query(LeagueSeason).filter(LeagueSeason.story_pack_key == key).update(
            {LeagueSeason.story_pack_key: None}
        )
        # No separate "was this the active default" check needed — if this
        # row had is_active_default=True, deleting the row deletes that
        # flag along with it (it lives on the row itself now, not in a
        # side table/dict). get_active_key() naturally falls back to None.
        self.db.delete(row)
        self.db.commit()
        return True

    def get_active_key(self) -> str | None:
        row = (
            self.db.query(StoryPackRow)
            .filter(StoryPackRow.is_active_default.is_(True))
            .first()
        )
        return row.key if row is not None else None

    def set_active_key(self, key: str | None) -> None:
        # Clear-then-set in ONE transaction (single commit at the end, not
        # one per step) — see class docstring. Builtin keys are included
        # (`include_builtin=True`) because setting a builtin pack as the
        # platform default is a normal, supported action (BUILTIN_PACKS
        # rows exist in this same table precisely so they can be
        # referenced — see 7e0ca622e3d8_create_story_packs_table.py).
        #
        # Concurrency (issue #4052 code review): two admins clicking "設為
        # 平台預設" at the same instant could both pass the clear step
        # before either commits, so both then try to leave a row TRUE —
        # the partial unique index (migration f6g7actvpack1) is the
        # backstop, but an uncaught IntegrityError from that backstop would
        # otherwise leak as a raw 500. Two layers of defense:
        #   1. A Postgres advisory transaction lock serializes concurrent
        #      set_active_key calls DB-wide (auto-released at commit/
        #      rollback) — this is the actual fix for the common case.
        #      SQLite (tests) has no equivalent and doesn't need one: a
        #      single pytest process can't race itself this way.
        #   2. Even if two transactions still somehow interleave, catching
        #      IntegrityError here turns the inevitable-by-construction
        #      loser into a friendly, actionable Chinese error instead of
        #      an unhandled 500.
        if self.db.bind is not None and self.db.bind.dialect.name == "postgresql":
            self.db.execute(sa_text("SELECT pg_advisory_xact_lock(hashtext('story_packs_active_default'))"))

        self.db.query(StoryPackRow).filter(StoryPackRow.is_active_default.is_(True)).update(
            {StoryPackRow.is_active_default: False}
        )
        if key is not None:
            row = self._row(key, include_builtin=True)
            if row is None:
                raise StoryPackStoreError(f"劇情包「{key}」不存在", status_code=404)
            row.is_active_default = True
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            raise StoryPackStoreError(
                "另一位管理員剛剛也在設定預設包，請重新整理後再試一次", status_code=409
            )

    def get_season_story_pack_key(self, season_id: int) -> str | None:
        season = self.db.query(LeagueSeason).filter(LeagueSeason.id == season_id).first()
        return season.story_pack_key if season is not None else None

    def set_season_story_pack_key(self, season_id: int, key: str | None) -> None:
        season = self.db.query(LeagueSeason).filter(LeagueSeason.id == season_id).first()
        if season is None:
            raise StoryPackStoreError(f"season {season_id} 不存在", status_code=404)
        season.story_pack_key = key
        self.db.commit()


def get_story_pack_store(db: Session) -> StoryPackStore:
    """Returns the production store for this request's DB session."""
    return SqlAlchemyStoryPackStore(db)


def resolve_pack(store: StoryPackStore, key: str | None) -> StoryPack | None:
    """key → StoryPack, checking builtin packs first (cheap, no lock) then
    the store's custom packs. Returns None if the key resolves to neither —
    callers decide the fallback (see resolve_pack_for_season)."""
    if key is None:
        return None
    if key in BUILTIN_PACKS:
        return BUILTIN_PACKS[key]
    return store.get_custom(key)


# Sentinel for resolve_pack_for_season's/get_pack_for_season's `active_key`
# param — `None` is a legitimate VALUE (no platform default set), so it
# can't double as "not supplied". Issue #4052 code review: now that
# get_active_key() is a real DB query (was a free dict lookup), a caller
# resolving N seasons in a loop (routes/league.py GET /my-history) must
# query it ONCE and pass the result in, not re-query per season.
# Single-call callers omit this entirely and keep the old behavior (query
# the store). Exported (no leading underscore) so story_pack_service.py
# and callers can use it to opt into the "already have it" path.
UNSET_ACTIVE_KEY = object()


def resolve_pack_for_season(
    store: StoryPackStore,
    season: object,
    *,
    active_key: str | None = UNSET_ACTIVE_KEY,  # type: ignore[assignment]
) -> StoryPack:
    """The full fallback chain (PRD §13.4):

        1. season.story_pack_key (the real DB column)
        2. the platform-wide "active default" an admin set via the store
        3. the shipped built-in default (上古神話)

    `season` is typed as `object` (not `LeagueSeason`) deliberately — this
    works via nothing but `getattr` with a default, for callers that don't
    have a real ORM object handy.

    `active_key`: pass the platform default explicitly to skip the
    get_active_key() query entirely (see _ACTIVE_KEY_UNSET above) — for a
    caller resolving many seasons at once. Omit it for an ordinary
    single-season call; this method then queries the store itself,
    exactly as before.
    """
    season_key = getattr(season, "story_pack_key", None)
    if season_key is None:
        season_id = getattr(season, "id", None)
        if season_id is not None:
            season_key = store.get_season_story_pack_key(season_id)
    pack = resolve_pack(store, season_key)
    if pack is not None:
        return pack

    resolved_active_key = store.get_active_key() if active_key is UNSET_ACTIVE_KEY else active_key
    pack = resolve_pack(store, resolved_active_key)
    if pack is not None:
        return pack

    return BUILTIN_PACKS[DEFAULT_PACK_KEY]
