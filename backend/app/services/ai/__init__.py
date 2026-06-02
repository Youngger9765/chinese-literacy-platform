"""AI sub-package — re-exports the full public surface of ai_base (Issue #1953).

Provider-agnostic utilities:
    MAX_RETRIES, RETRY_BASE_DELAY, GEMINI_TIMEOUT, CONTENT_FILTER_FRIENDLY_MSG, _repair_json

Gemini / Vertex AI client:
    GeminiContentFilterError, _check_safety_filter, _get_client,
    _get_client_for_task, generate_structured_response
"""

from .base import (
    CONTENT_FILTER_FRIENDLY_MSG,
    GEMINI_TIMEOUT,
    MAX_RETRIES,
    RETRY_BASE_DELAY,
    _repair_json,
)
from .gemini_client import (
    GeminiContentFilterError,
    _check_safety_filter,
    _get_client,
    _get_client_for_task,
    generate_structured_response,
)

__all__ = [
    # base
    "MAX_RETRIES",
    "RETRY_BASE_DELAY",
    "GEMINI_TIMEOUT",
    "CONTENT_FILTER_FRIENDLY_MSG",
    "_repair_json",
    # gemini_client
    "GeminiContentFilterError",
    "_check_safety_filter",
    "_get_client",
    "_get_client_for_task",
    "generate_structured_response",
]
