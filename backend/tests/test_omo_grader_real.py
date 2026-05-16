"""Tests for omo_grader — prevents regression of Issue #1614 (100% false-positive).

Ground truth from private/omo-real-samples/2026-05-14/test-report.md:

L24「昆蟲會思考嗎？」PDF #1:
  Multiple-choice (page 21):
    mc_1: student circled A, correct=C  → score=0.0
    mc_2: student circled B, correct=None → score=0.0
    mc_3: student circled A, correct=D  → score=0.0
    mc_4: student circled A, correct=B  → score=0.0
    mc_5: student circled C, correct=B  → score=0.0  (only q5 student=C, correct=B: wrong)
  Fill-in-blank (page 18, red-pen corrections):
    fb_1 「尋找食物」: student wrote 寛食 (wrong radical), red-pen corrected → score=0.0
    fb_9 「現況的變化」: student answer crossed out → score=0.0
    fb_10「雷聲突然響起」: red ✗ mark → score=0.0

Strategy:
  All tests use mock Gemini responses (no real API calls, no quota usage).
  @pytest.mark.real tests exist for manual local verification with real images.
"""

import asyncio
import json
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_LESSON = {
    "title": "昆蟲會思考嗎？",
    "vocabulary": [
        {"word": "奠定"},
        {"word": "覓食"},
        {"word": "迅雷不及掩耳"},
        {"word": "臨機應變"},
        {"word": "注目"},
    ],
    "fill_in_blank": [
        {"answer": "B", "sentence": "尋找食物的本能"},           # fb_1 → 覓食
        {"answer": "A", "sentence": "基礎穩固"},                  # fb_2 → 奠定
        {"answer": "E", "sentence": "引人注意"},                  # fb_3 → 注目
        {"answer": "D", "sentence": "靈活應對"},                  # fb_4 → 臨機應變
        {"answer": "C", "sentence": "行動迅速"},                  # fb_5 → 迅雷不及掩耳
        {"answer": "A", "sentence": ""},
        {"answer": "B", "sentence": ""},
        {"answer": "C", "sentence": ""},
        {"answer": "D", "sentence": "現況的變化"},                # fb_9 → 臨機應變
        {"answer": "C", "sentence": "雷聲突然響起"},              # fb_10 → 迅雷不及掩耳
    ],
    "multiple_choice": [
        {"answer": "C", "question": "q1"},
        {"answer": "",  "question": "q2"},
        {"answer": "D", "question": "q3"},
        {"answer": "B", "question": "q4"},
        {"answer": "B", "question": "q5"},
    ],
}


def _make_mock_response(items: list[dict]) -> MagicMock:
    """Create a mock Gemini response with the given graded items."""
    mock_resp = MagicMock()
    mock_resp.text = json.dumps(items)
    return mock_resp


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Unit tests — prompt structure (no API calls)
# ---------------------------------------------------------------------------

class TestBuildGradingPrompt:
    """Verify the new prompt design does not leak expected answers inline."""

    def setup_method(self):
        from app.services.omo_grader import _build_question_schema, _build_grading_prompt
        self.questions = _build_question_schema(SAMPLE_LESSON)
        self.prompt = _build_grading_prompt(self.questions)

    def test_prompt_contains_handwriting_only_instruction(self):
        assert "禁止把標準答案複製到 student_answer" in self.prompt, (
            "Prompt must explicitly forbid copying expected answer into student_answer"
        )

    def test_expected_answers_not_inline(self):
        """Each QUESTION line must NOT contain the correct_answer inline.

        Old pattern:  '| Expected answer: 覓食'
        New pattern:  correct answers only appear in the reference block at the bottom.

        We identify question lines as those between the "待批改題目" header and the
        "標準答案參考" header — the reference block is a separate section.
        """
        lines = self.prompt.split("\n")
        # Find the section boundaries
        in_questions_section = False
        question_lines = []
        for line in lines:
            if "待批改題目" in line:
                in_questions_section = True
                continue
            if "標準答案參考" in line:
                in_questions_section = False
                continue
            if in_questions_section and line.strip():
                question_lines.append(line)

        assert len(question_lines) > 0, "Should find question lines in 待批改題目 section"
        for line in question_lines:
            assert "Expected answer:" not in line, (
                f"Question line still contains 'Expected answer:': {line!r}"
            )
            assert "標準答案：" not in line, (
                f"Question line still contains inline correct answer: {line!r}"
            )

    def test_reference_block_present(self):
        assert "標準答案參考" in self.prompt, (
            "Prompt must have a separate reference block for correct answers"
        )

    def test_red_pen_instruction_present(self):
        assert "紅筆" in self.prompt, (
            "Prompt must instruct Gemini how to handle red-pen correction marks"
        )

    def test_mc_instruction_present(self):
        assert "圈選" in self.prompt or "選項字母" in self.prompt, (
            "Prompt must tell Gemini to report which letter the student CIRCLED"
        )

    def test_blank_answer_instruction(self):
        assert "空白" in self.prompt, (
            "Prompt must handle blank answer slots (student_answer='', score=0.0)"
        )


