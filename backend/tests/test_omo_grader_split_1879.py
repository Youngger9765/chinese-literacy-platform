"""TDD tests for #1879 — omo_grader.py split.

Phase 1 (Red → Green):
  Write tests that pin the THREE specific behaviours listed in the issue.
  They MUST pass on the CURRENT monolithic omo_grader.py.

Phase 2 (Refactor):
  Extract omo_question_schema.py / omo_scoring.py / omo_image_preprocess.py /
  omo_crop_upload.py.  The same three tests (plus any extras) must still pass.

Tautology check: each test has a negative assertion or uses a strictly-
constrained expected value, so a trivially-passing stub would fail.

Run:
    cd backend && python -m pytest tests/test_omo_grader_split_1879.py -v
"""

import pytest


# ---------------------------------------------------------------------------
# Fixtures: lesson data reflecting the L22-L30 lettered fill_in_blank pattern
# ---------------------------------------------------------------------------

LETTERED_LESSON = {
    "title": "L22-測試課",
    "vocabulary": [
        {"word": "奠定"},   # A → idx 0
        {"word": "覓食"},   # B → idx 1
        {"word": "迅雷不及掩耳"},  # C → idx 2
        {"word": "臨機應變"},      # D → idx 3
        {"word": "注目"},   # E → idx 4
        {"word": "規律"},   # F → idx 5
        {"word": "勇氣"},   # G → idx 6
    ],
    "fill_in_blank": [
        {"answer": "A", "sentence": "打下基礎"},   # fb_1 → lettered A
        {"answer": "C", "sentence": "行動迅速"},   # fb_2 → lettered C
        {"answer": "F", "sentence": "有規律"},      # fb_3 → lettered F
        {"answer": "G", "sentence": "需要勇氣"},   # fb_4 → lettered G
        {"answer": "B", "sentence": "找尋食物"},   # fb_5 → lettered B
    ],
}

FREE_FORM_LESSON = {
    "title": "free-form-test",
    "vocabulary": [
        {"word": "觀察"},
        {"word": "記錄"},
        {"word": "歸納"},
    ],
    "fill_in_blank": [
        {"answer": "觀察", "sentence": "仔細觀察"},
        {"answer": "記錄", "sentence": "詳細記錄"},
    ],
}


# ---------------------------------------------------------------------------
# Test 1: question_schema_lettered_fill_blank_uses_vocab_letters_and_word_display
#
# The issue spec: L22-L30 YAML uses letter (A=0, B=1, ...) as placeholder for
# vocabulary list index.  _build_question_schema must:
#   (a) produce mode="lettered" when all fb answers are single A-G letters
#   (b) set correct_answer = the LETTER (not the word) for scoring
#   (c) set correct_word = the resolved vocabulary word for display
#   (d) set allowed_values = the full set of letters up to min(len(vocab), 7)
# ---------------------------------------------------------------------------

class TestQuestionSchemaLetteredFillBlank:
    def setup_method(self):
        from app.services.omo_grader import _build_question_schema
        self.questions = _build_question_schema(LETTERED_LESSON)
        self.fb_qs = [q for q in self.questions if q["type"] == "fill_blank"]

    def test_lettered_mode_detected(self):
        """All fill_in_blank answers are A-G → mode must be 'lettered'."""
        for q in self.fb_qs:
            assert q["mode"] == "lettered", (
                f"Expected mode='lettered', got {q['mode']!r} for question {q['id']}"
            )

    def test_correct_answer_is_letter_not_word(self):
        """correct_answer for scoring must be the LETTER, not the resolved word.

        Tautology: if this were a no-op returning the word, 'A' != '奠定' would fail.
        """
        # fb_1 answer='A' → correct_answer must be 'A' (for letter-vs-letter scoring)
        fb1 = next(q for q in self.fb_qs if q["id"] in ("fb_1", "0"))
        assert fb1["correct_answer"] == "A", (
            f"Lettered fb correct_answer must be the letter 'A', got {fb1['correct_answer']!r}"
        )

    def test_correct_word_resolves_vocabulary(self):
        """correct_word must resolve A→vocabulary[0].word='奠定'.

        Tautology: if resolution were skipped, 'A' != '奠定' fails.
        """
        fb1 = next(q for q in self.fb_qs if q["id"] in ("fb_1", "0"))
        assert fb1["correct_word"] == "奠定", (
            f"Lettered fb correct_word must resolve A→'奠定', got {fb1['correct_word']!r}"
        )

    def test_allowed_values_contains_letters_up_to_vocab_count(self):
        """allowed_values must be ['A','B','C','D','E','F','G'] (7 vocab words, capped at 7).

        Tautology: empty list or word list would both fail.
        """
        fb1 = next(q for q in self.fb_qs if q["id"] in ("fb_1", "0"))
        expected = ["A", "B", "C", "D", "E", "F", "G"]
        assert fb1["allowed_values"] == expected, (
            f"allowed_values must be {expected}, got {fb1['allowed_values']!r}"
        )

    def test_word_display_mapping_for_all_letters(self):
        """Every letter maps to the correct vocabulary word by index."""
        expected_mapping = {
            "A": "奠定",
            "B": "覓食",
            "C": "迅雷不及掩耳",
            "D": "臨機應變",
            "E": "注目",
            "F": "規律",
            "G": "勇氣",
        }
        for q in self.fb_qs:
            letter = q["correct_answer"]   # should be A-G
            assert letter in expected_mapping, f"Unexpected letter {letter!r}"
            assert q["correct_word"] == expected_mapping[letter], (
                f"Letter {letter}: expected word {expected_mapping[letter]!r}, "
                f"got {q['correct_word']!r}"
            )


