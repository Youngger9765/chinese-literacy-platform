"""League theme service — the business logic routes/admin_league_themes.py
and routes/league.py call. Wraps schema validation + the ThemeStore boundary
(see league_theme_store.py's docstring for the persistence caveat).
"""
from __future__ import annotations

from pydantic import ValidationError

from ..schemas.league_theme import LeagueTheme, LeagueThemeSummary
from .league_theme_defaults import BUILTIN_THEMES
from .league_theme_store import ThemeStore, ThemeStoreError, resolve_theme, resolve_theme_for_season


class ThemeServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def validate_theme_payload(raw: dict) -> tuple[LeagueTheme | None, list[dict]]:
    """Live-validation entry point (no write). Returns (theme, []) on
    success, or (None, errors) where each error is
    {"loc": "a.b.c", "msg": "..."} — shaped for a form/JSON-editor UI to
    highlight the offending field, not Pydantic's raw exception repr."""
    try:
        theme = LeagueTheme(**raw)
        return theme, []
    except ValidationError as exc:
        errors = [
            {"loc": ".".join(str(p) for p in e["loc"]), "msg": e["msg"]}
            for e in exc.errors()
        ]
        return None, errors


def list_themes(store: ThemeStore) -> list[LeagueThemeSummary]:
    out = [
        LeagueThemeSummary(key=t.key, era=t.era, title=t.title, is_builtin=True)
        for t in BUILTIN_THEMES.values()
    ]
    out += [
        LeagueThemeSummary(key=t.key, era=t.era, title=t.title, is_builtin=False)
        for t in store.list_custom().values()
    ]
    return sorted(out, key=lambda s: (not s.is_builtin, s.key))


def get_theme_or_404(store: ThemeStore, key: str) -> LeagueTheme:
    theme = resolve_theme(store, key)
    if theme is None:
        raise ThemeServiceError(f"主題「{key}」不存在", status_code=404)
    return theme


def upsert_custom_theme(store: ThemeStore, raw: dict) -> LeagueTheme:
    theme, errors = validate_theme_payload(raw)
    if theme is None:
        raise ThemeServiceError("主題內容驗證失敗", status_code=422)
    try:
        return store.upsert_custom(theme)
    except ThemeStoreError as exc:
        raise ThemeServiceError(exc.message, status_code=exc.status_code) from exc


def delete_custom_theme(store: ThemeStore, key: str) -> None:
    try:
        existed = store.delete_custom(key)
    except ThemeStoreError as exc:
        raise ThemeServiceError(exc.message, status_code=exc.status_code) from exc
    if not existed:
        raise ThemeServiceError(f"主題「{key}」不存在（或已是內建主題，無法刪除）", status_code=404)


def get_active_theme(store: ThemeStore) -> LeagueTheme:
    active_key = store.get_active_key()
    theme = resolve_theme(store, active_key)
    if theme is not None:
        return theme
    from .league_theme_defaults import DEFAULT_THEME

    return DEFAULT_THEME


def set_active_theme(store: ThemeStore, key: str) -> LeagueTheme:
    theme = resolve_theme(store, key)
    if theme is None:
        raise ThemeServiceError(f"主題「{key}」不存在", status_code=404)
    store.set_active_key(key)
    return theme


def assign_season_theme(store: ThemeStore, season_id: int, key: str | None) -> LeagueTheme | None:
    """key=None clears the per-season override (falls back to the active
    default / builtin default again)."""
    if key is not None:
        theme = resolve_theme(store, key)
        if theme is None:
            raise ThemeServiceError(f"主題「{key}」不存在", status_code=404)
    store.set_season_theme_key(season_id, key)
    return resolve_theme(store, key) if key is not None else None


def get_theme_for_season(store: ThemeStore, season: object) -> LeagueTheme:
    return resolve_theme_for_season(store, season)
