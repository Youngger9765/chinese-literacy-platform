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
import re
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
    """防 #1614/#1616 的核心：**prompt 不可以透露哪個答案是對的**。

    ## 2026-08-28 重寫了這個 class，原本六條刪掉五條

    Prompt 在 #1712（#1614/#1616 第三輪）整個重寫過。原本那六條裡：

    - `test_reference_block_present` 斷言 prompt 要有「標準答案參考」區 ——
      **跟現在的設計正好相反**。新設計連正確答案都不送了
      （`_build_grading_prompt` docstring：Reference answers stay HIDDEN per #1616）。
      這條留著等於在要求把答案送回去。
    - 另外四條是「斷言 prompt 裡有某個中文字串」（`紅筆`／`圈選`／`空白`／
      `只報告手寫`）。Prompt 一改寫就紅，**而紅了不代表品質變差、綠了也不代表
      評分是對的** —— 那是 owner 說的「綠燈也是假的」那種。
    - `test_expected_answers_not_inline` 的**意圖**（答案不可洩漏）比以前更重要，
      但它的做法綁死舊格式：靠「待批改題目」「標準答案參考」兩個標頭切區段。
      標頭沒了之後它掛在自己的 `len(question_lines) > 0` 上 ——
      **那個防呆救了它**，否則洩漏斷言會在掃到空集合的情況下無聲通過。

    改成直接問「有沒有標出哪個是對的」，不綁任何格式。
    """

    def setup_method(self):
        from app.services.omo_grader import _build_question_schema, _build_grading_prompt
        self.questions = _build_question_schema(SAMPLE_LESSON)
        self.prompt = _build_grading_prompt(self.questions)

    def test_the_prompt_was_actually_built(self):
        """正向對照 —— 少了它，下面每一條都可能在對空字串斷言。"""
        assert len(self.questions) >= 3, f"只抽出 {len(self.questions)} 題"
        assert len(self.prompt) > 500, f"prompt 只有 {len(self.prompt)} 字"
        assert "合法答案" in self.prompt, "prompt 沒有列出合法值清單，格式可能又變了"

    def test_no_question_is_told_which_value_is_correct(self):
        """⭐ #1614/#1616 的核心。不綁格式 —— 只問有沒有「標出正確」這件事。"""
        seg = self.prompt.split("== 題目清單")[-1]
        offenders = [
            line for line in seg.split("\n")
            if re.search(r"(正確答案|答案是|correct[_ ]answer|Expected answer)", line)
        ]
        assert not offenders, (
            "題目區出現了指出正確答案的字樣，#1614 的洩漏又回來了：\n"
            + "\n".join(offenders[:5]))

    def test_the_value_space_is_a_space_not_a_giveaway(self):
        """合法值清單至少要有兩個真實選項 —— 只列一個就等於直接把答案給它。

        ⚠️ 原本我寫的是「同 mode 的題目要看到同一組值」，那個假設站不住腳：
        選擇題每題本來就有自己的選項，而那些選項**印在學習單上**、學生看得到，
        不是洩漏。真正該守的是「清單不能窄到只剩答案」。
        """
        thin = []
        for q in self.questions:
            vals = [v for v in (q.get("allowed_values") or []) if v != ""]
            if len(vals) < 2:
                thin.append((q["id"], vals))
        assert not thin, (
            f"這幾題的合法值清單窄到只剩一個，等於把答案交出去：{thin}")

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
        # student_answer used to hold the raw handwriting. #1712 coerces anything
        # outside allowed_values to "" so the grader cannot invent an answer, and
        # this worksheet is lettered (A-E), so a written word is out of vocabulary.
        # The handwriting is not lost — it goes into reasoning, where a teacher
        # reviewing the paper can still read it.
        assert fb1.student_answer == "", (
            f"an out-of-vocabulary answer must be coerced to empty (#1712), got {fb1.student_answer!r}"
        )
        assert "寛食" in (fb1.reasoning or ""), (
            f"the original handwriting must survive in reasoning, got {fb1.reasoning!r}"
        )

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
        # This expected the letter to be replaced by the word. #1712 changed that
        # deliberately: when every fill_in_blank answer is a single letter the
        # worksheet has a lettered bank, so the letter IS what the student writes
        # and what the grader must compare against — and allowed_values is what
        # stops the model fabricating something else. 1227 of the 1228
        # fill_in_blank answers in the corpus are single letters.
        #
        # The resolver still exists and still works; it is just not what scoring
        # uses here. Assert both, so neither half can rot unnoticed.
        from app.services.omo_question_schema import _resolve_letter_answer

        assert fb_questions[0]["correct_answer"] == "B", (
            f"lettered worksheet must score on the letter (#1712), got "
            f"{fb_questions[0]['correct_answer']!r}"
        )
        assert fb_questions[0]["allowed_values"] == ["A", "B", "C", "D", "E"]
        assert _resolve_letter_answer("B", SAMPLE_LESSON["vocabulary"], None) == "覓食", (
            "the letter->word resolver is still the mapping used off the scoring path"
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
