"""Regression lock: the two shipped default themes (唐/宋) exist, are valid
`LeagueTheme`s, are genuinely different seasons' worth of content (not a
copy-paste with the era swapped), and contain no fox-cat / Junyi-specific
vocabulary (CLAUDE.md IP boundary, carried into this feature's content too).
"""
from __future__ import annotations

from app.schemas.league_theme import BADGE_KEY_CLASS, BADGE_KEY_INDIVIDUAL, LeagueTheme
from app.services.league_theme_defaults import (
    BUILTIN_THEMES,
    DEFAULT_THEME,
    DEFAULT_THEME_KEY,
    SONG_THEME,
    SONG_THEME_KEY,
    TANG_THEME,
    TANG_THEME_KEY,
)

_BANNED_TERMS = ["狐狸貓", "foxcat", "fox-cat", "暗黑力量", "恆毅星塵", "理解光束", "讀家星圖"]


class TestBuiltinThemesAreValid:
    def test_both_themes_are_leaguetheme_instances(self):
        assert isinstance(TANG_THEME, LeagueTheme)
        assert isinstance(SONG_THEME, LeagueTheme)

    def test_registry_has_exactly_two_builtin_themes(self):
        assert set(BUILTIN_THEMES.keys()) == {TANG_THEME_KEY, SONG_THEME_KEY}

    def test_default_theme_key_resolves_in_registry(self):
        assert DEFAULT_THEME_KEY in BUILTIN_THEMES
        assert BUILTIN_THEMES[DEFAULT_THEME_KEY] is DEFAULT_THEME

    def test_each_theme_badges_cover_fixed_keys(self):
        for theme in BUILTIN_THEMES.values():
            keys = {b.key for b in theme.badges}
            assert keys == {BADGE_KEY_INDIVIDUAL, BADGE_KEY_CLASS}


class TestThemesAreGenuinelyDifferent:
    def test_eras_differ(self):
        assert TANG_THEME.era != SONG_THEME.era

    def test_titles_differ(self):
        assert TANG_THEME.title != SONG_THEME.title

    def test_faction_labels_differ(self):
        assert TANG_THEME.faction_labels != SONG_THEME.faction_labels

    def test_chest_and_badge_copy_differ(self):
        assert TANG_THEME.chest.name != SONG_THEME.chest.name
        tang_badge_names = {b.key: b.name for b in TANG_THEME.badges}
        song_badge_names = {b.key: b.name for b in SONG_THEME.badges}
        assert tang_badge_names != song_badge_names

    def test_milestone_messages_differ(self):
        tang_msgs = [m.message for m in TANG_THEME.milestones]
        song_msgs = [m.message for m in SONG_THEME.milestones]
        assert tang_msgs != song_msgs


class TestNoReferenceProductVocabulary:
    def test_no_banned_terms_in_any_builtin_theme(self):
        for theme in BUILTIN_THEMES.values():
            blob = theme.model_dump_json()
            for term in _BANNED_TERMS:
                assert term not in blob, f"{theme.key} 含有禁用詞彙：{term}"

    def test_no_classical_quote_markers(self):
        # A loose heuristic, not a content-moderation system: we don't quote
        # a specific classical text anywhere, so there should be no
        # quotation-mark-wrapped line that looks like a lifted citation.
        for theme in BUILTIN_THEMES.values():
            for paragraph in theme.intro:
                assert "「" not in paragraph and "」" not in paragraph
