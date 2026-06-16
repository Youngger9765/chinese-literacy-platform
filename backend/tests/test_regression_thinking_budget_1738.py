"""Regression tests for thinking_budget=0 enforcement — Issue #1738 / PR #1739.

Static analysis test: reads source files and asserts that
thinking_budget=0 (or equivalent) is present in each production LLM call site.

Why thinking_budget=0 matters:
  Gemini 2.5 Flash (and Flash-Lite) have "thinking" enabled by default.
  Thinking increases latency and token cost with no quality benefit for
  structured JSON generation tasks (scored 3/3 equivalent without thinking).
  Setting thinking_budget=0 disables extended thinking, saving ~30-50% cost.

Files guarded by this test:
  - ai_comprehension.py  (comprehension scoring, socratic questions)
  - omo_identifier.py    (worksheet image identification)
  - ai/gemini_client.py  (shared Gemini structured-response utility; Issue #1953)
  - omo_grader.py        (OMO answer grading)

Run:
    cd backend && python -m pytest tests/test_regression_thinking_budget_1738.py -v
"""

import sys
import os
import re
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Resolve the backend/app/services directory relative to this test file
_SERVICES_DIR = Path(__file__).parent.parent / "app" / "services"

# Files that must have thinking_budget=0 in their GenerateContentConfig calls.
# Each entry: (relative_path, description_for_error_message)
_GUARDED_FILES = [
    ("ai_comprehension.py", "comprehension scoring / socratic question generation"),
    ("omo_identifier.py", "OMO worksheet image identification"),
    ("ai/gemini_client.py", "shared Gemini structured-response utility (was ai_base.py)"),
    ("omo_grader.py", "OMO answer grading — Issue #1717"),
]

# Pattern that must appear in each file.
# Matches: thinking_budget=0  OR  thinking_budget = 0
_THINKING_BUDGET_PATTERN = re.compile(r"thinking_budget\s*=\s*0")

# Pattern for GenerateContentConfig — confirms the file actually makes LLM calls.
_GENERATE_CONTENT_CONFIG_PATTERN = re.compile(r"GenerateContentConfig")


class TestThinkingBudgetEnforcement:
    """thinking_budget=0 must be present in all production LLM call sites."""

    def _read_service_file(self, filename: str) -> str:
        path = _SERVICES_DIR / filename
        assert path.exists(), (
            f"Service file {filename!r} not found at {path}. "
            f"Was it renamed or moved? Update this test."
        )
        return path.read_text(encoding="utf-8")

    def test_ai_comprehension_has_thinking_budget_zero(self):
        """ai_comprehension.py must set thinking_budget=0 in GenerateContentConfig."""
        content = self._read_service_file("ai_comprehension.py")
        assert _THINKING_BUDGET_PATTERN.search(content), (
            "ai_comprehension.py does NOT contain thinking_budget=0. "
            "This was fixed in Issue #1738. "
            "Removing this causes extended thinking to run on every comprehension "
            "scoring call, increasing latency and cost by ~30-50%."
        )

    def test_omo_identifier_has_thinking_budget_zero(self):
        """omo_identifier.py must set thinking_budget=0 in GenerateContentConfig."""
        content = self._read_service_file("omo_identifier.py")
        assert _THINKING_BUDGET_PATTERN.search(content), (
            "omo_identifier.py does NOT contain thinking_budget=0. "
            "This was fixed in Issue #1738. "
            "Extended thinking on identifier calls wastes tokens with no accuracy gain."
        )

    def test_gemini_tts_does_not_use_thinking_config(self):
        """Gemini TTS (AUDIO modality) must not pass thinking_config — API returns 400."""
        path = _SERVICES_DIR / "tts" / "providers" / "gemini.py"
        assert path.exists(), f"Gemini TTS provider not found at {path}"
        content = path.read_text(encoding="utf-8")
        assert "thinking_config" not in content, (
            "tts/providers/gemini.py must NOT set thinking_config on GenerateContentConfig. "
            "gemini-3.1-flash-tts-preview rejects it with 400 INVALID_ARGUMENT, "
            "breaking live synthesis (503) on GCS cache miss."
        )

    def test_gemini_client_has_thinking_budget_zero(self):
        """ai/gemini_client.py must set thinking_budget=0 in its GenerateContentConfig."""
        content = self._read_service_file("ai/gemini_client.py")
        assert _THINKING_BUDGET_PATTERN.search(content), (
            "ai/gemini_client.py does NOT contain thinking_budget=0. "
            "This was fixed in Issue #1738 and moved here in Issue #1953. "
            "gemini_client.py is the shared LLM call utility — missing this setting "
            "would enable thinking for all tasks that use generate_structured_response."
        )

    def test_omo_grader_has_thinking_budget_zero(self):
        """omo_grader.py must set thinking_budget=0 (Issue #1717)."""
        content = self._read_service_file("omo_grader.py")
        assert _THINKING_BUDGET_PATTERN.search(content), (
            "omo_grader.py does NOT contain thinking_budget=0. "
            "This was fixed in Issue #1717 (predates #1738). "
            "OMO grading uses vision — thinking does not improve spatial accuracy."
        )


