"""
Tests for ai_service.py refactor — verify all public exports still accessible.

Regression: ai_service.py split into ai_base + ai_comprehension + ai_reading + ai_generation
Found by /plan-eng-review on 2026-04-04
"""
import importlib
import inspect
import pytest


class TestAiServiceReexports:
    """Verify the thin re-export layer in ai_service.py preserves all public APIs."""

    def test_ai_service_importable(self):
        """ai_service module should import without errors."""
        mod = importlib.import_module("app.services.ai_service")
        assert mod is not None

    def test_base_utilities_accessible(self):
        """Shared base utilities must be importable from ai_service."""
        from app.services.ai_service import (
            CONTENT_FILTER_FRIENDLY_MSG,
            GeminiContentFilterError,
            MAX_RETRIES,
            RETRY_BASE_DELAY,
            GEMINI_TIMEOUT,
            generate_structured_response,
        )
        assert MAX_RETRIES == 3
        assert RETRY_BASE_DELAY == 1.0
        assert GEMINI_TIMEOUT == 30
        assert isinstance(CONTENT_FILTER_FRIENDLY_MSG, str)
        assert issubclass(GeminiContentFilterError, Exception)
        assert callable(generate_structured_response)

    def test_comprehension_functions_accessible(self):
        """Comprehension AI functions must be importable from ai_service."""
        from app.services.ai_service import (
            generate_socratic_question,
            evaluate_comprehension,
        )
        assert callable(generate_socratic_question)
        assert callable(evaluate_comprehension)

    def test_reading_functions_accessible(self):
        """Reading analysis functions must be importable from ai_service."""
        from app.services.ai_service import generate_reading_analysis
        assert callable(generate_reading_analysis)

    def test_generation_functions_accessible(self):
        """Content generation functions must be importable from ai_service."""
        from app.services.ai_service import (
            generate_exit_ticket,
            generate_example_sentences,
            generate_story_structure,
            validate_student_sentence,
        )
        assert callable(generate_exit_ticket)
        assert callable(generate_example_sentences)
        assert callable(generate_story_structure)
        assert callable(validate_student_sentence)

    def test_submodules_importable_directly(self):
        """Each submodule should be independently importable."""
        ai_base = importlib.import_module("app.services.ai_base")
        ai_comp = importlib.import_module("app.services.ai_comprehension")
        ai_read = importlib.import_module("app.services.ai_reading")
        ai_gen = importlib.import_module("app.services.ai_generation")
        assert ai_base is not None
        assert ai_comp is not None
        assert ai_read is not None
        assert ai_gen is not None

    def test_no_duplicate_definitions(self):
        """Functions should only be defined in one submodule, not duplicated."""
        ai_comp = importlib.import_module("app.services.ai_comprehension")
        ai_read = importlib.import_module("app.services.ai_reading")
        ai_gen = importlib.import_module("app.services.ai_generation")

        # Get functions DEFINED in each module (not imported helpers)
        def _own_funcs(mod):
            return {name for name, obj in inspect.getmembers(mod)
                    if inspect.isfunction(obj) and not name.startswith('_')
                    and obj.__module__ == mod.__name__}

        comp_funcs = _own_funcs(ai_comp)
        read_funcs = _own_funcs(ai_read)
        gen_funcs = _own_funcs(ai_gen)

        # No overlap between modules (only functions DEFINED there, not imported helpers)
        assert comp_funcs.isdisjoint(read_funcs), f"Overlap: {comp_funcs & read_funcs}"
        assert comp_funcs.isdisjoint(gen_funcs), f"Overlap: {comp_funcs & gen_funcs}"
        assert read_funcs.isdisjoint(gen_funcs), f"Overlap: {read_funcs & gen_funcs}"

    def test_repair_json_accessible(self):
        """JSON repair utility must still be accessible."""
        from app.services.ai_service import _repair_json
        assert callable(_repair_json)

    def test_safety_filter_accessible(self):
        """Safety filter check must still be accessible."""
        from app.services.ai_service import _check_safety_filter
        assert callable(_check_safety_filter)
