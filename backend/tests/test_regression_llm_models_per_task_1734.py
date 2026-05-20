"""Regression tests for per-task LLM model config — Issue #1734 / PR #1735.

Guards against accidental model reassignment in llm_models.py.

Key decisions locked by these tests:
  - omo_grader MUST stay on gemini-2.5-flash @ us-central1 (Issue #1730)
    Reason: lettered-circle spatial reasoning accuracy 5/5 vs 1/5 with flash-lite
  - omo_identifier moved to gemini-flash-lite-latest @ global (Issue #1729)
    Reason: 15/16 accuracy parity with 2.5-flash, faster + cheaper
  - 8 text/JSON generation tasks moved to gemini-2.5-flash-lite @ global (Issue #1744)
    Reason: 3/3 complete quality parity, 29-49% faster, 22-46% cheaper

Run:
    cd backend && python -m pytest tests/test_regression_llm_models_per_task_1734.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from app.services.llm_models import TASK_MODELS, get_model_for_task


class TestTaskModelsRegistry:
    """TASK_MODELS dict must contain all expected tasks with correct assignments."""

    EXPECTED_TASKS = [
        "socratic_question",
        "socratic_agent_process",
        "comprehension_score",
        "sentence_validate",
        "exit_ticket_generate",
        "example_sentences",
        "story_structure",
        "reading_analysis",
        "teacher_comment",
        "omo_identifier",
        "omo_grader",
    ]

    def test_all_expected_tasks_registered(self):
        """TASK_MODELS must contain all 11 expected tasks."""
        for task in self.EXPECTED_TASKS:
            assert task in TASK_MODELS, (
                f"Task {task!r} missing from TASK_MODELS. "
                f"This was added in Issue #1734 and must not be removed."
            )

    def test_task_count_is_at_least_11(self):
        """TASK_MODELS must have at least 11 entries."""
        assert len(TASK_MODELS) >= 11, (
            f"TASK_MODELS has only {len(TASK_MODELS)} entries. "
            f"Expected at least 11 (Issue #1734)."
        )

    def test_each_task_has_model_and_location(self):
        """Every TASK_MODELS entry must be a (model, location) tuple with non-empty strings."""
        for task, value in TASK_MODELS.items():
            assert isinstance(value, tuple), f"Task {task!r}: value must be a tuple, got {type(value)}"
            assert len(value) == 2, f"Task {task!r}: tuple must have exactly 2 elements (model, location)"
            model, location = value
            assert isinstance(model, str) and model, f"Task {task!r}: model must be non-empty string"
            assert isinstance(location, str) and location, f"Task {task!r}: location must be non-empty string"


class TestOmoGraderLock:
    """omo_grader is LOCKED on gemini-2.5-flash @ us-central1 — Issue #1730.

    DO NOT change this assignment. Spatial reasoning accuracy:
      gemini-2.5-flash: lettered circles 5/5
      gemini-flash-lite: lettered circles 1/5 (catastrophic failure)
    """

    def test_omo_grader_uses_gemini_25_flash(self):
        """omo_grader must use gemini-2.5-flash (NOT flash-lite, NOT 3.x)."""
        model, location = get_model_for_task("omo_grader")
        assert model == "gemini-2.5-flash", (
            f"omo_grader model is {model!r}. "
            f"LOCKED on 'gemini-2.5-flash' per Issue #1730. "
            f"DO NOT change — lettered circle accuracy drops from 5/5 to 1/5 with flash-lite."
        )

    def test_omo_grader_location_is_us_central1(self):
        """omo_grader must be in us-central1 for Gemini 2.5 availability."""
        model, location = get_model_for_task("omo_grader")
        assert location == "us-central1", (
            f"omo_grader location is {location!r}. "
            f"Must be 'us-central1' per Issue #1730 (Gemini 2.5 Flash requires regional endpoint)."
        )

    def test_get_model_for_task_omo_grader_returns_correct_tuple(self):
        """get_model_for_task('omo_grader') returns the locked tuple."""
        result = get_model_for_task("omo_grader")
        assert result == ("gemini-2.5-flash", "us-central1"), (
            f"omo_grader returned {result!r}. Expected ('gemini-2.5-flash', 'us-central1')."
        )


class TestOmoIdentifierAssignment:
    """omo_identifier moved to gemini-flash-lite-latest @ global — Issue #1729.

    A/B test result: 15/16 accuracy parity with 2.5-flash.
    """

    def test_omo_identifier_uses_flash_lite_latest(self):
        """omo_identifier must use gemini-flash-lite-latest."""
        model, location = get_model_for_task("omo_identifier")
        assert model == "gemini-flash-lite-latest", (
            f"omo_identifier model is {model!r}. "
            f"Expected 'gemini-flash-lite-latest' per Issue #1729 A/B result."
        )

    def test_omo_identifier_location_is_global(self):
        """omo_identifier uses global endpoint (no regional routing needed for flash-lite)."""
        model, location = get_model_for_task("omo_identifier")
        assert location == "global", (
            f"omo_identifier location is {location!r}. Expected 'global'."
        )


class TestTextGenerationTasksUseFlashLite:
    """8 text/JSON generation tasks must use gemini-2.5-flash-lite @ global — Issue #1744.

    Each task was A/B tested: 3/3 quality complete, 29-49% faster, 22-46% cheaper.
    """

    FLASH_LITE_TASKS = [
        "socratic_question",
        "socratic_agent_process",
        "comprehension_score",
        "sentence_validate",
        "exit_ticket_generate",
        "example_sentences",
        "story_structure",
        "reading_analysis",
        "teacher_comment",
    ]

    def test_all_flash_lite_tasks_use_correct_model(self):
        """All text/JSON generation tasks must use gemini-2.5-flash-lite."""
        for task in self.FLASH_LITE_TASKS:
            model, location = get_model_for_task(task)
            assert model == "gemini-2.5-flash-lite", (
                f"Task {task!r} model is {model!r}. "
                f"Expected 'gemini-2.5-flash-lite' per Issue #1744 A/B result."
            )

    def test_all_flash_lite_tasks_use_global_location(self):
        """All text/JSON generation tasks must use global endpoint."""
        for task in self.FLASH_LITE_TASKS:
            model, location = get_model_for_task(task)
            assert location == "global", (
                f"Task {task!r} location is {location!r}. Expected 'global'."
            )


class TestGetModelForTaskErrorHandling:
    """get_model_for_task raises KeyError for unknown tasks."""

    def test_unknown_task_raises_key_error(self):
        """Unknown task must raise KeyError, not return None or default."""
        with pytest.raises(KeyError) as exc_info:
            get_model_for_task("unknown_task_that_does_not_exist")
        assert "unknown_task_that_does_not_exist" in str(exc_info.value)

    def test_empty_string_task_raises_key_error(self):
        """Empty string task must raise KeyError."""
        with pytest.raises(KeyError):
            get_model_for_task("")

    def test_typo_in_task_name_raises_key_error(self):
        """Common typo variants must raise KeyError (not silently return wrong model)."""
        for typo in ["socratic", "omo-grader", "OMO_GRADER", "comprehension"]:
            with pytest.raises(KeyError):
                get_model_for_task(typo)
