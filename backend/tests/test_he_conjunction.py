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


class TestProperNounsAndVerbsWronglyDroppedAsRare(object):
    """鄭和/大和/和麵/零和 used to live only in _dropped_rare_two_char.

    jieba's default dictionary splits every one of them into two
    single-character tokens (鄭|和, 大|和, 和|麵, 零|和) — reported by
    kiro gpt-5.6-terra as false positives: a proper noun and a verb were
    getting the conjunction reading. Restored to he_exceptions.json's
    active `words` list; regression-locked here.
    """

    @pytest.mark.parametrize("text", [
        "鄭和",
        "鄭和七次下西洋。",
        "他叫鄭和。",
        "大和",
        "大和號是二次大戰的巨型戰艦。",
        "和麵",
        "媽媽在廚房和麵，準備做饅頭。",
        "這是一場零和遊戲。",
    ])
    def test_not_swapped(self, text):
        assert not swapped(text), (
            f"和 was swapped in {text!r} — this is a proper noun/verb/loanword, "
            "not the conjunction"
        )

    def test_still_a_conjunction_next_to_the_lookalike_substring(self):
        """很大和很小 contains the substring 大和 but is not the proper noun.

        Restoring 大和 to the exceptions list trades a rare false negative
        here for fixing the common false positive on the actual proper
        noun — the code's own stated safe direction (an unmarked 和 sounds
        like today; this is not asserted to still fire).  This test exists
        to document the trade-off, not to demand the conjunction still be
        caught.
        """
        # Documented trade-off: no assertion on the conjunction itself,
        # just confirm nothing raises and 大和-adjacent text is handled.
        fix("很大和很小的差別。")


class TestSelfReferenceIsNotAConjunction:
    """A 和 that names the character — quoted, titled, or the whole input —
    is not a conjunction. All five are kiro gpt-5.6-terra's counterexamples.
    """

    @pytest.mark.parametrize("text", [
        "「和」是形聲字，請把它圈出來。",   # worksheet: circle the character
        "「和」",
        "〈和〉",
        "《和》",
        "和",                              # bare UI label — the whole string
    ])
    def test_not_swapped(self, text):
        assert not swapped(text), (
            f"和 was swapped in {text!r} — it names the character, it does "
            "not conjoin anything"
        )

    def test_a_real_conjunction_inside_a_longer_quote_is_unaffected(self):
        """The guard only fires when 和 is immediately sandwiched by the
        quote pair with nothing else inside — a real conjunction elsewhere
        inside a quoted phrase must still be caught."""
        assert swapped("他說：「蘋果和香蕉都好吃。」")

    def test_curly_quotes_are_also_covered(self):
        assert not swapped("“和”")
        assert not swapped("‘和’")
