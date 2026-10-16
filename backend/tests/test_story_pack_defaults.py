"""Regression lock: all five shipped builtin story packs (上古神話 default,
唐, 宋, 武俠, 偵探劇) exist, are valid `StoryPack`s, are genuinely different
content (not a copy-paste with the era swapped), contain no fox-cat /
Junyi-specific vocabulary (CLAUDE.md IP boundary), and pass the political-
neutrality banned-term check (Young 2026-10-16).
"""
from __future__ import annotations

import itertools

from app.schemas.story_pack import BADGE_KEY_CLASS, BADGE_KEY_INDIVIDUAL, StoryPack
from app.schemas.story_pack import BANNED_POLITICAL_TERMS
from app.services.story_pack_defaults import (
    BUILTIN_PACKS,
    DEFAULT_PACK,
    DEFAULT_PACK_KEY,
    DETECTIVE_PACK,
    DETECTIVE_PACK_KEY,
    MYTH_PACK,
    MYTH_PACK_KEY,
    SONG_PACK,
    SONG_PACK_KEY,
    TANG_PACK,
    TANG_PACK_KEY,
    WUXIA_PACK,
    WUXIA_PACK_KEY,
)

_BANNED_TERMS = ["狐狸貓", "foxcat", "fox-cat", "暗黑力量", "恆毅星塵", "理解光束", "讀家星圖"]

ALL_PACK_KEYS = {MYTH_PACK_KEY, TANG_PACK_KEY, SONG_PACK_KEY, WUXIA_PACK_KEY, DETECTIVE_PACK_KEY}


class TestBuiltinPacksAreValid:
    def test_all_five_are_storypack_instances(self):
        for pack in (MYTH_PACK, TANG_PACK, SONG_PACK, WUXIA_PACK, DETECTIVE_PACK):
            assert isinstance(pack, StoryPack)

    def test_registry_has_exactly_five_builtin_packs(self):
        assert set(BUILTIN_PACKS.keys()) == ALL_PACK_KEYS

    def test_default_pack_key_resolves_in_registry(self):
        assert DEFAULT_PACK_KEY in BUILTIN_PACKS
        assert BUILTIN_PACKS[DEFAULT_PACK_KEY] is DEFAULT_PACK

    def test_default_pack_is_myth_per_young_2026_10_16(self):
        """Young 2026-10-16: 上古神話 feels more fitting than a single dynasty
        as the shipped default — 唐/宋 remain fully selectable alternates."""
        assert DEFAULT_PACK_KEY == MYTH_PACK_KEY

    def test_each_pack_badges_cover_fixed_keys(self):
        for pack in BUILTIN_PACKS.values():
            keys = {b.key for b in pack.badges}
            assert keys == {BADGE_KEY_INDIVIDUAL, BADGE_KEY_CLASS}


class TestPacksAreGenuinelyDifferent:
    def test_eras_all_differ(self):
        eras = [p.era for p in BUILTIN_PACKS.values()]
        assert len(set(eras)) == len(eras)

    def test_titles_all_differ(self):
        titles = [p.title for p in BUILTIN_PACKS.values()]
        assert len(set(titles)) == len(titles)

    def test_faction_labels_all_differ(self):
        pairs = [tuple(p.faction_labels) for p in BUILTIN_PACKS.values()]
        assert len(set(pairs)) == len(pairs)

    def test_chest_names_all_differ(self):
        names = [p.chest.name for p in BUILTIN_PACKS.values()]
        assert len(set(names)) == len(names)

    def test_milestone_messages_pairwise_differ(self):
        for a, b in itertools.combinations(BUILTIN_PACKS.values(), 2):
            a_msgs = [m.message for m in a.milestones]
            b_msgs = [m.message for m in b.milestones]
            assert a_msgs != b_msgs


class TestNoReferenceProductVocabulary:
    def test_no_banned_terms_in_any_builtin_pack(self):
        for pack in BUILTIN_PACKS.values():
            blob = pack.model_dump_json()
            for term in _BANNED_TERMS:
                assert term not in blob, f"{pack.key} 含有禁用詞彙：{term}"

    def test_no_classical_quote_markers_in_historical_packs(self):
        # A loose heuristic, not a content-moderation system: 唐/宋/上古神話
        # don't quote a specific classical text in `intro` (citations live in
        # `milestones` instead, with an explicit 《book title》 marker, which
        # is a real citation, not a fabricated lifted quote) — so there
        # should be no quotation-mark-wrapped line in intro that looks like
        # a lifted classical quote. 武俠/偵探劇 are original settings with no
        # classical-source claim, so this check doesn't apply to them.
        for pack in (TANG_PACK, SONG_PACK, MYTH_PACK):
            for paragraph in pack.intro:
                assert "「" not in paragraph and "」" not in paragraph


class TestPoliticalNeutrality:
    """Young 2026-10-16: Taiwan-school political neutrality — never use
    nation/ethnicity framing, never frame antagonists as a people/country."""

    def test_no_banned_political_terms_in_any_pack_content(self):
        for pack in BUILTIN_PACKS.values():
            blob = pack.model_dump_json()
            for term in BANNED_POLITICAL_TERMS:
                assert term not in blob, f"{pack.key} 含有政治中立禁用詞：{term}"

    def test_myth_pack_cites_real_classical_sources(self):
        """Each 上古神話 milestone must cite a real, verifiable classical
        source (verified 2026-10-16) — not a vague "ancient times" claim."""
        citations = ["三五歷紀", "淮南子", "尚書", "史記"]
        blob = MYTH_PACK.model_dump_json()
        for citation in citations:
            assert citation in blob, f"上古神話缺少對「{citation}」的引用"

    def test_wuxia_pack_has_no_violence_language(self):
        banned_violence_terms = ["殺", "血", "死亡", "受傷", "兵器傷"]
        blob = WUXIA_PACK.model_dump_json()
        for term in banned_violence_terms:
            assert term not in blob, f"武俠劇情包含有暴力詞彙：{term}"

    def test_detective_pack_has_no_crime_violence_language(self):
        banned_crime_terms = ["殺", "血", "綁架", "凶手", "犯罪"]
        blob = DETECTIVE_PACK.model_dump_json()
        for term in banned_crime_terms:
            assert term not in blob, f"偵探劇劇情包含有犯罪暴力詞彙：{term}"