# ---------------------------------------------------------------------------
# Unit tests — parsing logic with mock Gemini responses
# ---------------------------------------------------------------------------

class TestParsingWithMockResponses:
    """Verify that the grader correctly parses Gemini responses representing
    real student errors — no false-positive inflating to score=1.0."""

    def _patch_and_run(self, mock_items: list[dict]) -> list:
        """Patch Gemini and run grade_worksheet_images with a dummy image."""
        import app.services.omo_grader as grader_mod

        # Reset circuit breaker
        grader_mod._consecutive_errors = 0

        mock_response = _make_mock_response(mock_items)

        # Build a minimal fake genai module
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

        class FakeClient:
            def __init__(self, **kwargs): pass
            class models:
                @staticmethod
                def generate_content(**kwargs):
                    return mock_response

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
                lesson=SAMPLE_LESSON,
                attempt_id=None,
            ))

    def test_mc_all_wrong_student_answers_score_zero(self):
        """Ground truth: 5 MC questions, student answered A/B/A/A/C, all wrong.
        Gemini correctly reads handwriting and returns student answers ≠ correct answers."""
        mock_items = [
            {"question_id": "mc_1", "student_answer": "A", "correct_answer": "C",    "score": 0.0, "ai_confidence": 0.9, "reasoning": "學生圈了A"},
            {"question_id": "mc_2", "student_answer": "B", "correct_answer": "",     "score": 0.0, "ai_confidence": 0.9, "reasoning": "學生圈了B"},
            {"question_id": "mc_3", "student_answer": "A", "correct_answer": "D",    "score": 0.0, "ai_confidence": 0.9, "reasoning": "學生圈了A"},
            {"question_id": "mc_4", "student_answer": "A", "correct_answer": "B",    "score": 0.0, "ai_confidence": 0.8, "reasoning": "學生圈了A"},
            {"question_id": "mc_5", "student_answer": "C", "correct_answer": "B",    "score": 0.0, "ai_confidence": 0.85, "reasoning": "學生圈了C"},
        ]
        results = self._patch_and_run(mock_items)
        assert len(results) > 0, "Should return graded results"
        mc_results = [r for r in results if r.question_id.startswith("mc_")]
        for r in mc_results:
            assert r.score == 0.0, (
                f"Question {r.question_id}: student_answer={r.student_answer!r} "
                f"vs correct={r.correct_answer!r} — expected score=0.0 got {r.score}"
            )

    def test_fill_blank_red_pen_corrected_score_zero(self):
        """Ground truth: fb_1 student wrote 寛食 (wrong radical), red-pen corrected.
        Gemini reads original handwriting, sees red-pen, returns score=0.0."""
        mock_items = [
            {"question_id": "fb_1", "student_answer": "寛食", "correct_answer": "覓食",
             "score": 0.0, "ai_confidence": 0.75, "reasoning": "學生寫寛食，紅筆已訂正"},
        ]
        results = self._patch_and_run(mock_items)
        fb1 = next((r for r in results if r.question_id == "fb_1"), None)
        assert fb1 is not None
        assert fb1.score == 0.0, f"Red-pen corrected answer must score 0.0, got {fb1.score}"
        assert fb1.student_answer == "寛食", f"Must capture original handwriting, got {fb1.student_answer!r}"

    def test_no_safety_override_inflates_score(self):
        """Verify removed Safety override: student_answer == correct_answer does NOT
        force score=1.0 when Gemini returns score=0.0 (e.g. Gemini correctly reports
        exact text but low confidence / zero score due to red-pen mark)."""
        mock_items = [
            # Simulate old bug scenario: Gemini returns correct_answer in student_answer
            # but score=0 — old code would inflate this to 1.0
            {"question_id": "mc_1", "student_answer": "C", "correct_answer": "C",
             "score": 0.0, "ai_confidence": 0.1, "reasoning": "老師紅筆訂正為C，學生原答未知"},
        ]
        results = self._patch_and_run(mock_items)
        mc1 = next((r for r in results if r.question_id == "mc_1"), None)
        assert mc1 is not None
        assert mc1.score == 0.0, (
            f"Safety override must NOT inflate score when Gemini returns 0.0. Got {mc1.score}. "
            "This was the root cause of Issue #1614 — student_answer==correct_answer was "
            "being auto-promoted to 1.0 even when Gemini had copied the expected answer."
        )

    def test_blank_answer_stays_zero(self):
        """Student left a fill-blank empty — should remain score=0.0."""
        mock_items = [
            {"question_id": "fb_9", "student_answer": "", "correct_answer": "臨機應變",
             "score": 0.0, "ai_confidence": 0.0, "reasoning": "答案欄空白"},
        ]
        results = self._patch_and_run(mock_items)
        fb9 = next((r for r in results if r.question_id == "fb_9"), None)
        assert fb9 is not None
        assert fb9.score == 0.0
        assert fb9.student_answer == ""

    def test_correct_answer_scores_one(self):
        """Student actually got the right answer — should score=1.0."""
        mock_items = [
            {"question_id": "mc_5", "student_answer": "B", "correct_answer": "B",
             "score": 1.0, "ai_confidence": 0.95, "reasoning": "學生圈了B，正確"},
        ]
        results = self._patch_and_run(mock_items)
        mc5 = next((r for r in results if r.question_id == "mc_5"), None)
        assert mc5 is not None
        assert mc5.score == 1.0

    def test_reasoning_field_present_in_all_results(self):
        """Every result must have a non-empty reasoning field (llm-endpoint-hardening rule)."""
        mock_items = [
            {"question_id": "mc_1", "student_answer": "A", "correct_answer": "C",
             "score": 0.0, "ai_confidence": 0.9, "reasoning": "學生圈了A，錯誤"},
            {"question_id": "fb_1", "student_answer": "寛食", "correct_answer": "覓食",
             "score": 0.0, "ai_confidence": 0.75, "reasoning": "字跡為寛食，部首錯誤"},
        ]
        results = self._patch_and_run(mock_items)
        for r in results:
            assert r.reasoning, f"question_id={r.question_id} has empty reasoning"


