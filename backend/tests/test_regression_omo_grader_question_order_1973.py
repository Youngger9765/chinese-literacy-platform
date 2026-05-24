"""Regression test for #1973 — OMO grader must return answers sorted by YAML
question order (fb_1, fb_2, …, mc_1, mc_2, …), not by Gemini's visual-scan order.

Before the fix, ``grade_worksheet_images`` returned ``results`` in the order
Gemini emitted them — which after ``_split_spread`` could jump arbitrarily
(right-half scanned first, etc.) and confused students cross-checking against
their paper worksheet.

The fix sorts ``results`` by each question's position in the ``questions``
list built by ``_build_question_schema`` (YAML order).
"""

import asyncio
import json
import sys
import types
from unittest.mock import MagicMock, patch

import pytest


# Lesson with 5 fb_* and 3 mc_* — enough to make a wrong order obvious.
LESSON = {
    "title": "L25-測試課",
    "vocabulary": [
        {"word": "奠定"},   # A
        {"word": "覓食"},   # B
        {"word": "迅雷不及掩耳"},  # C
        {"word": "臨機應變"},      # D
        {"word": "注目"},   # E
        {"word": "規律"},   # F
        {"word": "勇氣"},   # G
    ],
    "fill_in_blank": [
        {"answer": "A", "sentence": "打下基礎"},   # fb_1
        {"answer": "B", "sentence": "找尋食物"},   # fb_2
        {"answer": "C", "sentence": "行動迅速"},   # fb_3
        {"answer": "F", "sentence": "有規律"},      # fb_4
        {"answer": "G", "sentence": "需要勇氣"},   # fb_5
    ],
    "multiple_choice": [
        {"answer": "A", "question": "q1"},   # mc_1
        {"answer": "B", "question": "q2"},   # mc_2
        {"answer": "C", "question": "q3"},   # mc_3
    ],
}


def _make_mock_response(items: list[dict]) -> MagicMock:
    mock_resp = MagicMock()
    mock_resp.text = json.dumps(items)
    return mock_resp


def _run(coro):
    # Python 3.10+: get_event_loop() is deprecated when no running loop exists.
    return asyncio.run(coro)


def _patch_and_grade(mock_items: list[dict]) -> list:
    """Patch the google.genai module and run grade_worksheet_images."""
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
            lesson=LESSON,
            attempt_id=None,
        ))


def test_results_sorted_by_yaml_order_when_gemini_returns_scrambled():
    """Gemini returns answers in arbitrary visual-scan order — grader must
    sort them back to YAML order (fb_1..fb_5, mc_1..mc_3)."""
    # Deliberately scrambled — mc before fb, fb not in numeric order.
    scrambled = [
        {"question_id": "mc_2", "student_answer": "B", "ai_confidence": 0.9, "reasoning": "圈B"},
        {"question_id": "fb_3", "student_answer": "C", "ai_confidence": 0.9, "reasoning": "圈C"},
        {"question_id": "fb_1", "student_answer": "A", "ai_confidence": 0.9, "reasoning": "圈A"},
        {"question_id": "mc_1", "student_answer": "A", "ai_confidence": 0.9, "reasoning": "圈A"},
        {"question_id": "fb_5", "student_answer": "G", "ai_confidence": 0.9, "reasoning": "圈G"},
        {"question_id": "fb_2", "student_answer": "B", "ai_confidence": 0.9, "reasoning": "圈B"},
        {"question_id": "mc_3", "student_answer": "C", "ai_confidence": 0.9, "reasoning": "圈C"},
        {"question_id": "fb_4", "student_answer": "F", "ai_confidence": 0.9, "reasoning": "圈F"},
    ]
    results = _patch_and_grade(scrambled)
    actual_order = [r.question_id for r in results]
    expected_order = ["fb_1", "fb_2", "fb_3", "fb_4", "fb_5", "mc_1", "mc_2", "mc_3"]
    assert actual_order == expected_order, (
        f"Expected YAML order {expected_order}, got {actual_order}"
    )


