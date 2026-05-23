"""
stt — Speech-to-Text evaluation sub-package.

Public API (mirrors stt_service.py for backward compat):
    from app.services.stt import get_pinyin, is_homophone
    from app.services.stt import correct_homophones, compute_match_rate
    from app.services.stt import evaluate_reading, Tier, FEEDBACK_KEYS
"""

from .pinyin import get_pinyin, is_homophone
from .normalization import normalize_for_comparison, normalize_numbers
from .algorithm import correct_homophones, compute_match_rate
from .evaluate import evaluate_reading, Tier, FEEDBACK_KEYS

__all__ = [
    "get_pinyin",
    "is_homophone",
    "normalize_for_comparison",
    "normalize_numbers",
    "correct_homophones",
    "compute_match_rate",
    "evaluate_reading",
    "Tier",
    "FEEDBACK_KEYS",
]
