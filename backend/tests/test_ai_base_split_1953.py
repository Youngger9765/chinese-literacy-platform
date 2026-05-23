"""Characterization tests for Issue #1953: ai_base.py split into ai/ sub-package.

TDD approach:
  RED  — tests written before implementation
  GREEN — all pass after implementation

Test classes:
  TestAiSubpackageExists        — ai/ dir + __init__.py + base.py + gemini_client.py present
  TestAiBaseModule              — base.py exports constants + _repair_json, NO google.genai
  TestGeminiClientModule        — gemini_client.py exports all Gemini symbols
  TestAiPackageInit             — ai/__init__.py re-exports everything
  TestBackwardCompatFacade      — ai_base.py facade re-exports same objects (identity check)
  TestExistingImportersStillWork — actual callers can import from ai_base unchanged
  TestModuleResponsibilitySeparation — base.py must not import google.genai (AST verified)
  TestRepairJsonBehaviour       — _repair_json works correctly end-to-end
"""

import ast
import importlib
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SERVICES_PATH = Path(__file__).parent.parent / "app" / "services"
AI_PKG = SERVICES_PATH / "ai"


def _get_base_module():
    """Import ai/base.py directly (not via package) to test isolation."""
    spec = importlib.util.spec_from_file_location(
        "ai_base_module_under_test", AI_PKG / "base.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# TestAiSubpackageExists
# ---------------------------------------------------------------------------


class TestAiSubpackageExists:
    def test_ai_directory_exists(self):
        assert AI_PKG.is_dir(), "backend/app/services/ai/ directory must exist"

    def test_init_py_exists(self):
        assert (AI_PKG / "__init__.py").is_file()

    def test_base_py_exists(self):
        assert (AI_PKG / "base.py").is_file()

    def test_gemini_client_py_exists(self):
        assert (AI_PKG / "gemini_client.py").is_file()

    def test_ai_base_facade_still_exists(self):
        assert (SERVICES_PATH / "ai_base.py").is_file()


# ---------------------------------------------------------------------------
# TestAiBaseModule
# ---------------------------------------------------------------------------


class TestAiBaseModule:
    """ai/base.py must export constants and _repair_json. NO google.genai allowed."""

    def test_max_retries_constant(self):
        mod = _get_base_module()
        assert hasattr(mod, "MAX_RETRIES")
        assert mod.MAX_RETRIES == 3

    def test_retry_base_delay_constant(self):
        mod = _get_base_module()
        assert hasattr(mod, "RETRY_BASE_DELAY")
        assert mod.RETRY_BASE_DELAY == 1.0

    def test_gemini_timeout_constant(self):
        mod = _get_base_module()
        assert hasattr(mod, "GEMINI_TIMEOUT")
        assert mod.GEMINI_TIMEOUT == 30

    def test_content_filter_friendly_msg_constant(self):
        mod = _get_base_module()
        assert hasattr(mod, "CONTENT_FILTER_FRIENDLY_MSG")
        assert isinstance(mod.CONTENT_FILTER_FRIENDLY_MSG, str)
        assert len(mod.CONTENT_FILTER_FRIENDLY_MSG) > 0

    def test_repair_json_is_callable(self):
        mod = _get_base_module()
        assert callable(mod._repair_json)

    def test_no_google_genai_import_in_base(self):
        """AST-level check: base.py must not import from google.genai."""
        source = (AI_PKG / "base.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                if isinstance(node, ast.ImportFrom) and node.module:
                    assert "google" not in (node.module or ""), (
                        f"base.py must not import from google (found: {ast.dump(node)})"
                    )
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        assert "google" not in alias.name, (
                            f"base.py must not import google (found: {alias.name})"
                        )


# ---------------------------------------------------------------------------
# TestGeminiClientModule
# ---------------------------------------------------------------------------


class TestGeminiClientModule:
    """gemini_client.py must export all Gemini symbols (verified via AST/source)."""

    def test_gemini_content_filter_error_defined(self):
        source = (AI_PKG / "gemini_client.py").read_text(encoding="utf-8")
        assert "class GeminiContentFilterError" in source

    def test_check_safety_filter_defined(self):
        source = (AI_PKG / "gemini_client.py").read_text(encoding="utf-8")
        assert "def _check_safety_filter" in source

    def test_get_client_defined(self):
        source = (AI_PKG / "gemini_client.py").read_text(encoding="utf-8")
        assert "def _get_client(" in source

    def test_get_client_for_task_defined(self):
        source = (AI_PKG / "gemini_client.py").read_text(encoding="utf-8")
        assert "def _get_client_for_task(" in source

    def test_generate_structured_response_defined(self):
        source = (AI_PKG / "gemini_client.py").read_text(encoding="utf-8")
        assert "async def generate_structured_response(" in source

    def test_gemini_client_imports_google_genai(self):
        """gemini_client.py MUST import from google.genai (unlike base.py)."""
        source = (AI_PKG / "gemini_client.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        found_google = False
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and "google" in node.module:
                found_google = True
                break
        assert found_google, "gemini_client.py must import from google.genai"


# ---------------------------------------------------------------------------
# TestAiPackageInit
# ---------------------------------------------------------------------------


class TestAiPackageInit:
    """ai/__init__.py must re-export the full public surface."""

    EXPECTED_EXPORTS = [
        "MAX_RETRIES",
        "RETRY_BASE_DELAY",
        "GEMINI_TIMEOUT",
        "CONTENT_FILTER_FRIENDLY_MSG",
        "_repair_json",
        "GeminiContentFilterError",
        "_check_safety_filter",
        "_get_client",
        "_get_client_for_task",
        "generate_structured_response",
    ]

    def test_all_exports_present_in_init(self):
        source = (AI_PKG / "__init__.py").read_text(encoding="utf-8")
        for name in self.EXPECTED_EXPORTS:
            assert name in source, f"ai/__init__.py must re-export {name!r}"

    def test_init_imports_from_base(self):
        source = (AI_PKG / "__init__.py").read_text(encoding="utf-8")
        assert "from .base import" in source

    def test_init_imports_from_gemini_client(self):
        source = (AI_PKG / "__init__.py").read_text(encoding="utf-8")
        assert "from .gemini_client import" in source


# ---------------------------------------------------------------------------
# TestBackwardCompatFacade
# ---------------------------------------------------------------------------


class TestBackwardCompatFacade:
    """ai_base.py facade must re-export every symbol that callers depend on."""

    EXPECTED_IN_FACADE = [
        "MAX_RETRIES",
        "RETRY_BASE_DELAY",
        "GEMINI_TIMEOUT",
        "CONTENT_FILTER_FRIENDLY_MSG",
        "_repair_json",
        "GeminiContentFilterError",
        "_check_safety_filter",
        "_get_client",
        "_get_client_for_task",
        "generate_structured_response",
        # These are imported by ai_comprehension.py from ai_base:
        "capture_usage",
        "last_usage",
        # These are imported by various services from ai_base:
        "sanitize_ai_input",
        "sanitize_dialogue_turns",
        "TUTOR_PERSONA",
    ]

    def test_all_expected_names_in_facade_source(self):
        source = (SERVICES_PATH / "ai_base.py").read_text(encoding="utf-8")
        for name in self.EXPECTED_IN_FACADE:
            assert name in source, f"ai_base.py facade must re-export {name!r}"

    def test_facade_imports_from_ai_subpackage(self):
        source = (SERVICES_PATH / "ai_base.py").read_text(encoding="utf-8")
        assert "from .ai import" in source

    def test_facade_imports_capture_usage_and_last_usage(self):
        """ai_comprehension.py imports capture_usage, last_usage from ai_base."""
        source = (SERVICES_PATH / "ai_base.py").read_text(encoding="utf-8")
        assert "capture_usage" in source
        assert "last_usage" in source

    def test_facade_imports_tutor_persona(self):
        source = (SERVICES_PATH / "ai_base.py").read_text(encoding="utf-8")
        assert "TUTOR_PERSONA" in source

    def test_facade_imports_sanitizers(self):
        source = (SERVICES_PATH / "ai_base.py").read_text(encoding="utf-8")
        assert "sanitize_ai_input" in source
        assert "sanitize_dialogue_turns" in source


# ---------------------------------------------------------------------------
# TestExistingImportersStillWork
# ---------------------------------------------------------------------------


class TestExistingImportersStillWork:
    """Verify that existing callers can still find their symbols in ai_base.py."""

    CALLER_IMPORTS = {
        # (file_relpath, symbol_imported_from_ai_base)
        "app/services/ai_comprehension.py": [
            "generate_structured_response",
            "GeminiContentFilterError",
            "capture_usage",
            "last_usage",
        ],
        "app/services/ai_reading.py": [
            "generate_structured_response",
            "GeminiContentFilterError",
        ],
        "app/services/exit_ticket_service.py": [
            "generate_structured_response",
            "GeminiContentFilterError",
        ],
        "app/services/socratic_agent.py": [
            "generate_structured_response",
            "GeminiContentFilterError",
        ],
    }

    def test_caller_files_still_exist(self):
        backend = SERVICES_PATH.parent.parent
        for relpath in self.CALLER_IMPORTS:
            p = backend / relpath
            assert p.is_file(), f"Expected caller file missing: {relpath}"

    def test_facade_has_symbols_callers_need(self):
        facade_source = (SERVICES_PATH / "ai_base.py").read_text(encoding="utf-8")
        needed = set()
        for symbols in self.CALLER_IMPORTS.values():
            needed.update(symbols)
        for sym in needed:
            assert sym in facade_source, (
                f"Facade ai_base.py must contain {sym!r} (needed by existing callers)"
            )


# ---------------------------------------------------------------------------
# TestModuleResponsibilitySeparation
# ---------------------------------------------------------------------------


class TestModuleResponsibilitySeparation:
    """base.py: pure Python. gemini_client.py: google.genai allowed."""

    def test_base_py_has_no_asyncio_import(self):
        """base.py has no async code — no asyncio needed."""
        source = (AI_PKG / "base.py").read_text(encoding="utf-8")
        assert "import asyncio" not in source

    def test_base_py_has_no_google_import_any_form(self):
        """AST-level check: no import statement in base.py references 'google'."""
        source = (AI_PKG / "base.py").read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert node.module is None or "google" not in node.module, (
                    f"base.py must not import from google (found: module={node.module})"
                )
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert "google" not in alias.name, (
                        f"base.py must not import google (found: {alias.name})"
                    )

    def test_gemini_client_has_asyncio(self):
        """gemini_client.py uses asyncio.wait_for / asyncio.to_thread."""
        source = (AI_PKG / "gemini_client.py").read_text(encoding="utf-8")
        assert "asyncio" in source

    def test_base_py_has_repair_json_implementation(self):
        """The actual _repair_json implementation must live in base.py."""
        source = (AI_PKG / "base.py").read_text(encoding="utf-8")
        assert "def _repair_json" in source

    def test_gemini_client_does_not_reimplement_repair_json(self):
        """gemini_client.py must import _repair_json from base, not redefine it."""
        source = (AI_PKG / "gemini_client.py").read_text(encoding="utf-8")
        assert "def _repair_json" not in source
        assert "_repair_json" in source  # but still uses it


# ---------------------------------------------------------------------------
# TestRepairJsonBehaviour
# ---------------------------------------------------------------------------


class TestRepairJsonBehaviour:
    """End-to-end correctness tests for _repair_json (regression set)."""

    def setup_method(self):
        self.repair = _get_base_module()._repair_json

    def test_valid_json_returned_unchanged(self):
        data = '{"key": "value"}'
        result = self.repair(data)
        assert result == data

    def test_strips_markdown_code_fence(self):
        fenced = '```json\n{"key": "val"}\n```'
        result = self.repair(fenced)
        import json
        assert json.loads(result) == {"key": "val"}

    def test_truncated_mid_array_with_complete_prior_element(self):
        """Gemini cuts mid-string, but a complete prior element exists — repair recovers it."""
        # candidates array has one complete element, second is truncated mid-string.
        # _repair_json should recover up to and including the first complete element.
        truncated = '{"candidates": [{"id": 1}, {"id": 2, "reasoning": "because the ans'
        result = self.repair(truncated)
        import json
        assert result is not None
        parsed = json.loads(result)
        assert "candidates" in parsed
        assert len(parsed["candidates"]) >= 1

    def test_trailing_string_after_candidates_array(self):
        """Top-level truncated string after a complete candidates array."""
        truncated = '{"candidates": [{"x": "y"}], "more": "truncated string here'
        result = self.repair(truncated)
        import json
        assert result is not None
        parsed = json.loads(result)
        assert "candidates" in parsed

    def test_none_returned_for_non_json(self):
        result = self.repair("this is not json at all")
        assert result is None

    def test_none_returned_for_empty_string(self):
        result = self.repair("")
        assert result is None

    def test_complete_array_returned_intact(self):
        data = '[{"a": 1}, {"b": 2}]'
        result = self.repair(data)
        import json
        assert json.loads(result) == [{"a": 1}, {"b": 2}]
