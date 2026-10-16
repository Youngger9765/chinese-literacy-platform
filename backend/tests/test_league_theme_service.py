"""Tests for league_theme_store.py / league_theme_service.py — the store
boundary + fallback chain (season.theme_key → active default → builtin
default) and the validate/upsert/delete/active/season-assign service
functions. Each test builds its OWN `InMemoryThemeStore()` (never the
module-level singleton) so tests can't bleed state into each other.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.league_theme_defaults import (
    DEFAULT_THEME_KEY,
    SONG_THEME_KEY,
    TANG_THEME_KEY,
)
from app.services.league_theme_store import InMemoryThemeStore, resolve_theme_for_season
from app.services import league_theme_service as svc


def _valid_payload(key="custom-ming", **overrides) -> dict:
    payload = {
        "key": key,
        "era": "明",
        "title": "鄭和下西洋賽",
        "intro": ["船隊出航，兩班讀家一起補給遠航的糧草。"],
        "faction_labels": ["船隊東路", "船隊西路"],
        "energy_bar_label": "補給",
        "milestones": [{"ratio": 1.0, "message": "補給齊全，啟航"}],
        "chest": {
            "name": "寶船寶箱",
            "description": "全班過半參與即可開啟",
            "art": {"kind": "emoji", "value": "🚢"},
        },
        "badges": [
            {"key": "individual_badge", "name": "領航勳章", "description": "個人達標", "art": {"kind": "emoji", "value": "⭐"}},
            {"key": "class_badge", "name": "船隊勳章", "description": "班級達標", "art": {"kind": "emoji", "value": "🏅"}},
        ],
        "result_copy": {"win": "勝利", "lose": "再接再厲", "draw": "平手"},
    }
    payload.update(overrides)
    return payload


class TestResolveThemeForSeasonFallbackChain:
    def test_no_season_theme_key_no_active_key_falls_back_to_builtin_default(self):
        store = InMemoryThemeStore()
        season = SimpleNamespace(id=1)  # no theme_key attr at all (today's reality)
        theme = resolve_theme_for_season(store, season)
        assert theme.key == DEFAULT_THEME_KEY

    def test_season_theme_key_column_wins_when_present(self):
        store = InMemoryThemeStore()
        store.set_active_key(SONG_THEME_KEY)  # active default says Song
        season = SimpleNamespace(id=1, theme_key=TANG_THEME_KEY)  # but season says Tang
        theme = resolve_theme_for_season(store, season)
        assert theme.key == TANG_THEME_KEY  # season-level wins

    def test_per_season_override_in_store_used_when_no_db_column_value(self):
        store = InMemoryThemeStore()
        store.set_season_theme_key(42, SONG_THEME_KEY)
        season = SimpleNamespace(id=42)  # theme_key column doesn't exist yet
        theme = resolve_theme_for_season(store, season)
        assert theme.key == SONG_THEME_KEY

    def test_active_default_used_when_no_season_override_exists(self):
        store = InMemoryThemeStore()
        store.set_active_key(SONG_THEME_KEY)
        season = SimpleNamespace(id=99)
        theme = resolve_theme_for_season(store, season)
        assert theme.key == SONG_THEME_KEY

    def test_custom_theme_resolves_through_the_same_chain(self):
        store = InMemoryThemeStore()
        store.upsert_custom(svc.validate_theme_payload(_valid_payload())[0])
        store.set_season_theme_key(7, "custom-ming")
        season = SimpleNamespace(id=7)
        theme = resolve_theme_for_season(store, season)
        assert theme.key == "custom-ming"
        assert theme.title == "鄭和下西洋賽"


class TestListAndValidate:
    def test_list_themes_includes_both_builtins(self):
        store = InMemoryThemeStore()
        summaries = svc.list_themes(store)
        keys = {s.key for s in summaries}
        assert {TANG_THEME_KEY, SONG_THEME_KEY} <= keys
        assert all(s.is_builtin for s in summaries if s.key in (TANG_THEME_KEY, SONG_THEME_KEY))

    def test_list_themes_includes_custom_after_upsert(self):
        store = InMemoryThemeStore()
        svc.upsert_custom_theme(store, _valid_payload())
        summaries = svc.list_themes(store)
        custom = [s for s in summaries if s.key == "custom-ming"]
        assert len(custom) == 1
        assert custom[0].is_builtin is False

    def test_validate_theme_payload_returns_errors_for_bad_payload(self):
        theme, errors = svc.validate_theme_payload(_valid_payload(title="<script>x</script>"))
        assert theme is None
        assert any("title" in e["loc"] for e in errors)

    def test_validate_theme_payload_success_has_no_errors(self):
        theme, errors = svc.validate_theme_payload(_valid_payload())
        assert theme is not None
        assert errors == []


class TestUpsertDeleteAndBuiltinProtection:
    def test_upsert_invalid_payload_raises_422(self):
        store = InMemoryThemeStore()
        with pytest.raises(svc.ThemeServiceError) as exc_info:
            svc.upsert_custom_theme(store, _valid_payload(title=""))
        assert exc_info.value.status_code == 422

    def test_upsert_cannot_overwrite_builtin_key(self):
        store = InMemoryThemeStore()
        with pytest.raises(svc.ThemeServiceError) as exc_info:
            svc.upsert_custom_theme(store, _valid_payload(key=TANG_THEME_KEY))
        assert exc_info.value.status_code == 409

    def test_delete_builtin_theme_rejected(self):
        store = InMemoryThemeStore()
        with pytest.raises(svc.ThemeServiceError) as exc_info:
            svc.delete_custom_theme(store, TANG_THEME_KEY)
        assert exc_info.value.status_code in (404, 409)

    def test_delete_nonexistent_custom_theme_404(self):
        store = InMemoryThemeStore()
        with pytest.raises(svc.ThemeServiceError) as exc_info:
            svc.delete_custom_theme(store, "no-such-theme")
        assert exc_info.value.status_code == 404

    def test_delete_custom_theme_clears_active_and_season_pointers(self):
        store = InMemoryThemeStore()
        svc.upsert_custom_theme(store, _valid_payload())
        svc.set_active_theme(store, "custom-ming")
        svc.assign_season_theme(store, 5, "custom-ming")

        svc.delete_custom_theme(store, "custom-ming")

        assert store.get_active_key() is None
        assert store.get_season_theme_key(5) is None
        # Resolution must fall all the way back to the builtin default now.
        assert svc.get_theme_for_season(store, SimpleNamespace(id=5)).key == DEFAULT_THEME_KEY


class TestActiveAndSeasonAssignment:
    def test_set_active_theme_unknown_key_404(self):
        store = InMemoryThemeStore()
        with pytest.raises(svc.ThemeServiceError) as exc_info:
            svc.set_active_theme(store, "no-such-theme")
        assert exc_info.value.status_code == 404

    def test_get_active_theme_defaults_to_builtin_default_when_unset(self):
        store = InMemoryThemeStore()
        assert svc.get_active_theme(store).key == DEFAULT_THEME_KEY

    def test_assign_season_theme_unknown_key_404(self):
        store = InMemoryThemeStore()
        with pytest.raises(svc.ThemeServiceError) as exc_info:
            svc.assign_season_theme(store, 1, "no-such-theme")
        assert exc_info.value.status_code == 404

    def test_assign_season_theme_none_clears_override(self):
        store = InMemoryThemeStore()
        svc.assign_season_theme(store, 1, SONG_THEME_KEY)
        assert svc.get_theme_for_season(store, SimpleNamespace(id=1)).key == SONG_THEME_KEY
        svc.assign_season_theme(store, 1, None)
        assert svc.get_theme_for_season(store, SimpleNamespace(id=1)).key == DEFAULT_THEME_KEY
