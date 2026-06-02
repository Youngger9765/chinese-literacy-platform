"""Contract tests for OMO grading determinism — spec omo.grading.determinism.

These tests pin the invariants described in
``specs/modules/omo-determinism/INTENT.md``.

Design principle:
- All assertions were verified against the REAL functions before being written.
- Tests are GREEN (these invariants hold today).  We are LOCKING them in.
- Do NOT change these to xfail unless the corresponding INTENT.md rule is
  intentionally relaxed and Young has approved the change.

Run::
    cd backend && python -m pytest specs/test_omo_determinism_spec.py -v
"""

import glob
import sys
from pathlib import Path

import pytest
import yaml

# Make `app` importable when running from repo root or from backend/
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.services.omo_question_schema import _build_question_schema
from app.services.omo_scoring import (
    _LOW_CONFIDENCE_THRESHOLD,
    _score_answer,
    _validate_student_answer,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

LETTERED_QUESTION = {
    "id": "fb_1",
    "type": "fill_blank",
    "mode": "lettered",
    "allowed_values": ["A", "B", "C", ""],
    "correct_answer": "A",
}

FREE_FORM_QUESTION = {
    "id": "fb_2",
    "type": "fill_blank",
    "mode": "free_form",
    "allowed_values": ["良好", "努力", "進步"],
    "correct_answer": "良好",
}

LESSON_DIR = _BACKEND_DIR / "data" / "lessons" / "_parsed_2026-05-01"


# ---------------------------------------------------------------------------
# 1. Anti-fabrication: lettered mode coerces anything outside allowed_values
# ---------------------------------------------------------------------------


class TestAntiFabrication:
    """Rule 3: _validate_student_answer must coerce cage-outside values to empty.

    Gemini CANNOT make an answer stick that is not in allowed_values.
    """

    def test_chinese_word_is_coerced_to_empty(self):
        """'良好' is a plausible-looking Chinese answer — not in A/B/C cage."""
        result = _validate_student_answer("良好", LETTERED_QUESTION)
        assert result == ("", True), (
            "Fabricated Chinese word '良好' must be coerced to empty with was_fabricated=True"
        )

    def test_out_of_range_letter_Z_is_coerced(self):
        """'Z' is a letter but outside the allowed A/B/C set."""
        result = _validate_student_answer("Z", LETTERED_QUESTION)
        assert result == ("", True), (
            "Letter 'Z' outside allowed_values {A,B,C} must be coerced"
        )

    def test_numeral_is_coerced(self):
        """'99' is a numeral — impossible student answer for a lettered question."""
        result = _validate_student_answer("99", LETTERED_QUESTION)
        assert result == ("", True), (
            "Numeral '99' must be coerced to empty"
        )

    def test_lowercase_valid_letter_is_normalised(self):
        """Gemini may return lowercase 'a' — normalise to 'A', mark as valid."""
        result = _validate_student_answer("a", LETTERED_QUESTION)
        assert result == ("A", False), (
            "Lowercase valid letter 'a' must be normalised to 'A' without fabrication flag"
        )

    def test_empty_student_answer_is_valid(self):
        """Empty string = student left it blank (not fabrication)."""
        result = _validate_student_answer("", LETTERED_QUESTION)
        assert result == ("", False), (
            "Empty student answer is a legitimate 'no answer' — was_fabricated must be False"
        )

    def test_valid_uppercase_letter_passes(self):
        """'A' is in allowed_values and must pass through unchanged."""
        result = _validate_student_answer("A", LETTERED_QUESTION)
        assert result == ("A", False)

    def test_free_form_exact_chinese_match_passes(self):
        """Exact vocabulary word passes in free_form mode."""
        result = _validate_student_answer("良好", FREE_FORM_QUESTION)
        assert result == ("良好", False)

    def test_free_form_non_vocab_word_is_coerced(self):
        """A plausible but not-in-vocab Chinese word is fabrication in free_form mode."""
        result = _validate_student_answer("聰明", FREE_FORM_QUESTION)
        assert result == ("", True)


# ---------------------------------------------------------------------------
# 2. Determinism / idempotency: calling 50× always yields the same result
# ---------------------------------------------------------------------------


class TestDeterminism:
    """Rule 1: pure-Python pipeline — no randomness, no time, no LLM.

    Same input must always produce identical output, no matter how many times
    it is called.  This proves 'not a lottery'.
    """

    def test_validate_is_idempotent_over_50_calls(self):
        """_validate_student_answer('良好', lettered_q) is identical across 50 calls."""
        results = [
            _validate_student_answer("良好", LETTERED_QUESTION) for _ in range(50)
        ]
        unique = set(results)
        assert len(unique) == 1, (
            f"_validate_student_answer returned different results across calls: {unique}"
        )

    def test_score_is_idempotent_over_50_calls(self):
        """_score_answer('A','A','fill_blank') is identical across 50 calls."""
        results = [_score_answer("A", "A", "fill_blank") for _ in range(50)]
        unique = set(results)
        assert len(unique) == 1, (
            f"_score_answer returned different results across calls: {unique}"
        )

    def test_validate_empty_is_idempotent(self):
        """Empty-string validation is deterministic."""
        results = [
            _validate_student_answer("", LETTERED_QUESTION) for _ in range(50)
        ]
        assert len(set(results)) == 1


# ---------------------------------------------------------------------------
# 3. Scoring rules (pure-Python, no LLM)
# ---------------------------------------------------------------------------


class TestScoringRules:
    """Rule 5: _score_answer comparison rules are fixed.

    Empty → 0.0.  Exact match → 1.0.  Mismatch → 0.0.
    MC is case-insensitive; all other types require exact match.
    """

    def test_empty_student_scores_zero(self):
        assert _score_answer("", "A", "fill_blank") == 0.0

    def test_fill_blank_exact_match_scores_one(self):
        assert _score_answer("A", "A", "fill_blank") == 1.0

    def test_fill_blank_mismatch_scores_zero(self):
        assert _score_answer("B", "A", "fill_blank") == 0.0

    def test_fill_blank_chinese_exact_match_scores_one(self):
        assert _score_answer("良好", "良好", "fill_blank") == 1.0

    def test_fill_blank_chinese_mismatch_scores_zero(self):
        assert _score_answer("努力", "良好", "fill_blank") == 0.0

    def test_multiple_choice_case_insensitive_match(self):
        """MC is case-insensitive: 'a' vs 'A' → 1.0."""
        assert _score_answer("a", "A", "multiple_choice") == 1.0

    def test_multiple_choice_uppercase_match(self):
        assert _score_answer("A", "A", "multiple_choice") == 1.0

    def test_multiple_choice_mismatch_scores_zero(self):
        assert _score_answer("B", "A", "multiple_choice") == 0.0

    def test_empty_against_any_correct_scores_zero(self):
        """Empty student answer always scores 0.0 regardless of question type."""
        for qtype in ("fill_blank", "multiple_choice"):
            assert _score_answer("", "A", qtype) == 0.0, (
                f"Empty student answer for {qtype} must score 0.0"
            )


# ---------------------------------------------------------------------------
# 4. Schema: every lettered/MC question has a non-empty `allowed_values` cage
# ---------------------------------------------------------------------------


class TestSchemaAlwaysCaged:
    """Rule 2: allowed_values must never be removed from the question schema.

    For every G6/G7 lesson, every question with mode='lettered' or
    type='multiple_choice' must have a non-empty allowed_values list.

    Known exceptions (free_form lessons without vocabulary — different lesson type):
    - G7-L28: 15 fill_in_blank free_form questions with no vocabulary
    - G7-L30: 1 fill_in_blank free_form question with no vocabulary
    These are data gaps in the YAML (not grader bugs) and are documented in
    specs/modules/omo-determinism/INTENT.md §3.
    """

    @pytest.fixture(scope="class")
    def g67_lessons(self):
        """Load all G6/G7 parsed lesson YAMLs."""
        pattern = str(LESSON_DIR / "G[67]-L*.yml")
        files = sorted(glob.glob(pattern))
        assert files, f"No G6/G7 lesson YAMLs found at {LESSON_DIR}"
        lessons = []
        for f in files:
            with open(f) as fh:
                lessons.append((Path(f).name, yaml.safe_load(fh)))
        return lessons

    def test_all_g67_lessons_loaded(self, g67_lessons):
        """Sanity: we must find at least 50 G6/G7 lessons."""
        assert len(g67_lessons) >= 50, (
            f"Expected >= 50 G6/G7 lessons, got {len(g67_lessons)}"
        )

    def test_lettered_questions_all_have_allowed_values(self, g67_lessons):
        """Every lettered-mode question in G6/G7 has a non-empty allowed_values.

        401 lettered/MC questions verified as of 2026-06-01.
        """
        violations = []
        for fname, lesson in g67_lessons:
            questions = _build_question_schema(lesson)
            for q in questions:
                is_lettered_or_mc = (
                    q.get("mode") == "lettered"
                    or q.get("type") == "multiple_choice"
                )
                if is_lettered_or_mc and not q.get("allowed_values"):
                    violations.append(
                        f"{fname} qid={q['id']} mode={q.get('mode')} type={q.get('type')}"
                    )
        assert not violations, (
            "These lettered/MC questions are missing allowed_values (cage removed?):\n"
            + "\n".join(violations)
        )

    def test_lettered_question_count_is_substantial(self, g67_lessons):
        """Sanity: at least 200 lettered/MC questions exist across G6/G7 lessons.

        If this number drops dramatically, schema extraction may be broken.
        """
        total = 0
        for _fname, lesson in g67_lessons:
            questions = _build_question_schema(lesson)
            for q in questions:
                if q.get("mode") == "lettered" or q.get("type") == "multiple_choice":
                    total += 1
        assert total >= 200, (
            f"Expected >= 200 lettered/MC questions, got {total}. "
            "Schema extraction may have regressed."
        )

    def test_known_free_form_exceptions_documented(self, g67_lessons):
        """Document the 2 known free_form exceptions without failing.

        G7-L28 and G7-L30 have fill_in_blank questions with no vocabulary.
        Their allowed_values is [] (empty), which is a YAML data gap — not a
        grader bug.  This test ensures we know exactly which lessons are
        exceptional and that the count does not grow silently.
        """
        exceptions = []
        for fname, lesson in g67_lessons:
            questions = _build_question_schema(lesson)
            for q in questions:
                if (
                    q.get("mode") == "free_form"
                    and q.get("type") == "fill_blank"
                    and not q.get("allowed_values")
                ):
                    exceptions.append(fname)

        unique_exception_lessons = sorted(set(exceptions))
        # Exactly 2 known lessons are exceptional.
        # If this number grows, a new lesson was added without vocabulary —
        # that should be noticed and documented.
        assert len(unique_exception_lessons) <= 2, (
            f"More than 2 lessons now have free_form fill_blank with empty allowed_values.\n"
            f"New exceptions: {unique_exception_lessons}\n"
            "Add them to INTENT.md §3 and review whether they need vocab added."
        )


# ---------------------------------------------------------------------------
# 5. Low-confidence threshold sanity
# ---------------------------------------------------------------------------


class TestLowConfidenceThreshold:
    """Rule 4: _LOW_CONFIDENCE_THRESHOLD must be a positive, sensible value.

    The threshold itself is used in omo_grader.py (not pure-Python functions),
    so we only test the constant here — not the full LLM path.
    """

    def test_threshold_is_between_zero_and_one_exclusive(self):
        assert 0.0 < _LOW_CONFIDENCE_THRESHOLD < 1.0, (
            f"_LOW_CONFIDENCE_THRESHOLD must be (0, 1), got {_LOW_CONFIDENCE_THRESHOLD}"
        )

    def test_threshold_is_not_trivially_zero(self):
        """If threshold were 0, low-confidence guard would never fire."""
        assert _LOW_CONFIDENCE_THRESHOLD > 0.0

    def test_threshold_value_is_0_7(self):
        """Threshold is 0.7 as designed in issue #1715.

        Change requires explicit approval — this test prevents silent drift.
        """
        assert _LOW_CONFIDENCE_THRESHOLD == 0.7, (
            f"Threshold changed from 0.7 to {_LOW_CONFIDENCE_THRESHOLD}. "
            "Update INTENT.md §2 Rule 4 and this test if intentional."
        )