# ---------------------------------------------------------------------------
# Question schema tests
# ---------------------------------------------------------------------------

class TestBuildQuestionSchema:
    def test_vocabulary_letter_resolution(self):
        """fill_in_blank answer 'B' should resolve to vocabulary[1].word = '覓食'."""
        from app.services.omo_grader import _build_question_schema
        questions = _build_question_schema(SAMPLE_LESSON)
        fb_questions = [q for q in questions if q["type"] == "fill_blank"]
        assert fb_questions[0]["correct_answer"] == "覓食", (
            f"fb_1 answer 'B' should resolve to vocabulary[1]='覓食', got {fb_questions[0]['correct_answer']!r}"
        )

    def test_mc_questions_extracted(self):
        from app.services.omo_grader import _build_question_schema
        questions = _build_question_schema(SAMPLE_LESSON)
        mc_questions = [q for q in questions if q["type"] == "multiple_choice"]
        assert len(mc_questions) == 5
        assert mc_questions[0]["correct_answer"] == "C"
        assert mc_questions[2]["correct_answer"] == "D"

    def test_total_question_count(self):
        from app.services.omo_grader import _build_question_schema
        questions = _build_question_schema(SAMPLE_LESSON)
        assert len(questions) == 15  # 10 fill_blank + 5 MC


# ---------------------------------------------------------------------------
# Real image test (skipped by default, run with: pytest -m real)
# ---------------------------------------------------------------------------

@pytest.mark.real
class TestRealImages:
    """Manual verification with actual student images (requires Vertex AI ADC).

    Run: pytest backend/tests/test_omo_grader_real.py -m real -v

    Expected results based on ground truth (test-report.md):
    - mc_1 through mc_5: all score=0.0 (student answered A/B/A/A/C, all wrong)
    - fb_1: score=0.0 (寛食 with red-pen correction)
    - fb_9: score=0.0 (red-pen crossed out)
    - fb_10: score=0.0 (red ✗ mark)
    """

    def test_mc_questions_not_all_perfect(self):
        import os
        img_dir = "private/omo-real-samples/2026-05-14/images"
        # MC questions are on page 5 of PDF1 (135902-p-5.jpg) or nearby
        # Try pages 5-8 which cover the test section
        images = []
        for page in ["5", "6", "7", "8"]:
            path = os.path.join(img_dir, f"135902-p-{page}.jpg")
            if os.path.exists(path):
                with open(path, "rb") as f:
                    images.append((f.read(), "image/jpeg"))

        if not images:
            pytest.skip(f"Real images not found at {img_dir}")

        from app.services.omo_grader import grade_worksheet_images
        import asyncio

        # Load real L24 lesson
        import yaml
        lesson_path = "backend/data/lessons/lesson_24.yaml"
        if not os.path.exists(lesson_path):
            pytest.skip(f"Lesson YAML not found at {lesson_path}")
        with open(lesson_path) as f:
            lesson = yaml.safe_load(f)

        results = asyncio.get_event_loop().run_until_complete(
            grade_worksheet_images(
                image_bytes_list=[img for img, _ in images],
                mime_types=[mime for _, mime in images],
                lesson=lesson,
            )
        )

        mc_results = [r for r in results if r.question_id.startswith("mc_")]
        assert len(mc_results) > 0, "Should find MC questions in the images"

        # Not all should be 1.0 — ground truth says 5 of 5 are wrong
        perfect_scores = [r for r in mc_results if r.score == 1.0]
        assert len(perfect_scores) < len(mc_results), (
            f"REGRESSION: All {len(mc_results)} MC questions returned score=1.0 (100% false-positive). "
            "The grader is still copying expected answers instead of reading handwriting.\n"
            f"Results: {[(r.question_id, r.student_answer, r.correct_answer, r.score) for r in mc_results]}"
        )
