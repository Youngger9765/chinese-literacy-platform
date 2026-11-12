"""TDD for team_arena.story_adapter — PRD §8 (劇情外觀: 只用 StoryPack 既有
欄位) and §13 AC11."""
from __future__ import annotations

from app.services.story_pack_defaults import BUILTIN_PACKS, DEFAULT_PACK_KEY
from app.services.team_arena.story_adapter import (
    DEFAULT_TEAM_LABELS,
    resolve_story_for_session,
)


class TestResolveWithValidPack:
    def test_team_labels_come_from_faction_labels(self):
        story = resolve_story_for_session(DEFAULT_PACK_KEY)
        pack = BUILTIN_PACKS[DEFAULT_PACK_KEY]
        assert story["team_labels"] == list(pack.faction_labels)
        assert len(story["team_labels"]) == 2

    def test_energy_bar_label_comes_from_pack(self):
        story = resolve_story_for_session(DEFAULT_PACK_KEY)
        pack = BUILTIN_PACKS[DEFAULT_PACK_KEY]
        assert story["energy_bar_label"] == pack.energy_bar_label

    def test_result_copy_has_win_lose_draw(self):
        story = resolve_story_for_session(DEFAULT_PACK_KEY)
        assert set(story["result_copy"]) == {"win", "lose", "draw"}
        for v in story["result_copy"].values():
            assert isinstance(v, str) and v

    def test_intro_is_a_non_empty_string(self):
        story = resolve_story_for_session(DEFAULT_PACK_KEY)
        assert isinstance(story["intro"], str) and story["intro"]

    def test_every_builtin_pack_resolves_without_error(self):
        """Sweep every shipped pack (上古神話/唐/宋/武俠/偵探劇) — none of
        them should need a new StoryPack schema field (PRD §8: "不跟
        StoryPack 要新欄位")."""
        for key in BUILTIN_PACKS:
            story = resolve_story_for_session(key)
            assert len(story["team_labels"]) == 2
            assert story["energy_bar_label"]


class TestResolveFallsBackSafely:
    """PRD §8: "adapter 讀不到或劇情包壞掉 → 回內建文案，比賽照常進行"."""

    def test_unknown_pack_key_falls_back_to_default_pack(self):
        story = resolve_story_for_session("not-a-real-pack-key")
        default_story = resolve_story_for_session(DEFAULT_PACK_KEY)
        assert story == default_story

    def test_none_key_falls_back_to_default_pack(self):
        story = resolve_story_for_session(None)
        default_story = resolve_story_for_session(DEFAULT_PACK_KEY)
        assert story == default_story

    def test_never_raises_even_if_registry_lookup_explodes(self, monkeypatch):
        import app.services.team_arena.story_adapter as mod

        class _ExplodingRegistry:
            def get(self, *args, **kwargs):
                raise RuntimeError("simulated registry failure")

        monkeypatch.setattr(mod, "BUILTIN_PACKS", _ExplodingRegistry())
        story = mod.resolve_story_for_session("anything")
        assert story["team_labels"] == list(DEFAULT_TEAM_LABELS)
        assert set(story["result_copy"]) == {"win", "lose", "draw"}


class TestBuiltinFallbackNeutralCopy:
    """PRD §7/§11: 不選就用內建中性文案（青隊／橙隊、「書塔」、「主堡」）."""

    def test_default_team_labels_are_the_prd_literal_pair(self):
        assert DEFAULT_TEAM_LABELS == ("青隊", "橙隊")

    def test_fallback_never_contains_banned_terms(self):
        from app.schemas.story_pack import BANNED_POLITICAL_TERMS

        story = resolve_story_for_session(None)
        blob = " ".join(
            [story["intro"], *story["team_labels"], *story["result_copy"].values()]
        )
        for term in BANNED_POLITICAL_TERMS:
            assert term not in blob
