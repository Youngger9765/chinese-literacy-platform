"""Persistence boundary for custom (non-builtin) `LeagueTheme`s.

⚠️ TEMPORARY — see docs/prd/2026-10-14-chinese-star-league-prd.md §13.4.
No `league_themes` table or `league_seasons.theme_key` column exists yet
(that migration is NOT approved — see the PR description for the exact
schema being requested). Until it lands, `InMemoryThemeStore` is the only
implementation: custom themes, the platform-wide active-theme pointer, and
any per-season theme assignment all live in this PROCESS's memory only —
they do NOT survive a restart and are NOT shared across Cloud Run replicas.

This is a deliberate, named limitation, not a hack masquerading as real
persistence: every write path in here is behind the `ThemeStore` interface
below, so swapping in a `SqlAlchemyThemeStore` later (once the table
exists) is a one-line change in `get_theme_store()` — nothing above this
module needs to change. `resolve_theme_for_season` already reads
`getattr(season, "theme_key", None)` so it picks up the real column for
free the moment it's added, with zero code change to the resolution order.
"""
from __future__ import annotations

import threading
from typing import Protocol

from ..schemas.league_theme import LeagueTheme
from .league_theme_defaults import BUILTIN_THEMES, DEFAULT_THEME_KEY


class ThemeStoreError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class ThemeStore(Protocol):
    """Storage boundary — swap the implementation once `league_themes` /
    `league_seasons.theme_key` exist. Every method here is the full surface
    the service layer needs; none of it assumes in-memory storage."""

    def list_custom(self) -> dict[str, LeagueTheme]: ...

    def get_custom(self, key: str) -> LeagueTheme | None: ...

    def upsert_custom(self, theme: LeagueTheme) -> LeagueTheme: ...

    def delete_custom(self, key: str) -> bool: ...

    def get_active_key(self) -> str | None: ...

    def set_active_key(self, key: str | None) -> None: ...

    def get_season_theme_key(self, season_id: int) -> str | None: ...

    def set_season_theme_key(self, season_id: int, key: str | None) -> None: ...


class InMemoryThemeStore:
    """Process-local, thread-safe. See module docstring for why this is
    explicitly temporary."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._custom: dict[str, LeagueTheme] = {}
        self._active_key: str | None = None
        self._season_theme_keys: dict[int, str] = {}

    def list_custom(self) -> dict[str, LeagueTheme]:
        with self._lock:
            return dict(self._custom)

    def get_custom(self, key: str) -> LeagueTheme | None:
        with self._lock:
            return self._custom.get(key)

    def upsert_custom(self, theme: LeagueTheme) -> LeagueTheme:
        if theme.key in BUILTIN_THEMES:
            raise ThemeStoreError(
                f"「{theme.key}」是內建主題，請用新的 key 另存一份（不可覆蓋內建主題）",
                status_code=409,
            )
        with self._lock:
            self._custom[theme.key] = theme
            return theme

    def delete_custom(self, key: str) -> bool:
        if key in BUILTIN_THEMES:
            raise ThemeStoreError("內建主題不可刪除", status_code=409)
        with self._lock:
            existed = key in self._custom
            self._custom.pop(key, None)
            if self._active_key == key:
                self._active_key = None
            for season_id, season_key in list(self._season_theme_keys.items()):
                if season_key == key:
                    del self._season_theme_keys[season_id]
            return existed

    def get_active_key(self) -> str | None:
        with self._lock:
            return self._active_key

    def set_active_key(self, key: str | None) -> None:
        with self._lock:
            self._active_key = key

    def get_season_theme_key(self, season_id: int) -> str | None:
        with self._lock:
            return self._season_theme_keys.get(season_id)

    def set_season_theme_key(self, season_id: int, key: str | None) -> None:
        with self._lock:
            if key is None:
                self._season_theme_keys.pop(season_id, None)
            else:
                self._season_theme_keys[season_id] = key


_default_store = InMemoryThemeStore()


def get_theme_store() -> ThemeStore:
    """Single process-wide store instance. Tests that need isolation
    should construct their own `InMemoryThemeStore()` and pass it in
    explicitly rather than mutating this module-level singleton."""
    return _default_store


def resolve_theme(store: ThemeStore, key: str | None) -> LeagueTheme | None:
    """key → LeagueTheme, checking builtin themes first (cheap, no lock)
    then the store's custom themes. Returns None if the key resolves to
    neither — callers decide the fallback (see resolve_theme_for_season)."""
    if key is None:
        return None
    if key in BUILTIN_THEMES:
        return BUILTIN_THEMES[key]
    return store.get_custom(key)


def resolve_theme_for_season(store: ThemeStore, season: object) -> LeagueTheme:
    """The full fallback chain (PRD §13.4):

        1. season.theme_key (future DB column — None today, always)
        2. the platform-wide "active default" an admin set via the store
        3. the shipped built-in default (唐)

    `season` is typed as `object` (not `LeagueSeason`) deliberately — this
    function must work today, before the column exists, via nothing but
    `getattr` with a default, and must keep working unchanged the moment
    the column is added.
    """
    season_theme_key = getattr(season, "theme_key", None)
    if season_theme_key is None:
        season_id = getattr(season, "id", None)
        if season_id is not None:
            season_theme_key = store.get_season_theme_key(season_id)
    theme = resolve_theme(store, season_theme_key)
    if theme is not None:
        return theme

    active_key = store.get_active_key()
    theme = resolve_theme(store, active_key)
    if theme is not None:
        return theme

    return BUILTIN_THEMES[DEFAULT_THEME_KEY]