class TestThinkingBudgetContext:
    """Sanity checks: files actually make LLM calls (so thinking_budget matters)."""

    def _read_service_file(self, filename: str) -> str:
        path = _SERVICES_DIR / filename
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def test_ai_comprehension_uses_generate_content_config(self):
        """ai_comprehension.py uses GenerateContentConfig (confirms it makes LLM calls)."""
        content = self._read_service_file("ai_comprehension.py")
        assert _GENERATE_CONTENT_CONFIG_PATTERN.search(content), (
            "ai_comprehension.py does not use GenerateContentConfig. "
            "If the LLM call pattern changed, update this test."
        )

    def test_omo_identifier_uses_generate_content_config(self):
        """omo_identifier.py uses GenerateContentConfig."""
        content = self._read_service_file("omo_identifier.py")
        assert _GENERATE_CONTENT_CONFIG_PATTERN.search(content), (
            "omo_identifier.py does not use GenerateContentConfig."
        )

    def test_omo_grader_uses_generate_content_config(self):
        """omo_grader.py uses GenerateContentConfig."""
        content = self._read_service_file("omo_grader.py")
        assert _GENERATE_CONTENT_CONFIG_PATTERN.search(content), (
            "omo_grader.py does not use GenerateContentConfig."
        )

    def test_gemini_client_uses_generate_content_config(self):
        """ai/gemini_client.py uses GenerateContentConfig."""
        content = self._read_service_file("ai/gemini_client.py")
        assert _GENERATE_CONTENT_CONFIG_PATTERN.search(content), (
            "ai/gemini_client.py does not use GenerateContentConfig. "
            "If the LLM call pattern changed, update this test."
        )

    def test_all_guarded_files_exist(self):
        """All guarded service files must exist (catches file rename/deletion)."""
        for filename, description in _GUARDED_FILES:
            path = _SERVICES_DIR / filename
            assert path.exists(), (
                f"Service file {filename!r} ({description}) not found at {path}. "
                f"If the file was renamed, update _GUARDED_FILES in this test."
            )

    def test_thinking_budget_count_per_file(self):
        """Each guarded file should have at least 1 thinking_budget=0 occurrence."""
        for filename, description in _GUARDED_FILES:
            path = _SERVICES_DIR / filename
            if not path.exists():
                continue
            content = path.read_text(encoding="utf-8")
            matches = _THINKING_BUDGET_PATTERN.findall(content)
            assert len(matches) >= 1, (
                f"{filename} has 0 occurrences of thinking_budget=0. "
                f"Expected at least 1 (Issue #1738)."
            )
