"""
AI API calls — thin re-export layer for backwards compatibility.

All AI logic has been split into focused modules:
  - ai_base.py          — shared utilities (Gemini client, retry, JSON repair, safety filter)
  - ai_comprehension.py — Socratic dialogue & comprehension scoring
  - ai_reading.py       — reading analysis (pronunciation, accuracy, CPM)
  - ai_generation.py    — content generation (MCQ, story structure, sentences, vocabulary)

Existing imports from this module continue to work unchanged.
"""

# Re-export shared base utilities
from .ai_base import (  # noqa: F401
    CONTENT_FILTER_FRIENDLY_MSG,
    GeminiContentFilterError,
    MAX_RETRIES,
    RETRY_BASE_DELAY,
    GEMINI_TIMEOUT,
    _check_safety_filter,
    _get_client,
    _repair_json,
    generate_structured_response,
)

# Re-export for backwards compatibility
from .ai_comprehension import *  # noqa: F401,F403
from .ai_reading import *  # noqa: F401,F403
from .ai_generation import *  # noqa: F401,F403
