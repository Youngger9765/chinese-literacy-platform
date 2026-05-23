"""Backward-compatibility facade — re-exports from ai/ sub-package (Issue #1953).

All AI modules that previously imported from ai_base continue to work unchanged.
The implementation has been split into:
  - ai/base.py          — retry constants, JSON repair (NO google.genai)
  - ai/gemini_client.py — Gemini/Vertex AI client, safety filter, structured response
  - ai/__init__.py      — re-exports the full public surface
"""

from .ai import (
    CONTENT_FILTER_FRIENDLY_MSG,
    GEMINI_TIMEOUT,
    MAX_RETRIES,
    RETRY_BASE_DELAY,
    GeminiContentFilterError,
    _check_safety_filter,
    _get_client,
    _get_client_for_task,
    _repair_json,
    generate_structured_response,
)
from .ai_usage_tracker import capture_usage, last_usage
from .input_sanitizer import sanitize_ai_input, sanitize_dialogue_turns
from .persona import TUTOR_PERSONA

__all__ = [
    # from ai sub-package
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
    # from sibling modules (re-exported for historical callers)
    "capture_usage",
    "last_usage",
    "sanitize_ai_input",
    "sanitize_dialogue_turns",
    "TUTOR_PERSONA",
]