# ---------------------------------------------------------------------------
# Test 2: validate_student_answer_coerces_fabricated_values_to_empty
#
# The issue spec: illegal AI answers (not in allowed_values) must fail-closed
# → student_answer coerced to "", was_fabricated=True.
# Tautology: accepts "" trivially passing is prevented by checking was_fabricated.
# ---------------------------------------------------------------------------

class TestValidateStudentAnswerCoercesFabricated:
    def setup_method(self):
        from app.services.omo_grader import _validate_student_answer
        self.validate = _validate_student_answer

    def _lettered_question(self, allowed=None):
        return {
            "mode": "lettered",
            "allowed_values": allowed or ["A", "B", "C", "D", "E", "F", "G"],
        }

    def _free_form_question(self, allowed=None):
        return {
            "mode": "free_form",
            "allowed_values": allowed or ["觀察", "記錄", "歸納"],
        }

    def test_fabricated_word_for_lettered_question_coerced(self):
        """AI returns a word ('良好') for a lettered question → must coerce to ''.

        Tautology: was_fabricated must be True — a stub that always returns ('', False)
        would fail this assertion.
        """
        answer, was_fabricated = self.validate("良好", self._lettered_question())
        assert answer == "", f"Fabricated answer should be coerced to '', got {answer!r}"
        assert was_fabricated is True, "was_fabricated must be True for fabricated answer"

    def test_fabricated_chinese_word_for_lettered_question_coerced(self):
        """AI returns '奠定' (the resolved word) instead of the letter → coerce."""
        answer, was_fabricated = self.validate("奠定", self._lettered_question())
        assert answer == ""
        assert was_fabricated is True

    def test_valid_letter_accepted(self):
        """Valid letter 'C' in allowed list → accepted, not fabricated."""
        answer, was_fabricated = self.validate("C", self._lettered_question())
        assert answer == "C"
        assert was_fabricated is False

    def test_lowercase_letter_normalised_to_uppercase(self):
        """Letter 'c' (lowercase) → accepted and normalised to 'C'."""
        answer, was_fabricated = self.validate("c", self._lettered_question())
        assert answer == "C"
        assert was_fabricated is False

    def test_fabricated_word_not_in_free_form_allowed_values_coerced(self):
        """Free-form: word not in allowed list → coerced to '', was_fabricated=True."""
        answer, was_fabricated = self.validate("發現", self._free_form_question())
        assert answer == ""
        assert was_fabricated is True

    def test_valid_free_form_word_accepted(self):
        """Free-form: word in allowed list → accepted as-is."""
        answer, was_fabricated = self.validate("觀察", self._free_form_question())
        assert answer == "觀察"
        assert was_fabricated is False

    def test_empty_string_is_valid_not_fabricated(self):
        """Empty student answer (student left blank) → ('', False) — not fabricated."""
        answer, was_fabricated = self.validate("", self._lettered_question())
        assert answer == ""
        assert was_fabricated is False

    def test_multi_character_lettered_fabrication(self):
        """Lettered mode: multi-char string 'AB' is not a valid single letter → coerce."""
        answer, was_fabricated = self.validate("AB", self._lettered_question())
        assert answer == ""
        assert was_fabricated is True


