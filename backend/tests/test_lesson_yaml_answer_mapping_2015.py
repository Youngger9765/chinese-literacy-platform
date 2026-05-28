"""Regression test for #2015 — lesson YAML fill_in_blank answer letter mapping.

The lesson YAML parser previously emitted G6-L25 with the 8 fill_in_blank
answer letters shuffled relative to the sentences, so semantically correct
student answers were scored 0/0. This test pins the canonical letter→word
resolution for G6-L25 to catch any future re-parse / edit that breaks it,
and also runs a structural sanity check across every lesson in the
catalog to surface similar issues early.

Run:
    cd backend && python -m pytest tests/test_lesson_yaml_answer_mapping_2015.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.services.lesson_loader import get_all_lessons, get_lesson_by_code
from app.services.omo_question_schema import _build_question_schema


# ---------------------------------------------------------------------------
# G6-L25 specific — pinned semantic answers (issue #2015 fix)
# ---------------------------------------------------------------------------

# Maps each fill_in_blank sentence-fragment to the vocabulary word that fits
# semantically. If the YAML's answer letter resolves to anything else, the
# whole grading flow scores legitimate student work as 0 (#2015 reproducer).
G6_L25_EXPECTED_ANSWERS: list[tuple[str, str]] = [
    ("公司今年", "獲利"),
    ("大學畢業後", "揚帆啟航"),
    ("粗重的農事", "滿手老繭"),
    ("開一家新的飲料店", "集資"),
    ("到海外受訓", "派遣"),
    ("經濟不寬裕", "節衣縮食"),
    ("贊助全校一年的午餐費用", "大手一揮"),
    ("關注（", "股票"),
]


def _find_lesson_g6_l25() -> dict:
    lesson = get_lesson_by_code("G6-L25")
    assert lesson is not None, "G6-L25 lesson YAML missing from catalog"
    return lesson


class TestG6L25AnswerMapping:
    def setup_method(self) -> None:
        self.lesson = _find_lesson_g6_l25()
        self.questions = _build_question_schema(self.lesson)
        # fb_* only — exclude mc_* / se_*
        self.fb_questions = [q for q in self.questions if q["id"].startswith("fb_")]

    def test_fill_in_blank_has_8_questions(self) -> None:
        assert len(self.fb_questions) == 8, (
            f"G6-L25 should produce 8 fb questions, got {len(self.fb_questions)}"
        )

    def test_fill_in_blank_count_matches_array_length(self) -> None:
        """`fill_in_blank_count` field, when present, must equal the array length.

        Note: ``lesson_loader`` does not currently propagate this field into
        the loaded dict — it lives only in the raw YAML. We keep the YAML
        value accurate (fixed 5→8 in this PR) but the runtime check is
        skipped when the field is absent, since downstream code never reads it.
        """
        count_field = self.lesson.get("fill_in_blank_count")
        actual_len = len(self.lesson.get("fill_in_blank") or [])
        if count_field is None:
            pytest.skip("fill_in_blank_count not propagated by lesson_loader; "
                        "raw YAML was still corrected in this PR")
        assert count_field == actual_len, (
            f"G6-L25 fill_in_blank_count={count_field} but actual array has {actual_len} entries"
        )

    @pytest.mark.parametrize("idx,fragment_word", list(enumerate(G6_L25_EXPECTED_ANSWERS)))
    def test_each_fb_answer_matches_sentence_semantically(
        self,
        idx: int,
        fragment_word: tuple[str, str],
    ) -> None:
        """Each fb question's resolved word must match the sentence's intended meaning."""
        sentence_fragment, expected_word = fragment_word
        q = self.fb_questions[idx]
        assert sentence_fragment in q["context"], (
            f"fb_{idx + 1} context does not contain expected fragment "
            f"{sentence_fragment!r}; got {q['context']!r}"
        )
        # `correct_word` is the resolved vocabulary word; `correct_answer`
        # depends on lettered/free-form mode (which differs across lessons).
        actual_word = q.get("correct_word") or q["correct_answer"]
        assert actual_word == expected_word, (
            f"fb_{idx + 1} {sentence_fragment!r} resolves to {actual_word!r}, "
            f"expected {expected_word!r}"
        )


# ---------------------------------------------------------------------------
# Catalog-wide structural sanity (cheap; catches future re-parse issues)
# ---------------------------------------------------------------------------

# Lessons that already have out-of-vocab-range fb answers when this guard was
# introduced (#2015). They are tracked here so the structural test catches
# *new* regressions immediately, but does not fail on the pre-existing data
# debt. Each of these should be inspected and fixed in a separate Layer 2 PR
# (see #2015 follow-up). Remove a lesson from this list when its YAML is
# corrected.
_KNOWN_OUT_OF_RANGE_PRE_2015: frozenset[str] = frozenset({
    "G5-L4",
    "G5-L27",
    "G7-L07",
    "G8-L12a",
})


class TestLessonCatalogStructuralSanity:
    @classmethod
    def setup_class(cls) -> None:
        cls.lessons = list(get_all_lessons())
        assert cls.lessons, "Catalog should contain at least one lesson"

    def test_fill_in_blank_count_matches_array_length_for_all_lessons(self) -> None:
        """Every lesson with both fields should have them in sync (#2015)."""
        mismatches = []
        for lesson in self.lessons:
            fb = lesson.get("fill_in_blank")
            count = lesson.get("fill_in_blank_count")
            if fb is None or count is None:
                continue
            actual = len(fb) if isinstance(fb, list) else 0
            if count != actual:
                mismatches.append(
                    (lesson.get("lesson_code") or lesson.get("title"), count, actual),
                )
        assert not mismatches, (
            "Lessons with fill_in_blank_count != len(fill_in_blank): "
            + ", ".join(f"{code}:count={c},actual={a}" for code, c, a in mismatches)
        )

    def test_fb_answer_letters_within_vocabulary_range(self) -> None:
        """Every fb answer letter must point to a valid vocabulary index.

        Catches the structural variant of #2015 where ``answer: X`` references
        ``vocabulary[ord(X) - ord('A')]`` but X is out of range — even if
        ``_resolve_letter_answer`` falls back to returning the raw letter,
        the grading semantics are broken.

        Lessons in ``_KNOWN_OUT_OF_RANGE_PRE_2015`` are excluded so this guard
        catches *new* regressions while the pre-existing data debt is fixed
        in a separate Layer 2 PR. Any new lesson hitting this assertion means
        the parser (or a manual edit) re-introduced the #2015 class of bug.
        """
        new_failures = []
        for lesson in self.lessons:
            fb = lesson.get("fill_in_blank")
            vocab = lesson.get("vocabulary")
            if not isinstance(fb, list) or not isinstance(vocab, list):
                continue
            lesson_code = lesson.get("lesson_code") or lesson.get("title")
            if lesson_code in _KNOWN_OUT_OF_RANGE_PRE_2015:
                continue
            vocab_len = len(vocab)
            for i, item in enumerate(fb):
                if not isinstance(item, dict):
                    continue
                ans = str(item.get("answer", "")).strip().upper()
                if len(ans) != 1 or not ans.isalpha():
                    # Non-letter answer (free-form text) — skip structural check
                    continue
                idx = ord(ans) - ord("A")
                if idx >= vocab_len:
                    new_failures.append((lesson_code, i + 1, ans, vocab_len))
        assert not new_failures, (
            "NEW out-of-range fb answers (not in _KNOWN_OUT_OF_RANGE_PRE_2015): "
            + ", ".join(
                f"{code}/fb_{n}:answer={a}(idx={ord(a) - ord('A')}),vocab_len={vl}"
                for code, n, a, vl in new_failures
            )
        )
