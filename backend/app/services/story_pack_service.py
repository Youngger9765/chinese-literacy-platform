"""Story pack service — the business logic routes/admin_story_packs.py and
routes/league.py call. Wraps schema validation + the StoryPackStore
boundary (see story_pack_store.py's docstring for the persistence model).
"""
from __future__ import annotations

from pydantic import ValidationError

from ..schemas.story_pack import StoryPack, StoryPackSummary
from .story_pack_defaults import BUILTIN_PACKS
from .story_pack_errors import translate_validation_error
from .story_pack_store import StoryPackStore, StoryPackStoreError, resolve_pack, resolve_pack_for_season


class StoryPackServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400, errors: list[dict] | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        # Field-level validation errors, see validate_pack_payload.
        self.errors = errors or []


def validate_pack_payload(raw: dict) -> tuple[StoryPack | None, list[dict]]:
    """Live-validation entry point, no write. Returns pack and an empty list
    on success, or None and errors where each error is a dict with
    loc = machine path like chest.name, field = Chinese label shown to the
    admin like 寶箱名稱, msg = Chinese description of what is wrong.
    Issue 3615: these used to be raw Pydantic English like Value error."""
    try:
        pack = StoryPack(**raw)
        return pack, []
    except ValidationError as exc:
        return None, [translate_validation_error(e) for e in exc.errors()]


def list_packs(store: StoryPackStore) -> list[StoryPackSummary]:
    out = [
        StoryPackSummary(key=p.key, era=p.era, title=p.title, is_builtin=True)
        for p in BUILTIN_PACKS.values()
    ]
    out += [
        StoryPackSummary(key=p.key, era=p.era, title=p.title, is_builtin=False)
        for p in store.list_custom().values()
    ]
    return sorted(out, key=lambda s: (not s.is_builtin, s.key))


def get_pack_or_404(store: StoryPackStore, key: str) -> StoryPack:
    pack = resolve_pack(store, key)
    if pack is None:
        raise StoryPackServiceError(f"劇情包「{key}」不存在", status_code=404)
    return pack


def upsert_custom_pack(store: StoryPackStore, raw: dict) -> StoryPack:
    pack, errors = validate_pack_payload(raw)
    if pack is None:
        raise StoryPackServiceError("劇情包內容驗證失敗", status_code=422, errors=errors)
    try:
        return store.upsert_custom(pack)
    except StoryPackStoreError as exc:
        raise StoryPackServiceError(exc.message, status_code=exc.status_code) from exc


def delete_custom_pack(store: StoryPackStore, key: str) -> None:
    try:
        existed = store.delete_custom(key)
    except StoryPackStoreError as exc:
        raise StoryPackServiceError(exc.message, status_code=exc.status_code) from exc
    if not existed:
        raise StoryPackServiceError(f"劇情包「{key}」不存在（或已是內建劇情包，無法刪除）", status_code=404)


def get_active_pack(store: StoryPackStore) -> StoryPack:
    active_key = store.get_active_key()
    pack = resolve_pack(store, active_key)
    if pack is not None:
        return pack
    from .story_pack_defaults import DEFAULT_PACK

    return DEFAULT_PACK


def set_active_pack(store: StoryPackStore, key: str) -> StoryPack:
    pack = resolve_pack(store, key)
    if pack is None:
        raise StoryPackServiceError(f"劇情包「{key}」不存在", status_code=404)
    store.set_active_key(key)
    return pack


def assign_season_pack(store: StoryPackStore, season_id: int, key: str | None) -> StoryPack | None:
    """key=None clears the per-season override (falls back to the active
    default / builtin default again)."""
    if key is not None:
        pack = resolve_pack(store, key)
        if pack is None:
            raise StoryPackServiceError(f"劇情包「{key}」不存在", status_code=404)
    try:
        store.set_season_story_pack_key(season_id, key)
    except StoryPackStoreError as exc:
        # SqlAlchemyStoryPackStore raises this for a season_id that doesn't
        # exist (InMemoryStoryPackStore never did — it has no concept of a
        # real season row — so this branch only fires against the DB store).
        raise StoryPackServiceError(exc.message, status_code=exc.status_code) from exc
    return resolve_pack(store, key) if key is not None else None


def get_pack_for_season(store: StoryPackStore, season: object) -> StoryPack:
    return resolve_pack_for_season(store, season)