def test_results_already_sorted_remain_sorted():
    """Idempotency: when Gemini already returns YAML order, the sort doesn't
    disturb it."""
    in_order = [
        {"question_id": "fb_1", "student_answer": "A", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "fb_2", "student_answer": "B", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "fb_3", "student_answer": "C", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "fb_4", "student_answer": "F", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "fb_5", "student_answer": "G", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "mc_1", "student_answer": "A", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "mc_2", "student_answer": "B", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "mc_3", "student_answer": "C", "ai_confidence": 0.9, "reasoning": ""},
    ]
    results = _patch_and_grade(in_order)
    actual_order = [r.question_id for r in results]
    expected_order = ["fb_1", "fb_2", "fb_3", "fb_4", "fb_5", "mc_1", "mc_2", "mc_3"]
    assert actual_order == expected_order


def test_results_with_missing_questions_keep_yaml_order_for_present():
    """When Gemini only returns some questions (e.g. couldn't read fb_3, fb_5),
    the remaining present ones still come out in YAML order."""
    partial = [
        {"question_id": "mc_3", "student_answer": "C", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "fb_2", "student_answer": "B", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "fb_1", "student_answer": "A", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "mc_1", "student_answer": "A", "ai_confidence": 0.9, "reasoning": ""},
    ]
    results = _patch_and_grade(partial)
    actual_order = [r.question_id for r in results]
    expected_order = ["fb_1", "fb_2", "mc_1", "mc_3"]
    assert actual_order == expected_order, (
        f"Expected YAML order {expected_order} for present questions, got {actual_order}"
    )


# Lesson with all three question types — fb_*, mc_*, se_* — to verify the
# sort handles the full schema produced by _build_question_schema (#1879).
LESSON_WITH_SE = {
    "title": "L24-含策略練習",
    "vocabulary": [
        {"word": "觀察"},
        {"word": "記錄"},
    ],
    "fill_in_blank": [
        {"answer": "觀察", "sentence": "仔細觀察"},   # fb_1 (free_form)
        {"answer": "記錄", "sentence": "詳細記錄"},   # fb_2 (free_form)
    ],
    "multiple_choice": [
        {"answer": "A", "question": "q1"},   # mc_1
        {"answer": "B", "question": "q2"},   # mc_2
    ],
    "strategy_exercise": {
        "items": [
            {"id": "se_1", "stem": "第一題策略", "answer": "策略A"},
            {"id": "se_2", "stem": "第二題策略", "answer": "策略B"},
        ],
    },
}


def _patch_and_grade_lesson(mock_items: list[dict], lesson: dict) -> list:
    """Same as _patch_and_grade but with a custom lesson fixture."""
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
            lesson=lesson,
            attempt_id=None,
        ))


def test_results_sorted_across_fb_mc_se_question_types():
    """Sort must handle the full schema (fb_* → mc_* → se_*) — strategy_exercise
    is appended after MC in _build_question_schema, so sort key must respect
    that even though the IDs aren't lexicographically ordered.

    Note: se_* answers use empty student_answer to avoid the anti-fabrication
    coercion (se_* doesn't expose allowed_values), but the result is still
    appended to `results` so the ordering is still observable.
    """
    scrambled = [
        {"question_id": "se_2", "student_answer": "", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "mc_1", "student_answer": "A", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "fb_2", "student_answer": "記錄", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "se_1", "student_answer": "", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "fb_1", "student_answer": "觀察", "ai_confidence": 0.9, "reasoning": ""},
        {"question_id": "mc_2", "student_answer": "B", "ai_confidence": 0.9, "reasoning": ""},
    ]
    results = _patch_and_grade_lesson(scrambled, LESSON_WITH_SE)
    actual_order = [r.question_id for r in results]
    expected_order = ["fb_1", "fb_2", "mc_1", "mc_2", "se_1", "se_2"]
    assert actual_order == expected_order, (
        f"Expected YAML order across fb/mc/se {expected_order}, got {actual_order}"
    )