# ---------------------------------------------------------------------------
# Test 3: low_confidence_non_empty_answer_is_blank_for_teacher_review
#
# The issue spec: when Gemini self-reports confidence < 0.7 AND student_answer
# is non-empty, the grader must:
#   (a) coerce student_answer to ""
#   (b) prepend "[low-confidence]" to reasoning
#   (c) preserve the original score=0.0 (empty → score never inflated)
#
# This is tested by injecting a mock Gemini response with low ai_confidence.
# ---------------------------------------------------------------------------

import asyncio
import json
import sys
import types
from unittest.mock import MagicMock, patch


def _make_mock_response(items: list[dict]) -> MagicMock:
    mock = MagicMock()
    mock.text = json.dumps(items)
    return mock


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _patch_and_grade(lesson: dict, mock_items: list[dict]) -> list:
    """Patch Gemini client and run grade_worksheet_images."""
    import app.services.omo_grader as grader_mod
    grader_mod._consecutive_errors = 0

    mock_response = _make_mock_response(mock_items)

    fake_genai = types.ModuleType("google.genai")
    fake_types = types.ModuleType("google.genai.types")

    class FakeContent:
        def __init__(self, **kwargs): pass

    class FakePart:
        @staticmethod
        def from_bytes(**kwargs): return FakePart()

    class FakeThinkingConfig:
        def __init__(self, **kwargs): pass

    class FakeAutoFuncCallingConfig:
        def __init__(self, **kwargs): pass

    class FakeGenerateContentConfig:
        def __init__(self, **kwargs): pass

    class FakeModels:
        @staticmethod
        def generate_content(**kwargs):
            return mock_response

    class FakeClient:
        def __init__(self, **kwargs):
            self.models = FakeModels()

    fake_types.Content = FakeContent
    fake_types.Part = FakePart
    fake_types.ThinkingConfig = FakeThinkingConfig
    fake_types.AutomaticFunctionCallingConfig = FakeAutoFuncCallingConfig
    fake_types.GenerateContentConfig = FakeGenerateContentConfig
    fake_genai.Client = FakeClient

    fake_google = types.ModuleType("google")
    fake_google.genai = fake_genai

    with patch.dict(sys.modules, {
        "google": fake_google,
        "google.genai": fake_genai,
        "google.genai.types": fake_types,
    }):
        return _run(grader_mod.grade_worksheet_images(
            image_bytes_list=[b"fake_image_bytes"],
            mime_types=["image/jpeg"],
            lesson=lesson,
            attempt_id=None,
        ))


