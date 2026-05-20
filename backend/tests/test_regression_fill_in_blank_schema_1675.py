"""Regression tests for fill_in_blank schema alignment — Issue #1675 / PR #1678.

Verifies the 6 specific lessons fixed by #1675 have coherent fill_in_blank data:
  - answer letter codes match vocab_bank keys
  - sentence and answer fields are present on legacy items
  - _schema normalizer tag is applied to all items
  - vocab_bank is present when legacy items reference it

The 6 lessons fixed:
  - L15.yml  → grade_code G6-L04 (兩千五百歲的酷老師) — Layer-1
  - L24.yml  → grade_code G6-L03 (昆蟲會思考嗎?)   — Layer-1
  - G6-L22.yml → 雞鳴狗盜 — Layer-2 priority demo
  - G6-L23.yml → 老鷹紅豆 — Layer-2 priority demo
  - G6-L24.yml → 白鯨救援 — Layer-2 priority demo
  - G6-L25.yml → 荷蘭東印度 — Layer-2 priority demo

Root cause of #1675: vocab_bank letter order + sentence text were AI-generated
placeholders that did not match the printed worksheets. OMO grader scored 0.13/0.20
because answer letter codes (e.g. 'A') pointed to wrong vocabulary words.

Run:
    cd backend && python -m pytest tests/test_regression_fill_in_blank_schema_1675.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.services.lesson_loader import get_lesson_by_code, get_all_lessons

# The 6 lessons fixed by Issue #1675. Two are Layer-1 (by grade_code), four Layer-2.
_FIXED_LESSON_CODES = [
    "G6-L04",   # L15.yml (兩千五百歲的酷老師) — Layer-1
    "G6-L03",   # L24.yml (昆蟲會思考嗎?) — Layer-1
    "G6-L22",   # 雞鳴狗盜 — Layer-2
    "G6-L23",   # 老鷹紅豆 — Layer-2
    "G6-L24",   # 白鯨救援 — Layer-2
    "G6-L25",   # 荷蘭東印度 — Layer-2
]


def _get_fixed_lessons():
    """Load the 6 lessons fixed by Issue #1675."""
    results = {}
    for code in _FIXED_LESSON_CODES:
        lesson = get_lesson_by_code(code)
        if lesson is not None:
            results[code] = lesson
    return results


class TestFixedLessonsHaveFillInBlankData:
    """The 6 fixed lessons must have fill_in_blank data after the fix."""

    @pytest.fixture(scope="class")
    def fixed_lessons(self):
        return _get_fixed_lessons()

    def test_fixed_lessons_are_loadable(self, fixed_lessons):
        """All 6 lesson codes from Issue #1675 must be loadable."""
        missing = [code for code in _FIXED_LESSON_CODES if code not in fixed_lessons]
        assert not missing, (
            f"Lessons not found: {missing}. "
            f"These were fixed in Issue #1675. "
            f"Was the lesson YAML removed or the lesson_code changed?"
        )

    def test_fixed_lessons_have_fill_in_blank(self, fixed_lessons):
        """Each of the 6 fixed lessons must have fill_in_blank data."""
        failures = []
        for code, lesson in fixed_lessons.items():
            fib = lesson.get("fill_in_blank")
            if not fib or len(fib) == 0:
                failures.append(
                    f"{code}: fill_in_blank is missing or empty. "
                    f"Was the YAML fill_in_blank block removed?"
                )
        assert not failures, "\n".join(failures)

    def test_fixed_lessons_have_vocab_bank(self, fixed_lessons):
        """Each of the 6 fixed lessons must have a vocab_bank dict."""
        failures = []
        for code, lesson in fixed_lessons.items():
            fib = lesson.get("fill_in_blank") or []
            has_legacy = any(item.get("_schema") == "legacy" for item in fib)
            if has_legacy and not lesson.get("vocab_bank"):
                failures.append(
                    f"{code}: has legacy fill_in_blank items but vocab_bank is missing. "
                    f"Issue #1675 aligned vocab_bank — it was reverted."
                )
        assert not failures, "\n".join(failures)


