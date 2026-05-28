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
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import yaml

from app.services.lesson_loader import get_all_lessons, get_lesson_by_code
from app.services.omo_question_schema import _build_question_schema


# ---------------------------------------------------------------------------
# Raw YAML access (for count integrity checks that lesson_loader strips out)
# ---------------------------------------------------------------------------

# Resolves to backend/data/lessons regardless of where pytest is invoked from.
_LESSONS_ROOT = Path(__file__).resolve().parent.parent / "data" / "lessons"


def _raw_yaml_for(lesson_code: str) -> dict:
    """Load a single lesson's raw YAML file by lesson_code (e.g. "G6-L25").

    Needed for checking ``fill_in_blank_count`` (and other ``*_count`` fields)
    that ``lesson_loader`` does not propagate into the runtime dict — going
    through ``get_lesson_by_code`` would always return None for these fields,
    so the test would silently pass without exercising anything (Round 1 🔴).
    """
    # Prefer the most recent parsed layer; fall back to glob if structure changes.
    candidate = _LESSONS_ROOT / "_parsed_2026-05-01" / f"{lesson_code}.yml"
    if not candidate.exists():
        matches = list(_LESSONS_ROOT.rglob(f"{lesson_code}.yml"))
        assert matches, f"No raw YAML found for lesson {lesson_code}"
        candidate = matches[0]
    with candidate.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def _all_raw_yamls() -> list[tuple[str, dict]]:
    """Yield (lesson_code, raw_dict) for every lesson YAML in the catalog.

    Used by catalog-wide structural checks that need to see fields stripped
    by ``lesson_loader`` (e.g. ``fill_in_blank_count``).
    """
    out: list[tuple[str, dict]] = []
    for path in sorted(_LESSONS_ROOT.rglob("*.yml")):
        # Skip non-lesson YAML (e.g. config / index files); a lesson YAML
        # always has at least ``title``.
        try:
            with path.open("r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except Exception:
            continue
        if not isinstance(data, dict) or "title" not in data:
            continue
        code = data.get("lesson_code") or path.stem
        out.append((code, data))
    return out


# ---------------------------------------------------------------------------
# G6-L24 and G6-L25 specific — pinned semantic answers (issue #2015 fix)
# ---------------------------------------------------------------------------

# Maps each fill_in_blank sentence-fragment to the vocabulary word that fits
# semantically. If the YAML's answer letter resolves to anything else, the
# whole grading flow scores legitimate student work as 0 (#2015 reproducer).
G6_L24_EXPECTED_ANSWERS: list[tuple[str, str]] = [
    ("教師職缺", "僧多粥少"),
    ("岸邊巨浪", "翻騰"),
    ("北風", "凜冽"),
    ("這項改革", "徒勞無功"),
    ("不知道該怎麼辦", "束手無策"),
    ("忙完畢業展", "筋疲力竭"),
    ("災後援助若拖延", "緩不濟急"),
    ("雙重壓力", "窒息"),
]

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


def _find_lesson(code: str) -> dict:
    lesson = get_lesson_by_code(code)
    assert lesson is not None, f"{code} lesson YAML missing from catalog"
    return lesson


class TestG6L24AnswerMapping:
    """G6-L24 had the same parser bug as G6-L25 (#2015) — 5/8 fb answers and
    fill_in_blank_count both wrong.  Pinned here so a future re-parse cannot
    silently regress it."""
    def setup_method(self) -> None:
        self.lesson = _find_lesson("G6-L24")
        self.questions = _build_question_schema(self.lesson)
        self.fb_questions = [q for q in self.questions if q["id"].startswith("fb_")]

    def test_fill_in_blank_has_8_questions(self) -> None:
        assert len(self.fb_questions) == 8, (
            f"G6-L24 should produce 8 fb questions, got {len(self.fb_questions)}"
        )

    def test_fill_in_blank_count_matches_array_length(self) -> None:
        raw = _raw_yaml_for("G6-L24")
        count_field = raw.get("fill_in_blank_count")
        actual_len = len(raw.get("fill_in_blank") or [])
        assert count_field == actual_len, (
            f"G6-L24 raw YAML fill_in_blank_count={count_field} "
            f"but fill_in_blank array has {actual_len} entries"
        )

    @pytest.mark.parametrize("idx,fragment_word", list(enumerate(G6_L24_EXPECTED_ANSWERS)))
    def test_each_fb_answer_matches_sentence_semantically(
        self,
        idx: int,
        fragment_word: tuple[str, str],
    ) -> None:
        sentence_fragment, expected_word = fragment_word
        q = self.fb_questions[idx]
        assert sentence_fragment in q["context"], (
            f"fb_{idx + 1} context does not contain expected fragment "
            f"{sentence_fragment!r}; got {q['context']!r}"
        )
        actual_word = q.get("correct_word") or q["correct_answer"]
        assert actual_word == expected_word, (
            f"fb_{idx + 1} {sentence_fragment!r} resolves to {actual_word!r}, "
            f"expected {expected_word!r}"
        )


class TestG6L25AnswerMapping:
    def setup_method(self) -> None:
        self.lesson = _find_lesson("G6-L25")
        self.questions = _build_question_schema(self.lesson)
        # fb_* only — exclude mc_* / se_*
        self.fb_questions = [q for q in self.questions if q["id"].startswith("fb_")]

    def test_fill_in_blank_has_8_questions(self) -> None:
        assert len(self.fb_questions) == 8, (
            f"G6-L25 should produce 8 fb questions, got {len(self.fb_questions)}"
        )

    def test_fill_in_blank_count_matches_array_length(self) -> None:
        """`fill_in_blank_count` field in the raw YAML must equal array length.

        ``lesson_loader`` does not propagate this field into the runtime dict,
        so we check it directly against the raw YAML file. This catches the
        kind of typo introduced in #2015 (`fill_in_blank_count: 5` when
        actually 8 entries exist) even though no production code reads it.
        """
        raw = _raw_yaml_for("G6-L25")
        count_field = raw.get("fill_in_blank_count")
        actual_len = len(raw.get("fill_in_blank") or [])
        assert count_field == actual_len, (
            f"G6-L25 raw YAML fill_in_blank_count={count_field} "
            f"but fill_in_blank array has {actual_len} entries"
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
        """Every lesson with both fields should have them in sync (#2015).

        Reads raw YAML (not lesson_loader) because the loader strips
        ``fill_in_blank_count`` — going through the runtime dict would
        always skip and silently pass nothing.
        """
        mismatches = []
        for code, raw in _all_raw_yamls():
            fb = raw.get("fill_in_blank")
            count = raw.get("fill_in_blank_count")
            if fb is None or count is None:
                continue
            actual = len(fb) if isinstance(fb, list) else 0
            if count != actual:
                mismatches.append((code, count, actual))
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