class TestLowConfidenceAnswerIsBlankForTeacherReview:
    """Confidence threshold: < 0.7 non-empty answer → coerced to blank."""

    THRESHOLD = 0.7

    def test_low_confidence_non_empty_coerced_to_blank(self):
        """ai_confidence=0.5 with a valid answer → student_answer coerced to ''.

        Tautology: if grader did NOT apply threshold, student_answer would remain
        non-empty and this assertion would fail.
        """
        lesson = {
            "title": "confidence-test",
            "fill_in_blank": [
                {"answer": "觀察", "sentence": "仔細觀察"},
            ],
        }
        mock_items = [{
            "question_id": "fb_1",
            "student_answer": "觀察",    # valid free-form answer
            "ai_confidence": 0.5,         # below threshold
            "reasoning": "字跡模糊",
        }]
        results = _patch_and_grade(lesson, mock_items)
        fb1 = next((r for r in results if r.question_id == "fb_1"), None)
        assert fb1 is not None, "Should produce a result for fb_1"
        assert fb1.student_answer == "", (
            f"Low-confidence answer must be coerced to '', got {fb1.student_answer!r}"
        )
        assert fb1.score == 0.0, (
            f"Coerced answer must score 0.0, got {fb1.score}"
        )

    def test_low_confidence_reasoning_prepends_marker(self):
        """[low-confidence] marker must appear in reasoning for teacher review.

        Uses free-form lesson so anti-fabrication validation passes first
        (answer '記錄' is in vocabulary → allowed_values), then low-confidence
        check fires.
        """
        lesson = {
            "title": "confidence-reasoning-test",
            "vocabulary": [
                {"word": "觀察"},
                {"word": "記錄"},
                {"word": "歸納"},
            ],
            "fill_in_blank": [
                {"answer": "記錄", "sentence": "詳細記錄"},
            ],
        }
        mock_items = [{
            "question_id": "fb_1",
            "student_answer": "記錄",
            "ai_confidence": 0.4,
            "reasoning": "勉強看到",
        }]
        results = _patch_and_grade(lesson, mock_items)
        fb1 = next((r for r in results if r.question_id == "fb_1"), None)
        assert fb1 is not None
        assert "[low-confidence]" in fb1.reasoning, (
            f"reasoning must contain '[low-confidence]' marker, got: {fb1.reasoning!r}"
        )

    def test_high_confidence_answer_not_coerced(self):
        """ai_confidence=0.9 (above threshold) → student_answer preserved.

        Tautology: a stub that always coerces would fail this.
        Uses vocabulary list so anti-fabrication passes and the answer reaches
        the confidence check cleanly.
        """
        lesson = {
            "title": "high-confidence-test",
            "vocabulary": [
                {"word": "觀察"},
                {"word": "記錄"},
                {"word": "歸納"},
            ],
            "fill_in_blank": [
                {"answer": "歸納", "sentence": "加以歸納"},
            ],
        }
        mock_items = [{
            "question_id": "fb_1",
            "student_answer": "歸納",
            "ai_confidence": 0.9,
            "reasoning": "清楚可見",
        }]
        results = _patch_and_grade(lesson, mock_items)
        fb1 = next((r for r in results if r.question_id == "fb_1"), None)
        assert fb1 is not None
        assert fb1.student_answer == "歸納", (
            f"High-confidence answer must NOT be coerced, got {fb1.student_answer!r}"
        )
        assert fb1.score == 1.0, "Correct high-confidence answer must score 1.0"

    def test_exact_threshold_boundary_is_coerced(self):
        """ai_confidence == threshold (0.7) is NOT coerced (threshold is exclusive: < 0.7).

        Spec says 'ai_conf < _LOW_CONFIDENCE_THRESHOLD' — boundary value is accepted.
        Tautology: threshold-on-boundary would flip if implementation used <=.
        Uses vocabulary list so anti-fabrication passes and threshold logic is tested.
        """
        lesson = {
            "title": "boundary-threshold-test",
            "vocabulary": [
                {"word": "觀察"},
                {"word": "記錄"},
                {"word": "歸納"},
            ],
            "fill_in_blank": [
                {"answer": "觀察", "sentence": "仔細觀察"},
            ],
        }
        mock_items = [{
            "question_id": "fb_1",
            "student_answer": "觀察",
            "ai_confidence": 0.7,          # exactly at threshold — should NOT be coerced
            "reasoning": "剛好邊界",
        }]
        results = _patch_and_grade(lesson, mock_items)
        fb1 = next((r for r in results if r.question_id == "fb_1"), None)
        assert fb1 is not None
        # At exact threshold 0.7, the condition is `ai_conf < 0.7` → False → NOT coerced
        assert fb1.student_answer == "觀察", (
            f"Boundary ai_confidence=0.7 must NOT be coerced, got {fb1.student_answer!r}"
        )

    def test_low_confidence_empty_answer_stays_empty_no_marker(self):
        """ai_confidence=0.3 but student_answer='' → already blank, no [low-confidence] marker."""
        lesson = {
            "title": "empty-low-conf-test",
            "fill_in_blank": [
                {"answer": "記錄", "sentence": "詳細記錄"},
            ],
        }
        mock_items = [{
            "question_id": "fb_1",
            "student_answer": "",     # already blank — low-confidence coercion only
            "ai_confidence": 0.3,     # applies when student_answer is non-empty
            "reasoning": "看不見",
        }]
        results = _patch_and_grade(lesson, mock_items)
        fb1 = next((r for r in results if r.question_id == "fb_1"), None)
        assert fb1 is not None
        assert fb1.student_answer == "", "Already-empty answer stays empty"
        # No [low-confidence] marker for already-empty answers
        assert "[low-confidence]" not in fb1.reasoning, (
            "No [low-confidence] marker when answer was already blank"
        )