class TestFixedLessonsAnswerVocabBankCoherence:
    """Core regression: answer letter codes must match vocab_bank keys."""

    @pytest.fixture(scope="class")
    def fixed_lessons(self):
        return _get_fixed_lessons()

    def test_legacy_answer_letters_in_vocab_bank(self, fixed_lessons):
        """For each fixed lesson: every single-letter answer must be in vocab_bank.

        This is the exact regression caught by Issue #1675:
        answer='A' pointing to vocab_bank with no 'A' key → wrong word displayed.
        """
        failures = []
        for code, lesson in fixed_lessons.items():
            vocab_bank = lesson.get("vocab_bank") or {}
            fib = lesson.get("fill_in_blank") or []
            for i, item in enumerate(fib):
                if item.get("_schema") != "legacy":
                    continue
                answer = item.get("answer", "")
                # Only check single uppercase letter codes (not freetext answers)
                if len(answer) == 1 and answer.isupper() and answer.isalpha():
                    if answer not in vocab_bank:
                        failures.append(
                            f"{code} item[{i}]: answer={answer!r} not in "
                            f"vocab_bank keys={sorted(vocab_bank.keys())}. "
                            f"This was the exact bug fixed in Issue #1675 — "
                            f"vocab_bank letter order must match answer codes."
                        )
        assert not failures, (
            f"{len(failures)} answer-vocab_bank mismatches (Issue #1675 regression):\n"
            + "\n".join(failures)
        )

    def test_vocab_bank_has_at_least_one_entry(self, fixed_lessons):
        """vocab_bank must not be empty for lessons with letter-coded answers."""
        failures = []
        for code, lesson in fixed_lessons.items():
            fib = lesson.get("fill_in_blank") or []
            has_letter_coded = any(
                item.get("_schema") == "legacy"
                and len(item.get("answer", "")) == 1
                and item.get("answer", "").isupper()
                and item.get("answer", "").isalpha()
                for item in fib
            )
            if has_letter_coded:
                vocab_bank = lesson.get("vocab_bank") or {}
                if len(vocab_bank) == 0:
                    failures.append(f"{code}: vocab_bank is empty but has letter-coded answers")
        assert not failures, "\n".join(failures)


class TestNormalizerAppliedToAllItems:
    """_normalize_fill_in_blank_item() must be applied to all loaded items."""

    @pytest.fixture(scope="class")
    def fixed_lessons(self):
        return _get_fixed_lessons()

    def test_all_fill_in_blank_items_have_schema_tag(self, fixed_lessons):
        """Every fill_in_blank item in the 6 fixed lessons must have _schema tag."""
        failures = []
        for code, lesson in fixed_lessons.items():
            for i, item in enumerate(lesson.get("fill_in_blank") or []):
                if "_schema" not in item:
                    failures.append(
                        f"{code} item[{i}]: missing _schema tag. "
                        f"lesson_loader normalizer not applied?"
                    )
        assert not failures, "\n".join(failures)

    def test_legacy_items_have_sentence_field(self, fixed_lessons):
        """Every legacy-schema item must have a sentence field."""
        failures = []
        for code, lesson in fixed_lessons.items():
            for i, item in enumerate(lesson.get("fill_in_blank") or []):
                if item.get("_schema") == "legacy" and not item.get("sentence"):
                    failures.append(
                        f"{code} item[{i}]: legacy item missing sentence field. "
                        f"Item: {item}"
                    )
        assert not failures, "\n".join(failures)

    def test_legacy_items_have_answer_field(self, fixed_lessons):
        """Every legacy-schema item must have an answer field."""
        failures = []
        for code, lesson in fixed_lessons.items():
            for i, item in enumerate(lesson.get("fill_in_blank") or []):
                if item.get("_schema") == "legacy" and "answer" not in item:
                    failures.append(
                        f"{code} item[{i}]: legacy item missing answer field. "
                        f"Item: {item}"
                    )
        assert not failures, "\n".join(failures)


class TestGlobalNormalizerInvariant:
    """_schema tag is applied globally across all Layer-1 lessons."""

    def test_all_layer1_fib_items_have_schema_tag(self):
        """All Layer-1 lessons' fill_in_blank items must have _schema tag.

        This is a global normalizer invariant — if the normalizer is not called,
        _schema would be absent and the frontend filter logic breaks.
        """
        lessons = get_all_lessons()
        layer1 = [l for l in lessons if l.get("_layer") == 1 and l.get("fill_in_blank")]
        failures = []
        for lesson in layer1:
            for i, item in enumerate(lesson["fill_in_blank"]):
                if "_schema" not in item:
                    failures.append(
                        f"Lesson {lesson['lesson_code']} item[{i}]: missing _schema tag"
                    )
        assert not failures, (
            f"{len(failures)} Layer-1 fill_in_blank items missing _schema:\n"
            + "\n".join(failures[:5])
        )

    def test_layer1_items_are_predominantly_legacy_schema(self):
        """Layer-1 fill_in_blank items should be predominantly 'legacy' schema (≥80%).

        If most items are context_fill, the normalizer is miscategorizing.
        (Layer-2 items that are primarily context_fill are expected.)
        """
        lessons = get_all_lessons()
        layer1 = [l for l in lessons if l.get("_layer") == 1 and l.get("fill_in_blank")]
        legacy_count = 0
        context_fill_count = 0
        for lesson in layer1:
            for item in lesson["fill_in_blank"]:
                schema = item.get("_schema")
                if schema == "legacy":
                    legacy_count += 1
                elif schema == "context_fill":
                    context_fill_count += 1

        total = legacy_count + context_fill_count
        assert total > 0, "No fill_in_blank items found in Layer-1 lessons."
        legacy_pct = legacy_count / total * 100
        assert legacy_pct >= 80, (
            f"Only {legacy_pct:.1f}% of Layer-1 fill_in_blank items are 'legacy' schema. "
            f"Expected ≥80%. legacy={legacy_count}, context_fill={context_fill_count}. "
            f"Possible normalizer regression."
        )
