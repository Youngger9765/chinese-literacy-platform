"""「和」as a conjunction reads ㄏㄢˋ in Taiwan, and Azure says ㄏㄜˊ.

Reported by Hans on L01: 「和」向心力 should be ㄏㄢˋ. Owner confirmed the target
reading and asked for a decision rather than a list of options; the decision was
to keep the voice and fix what can be fixed with the substitution mechanism we
already have.

和 is a polyphone, so a blind swap is wrong — 和平 is ㄏㄜˊ and 一唱一和 is ㄏㄜˋ.
What makes this one tractable, unlike 摸不著, is that:

  - a stand-in exists: 漢 is single-reading ㄏㄢˋ (摸不著 needs ㄓㄠˊ, and 著 is
    the only character in the whole MOE dictionary with that reading);
  - the exception set is enumerable: every multi-character MOE entry whose 和 is
    read as something other than ㄏㄢˋ — 489 of them.

So: substitute only where 和 stands alone, and never inside a listed word.
"""
from __future__ import annotations

import pytest

from app.services.tts.normalization import _apply_phoneme_corrections as fix


def swapped(text: str) -> bool:
    """True when this text's 和 was marked for the ㄏㄢˋ reading."""
    return '<sub alias="漢">和</sub>' in fix(text)


class TestConjunction:
    @pytest.mark.parametrize("text", [
        "向心力和向心加速度。",      # Hans's sentence
        "我和你一起去。",
        "蘋果和香蕉。",
        "他和我都喜歡。",
        "白天和黑夜。",
    ])
    def test_standalone_he_is_marked(self, text):
        assert swapped(text), f"conjunction 和 left unmarked in {text!r}"


class TestExceptions:
    @pytest.mark.parametrize("text", [
        "我們追求和平的生活。",      # ㄏㄜˊ
        "他的個性很溫和。",          # ㄏㄜˊ
        "廟裡有一位和尚。",          # ㄏㄜˊ
        "兩人一唱一和。",            # ㄏㄜˋ
        "耶和華說。",                # ㄏㄜˊ
        "這是一個和諧的社會。",      # ㄏㄜˊ
        "總和是一百。",              # ㄏㄜˊ
    ])
    def test_he_inside_a_word_is_left_alone(self, text):
        assert not swapped(text), (
            f"和 inside a word was swapped in {text!r} — that trades one wrong "
            "reading for another"
        )

    def test_a_word_the_list_misses_is_still_caught_by_segmentation(self):
        """Each gate has to earn its place.

        和煦 (ㄏㄜˊ) is not in the exception list, so the list alone would let it
        through — segmentation is what keeps it whole. A mutation that deletes
        the segmentation gate passes every other test in this file, which is why
        this case exists.
        """
        assert not swapped("和煦的陽光照在身上。")

    def test_a_sentence_can_hold_both(self):
        """The exception must not disable the rule for the rest of the sentence."""
        out = fix("和平和戰爭。")
        assert out.count('<sub alias="漢">和</sub>') == 1, out
        assert "和平" in out.replace('<sub alias="漢">和</sub>', "|")


class TestNotOverreaching:
    def test_mo_bu_zhao_is_still_untouched(self):
        """摸不著 has no stand-in and must not acquire a wrong one.

        Positive control for the exception logic: if this ever starts being
        rewritten, something is matching far too eagerly.
        """
        out = fix("讓對手摸不著頭緒。")
        assert "摸不著" in out
        assert "<sub" not in out or "著" not in out.split("<sub")[1][:20]
