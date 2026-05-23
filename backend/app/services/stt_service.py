"""
STT evaluation service — thin backward-compat facade.

All logic now lives in the `stt` sub-package:
    app/services/stt/pinyin.py         — pinyin lookup map + helpers
    app/services/stt/normalization.py  — number/punctuation normalizers
    app/services/stt/algorithm.py      — correct_homophones, compute_match_rate
    app/services/stt/evaluate.py       — evaluate_reading, Tier, FEEDBACK_KEYS

This module re-exports the full public API so existing callers remain
unchanged (reading_evaluation_service.py, tests, API routes).
"""

from .stt.pinyin import get_pinyin, is_homophone
from .stt.normalization import normalize_for_comparison as _normalize_for_comparison
from .stt.algorithm import correct_homophones, compute_match_rate
from .stt.evaluate import evaluate_reading, Tier, FEEDBACK_KEYS

__all__ = [
    "get_pinyin",
    "is_homophone",
    "correct_homophones",
    "compute_match_rate",
    "evaluate_reading",
    "Tier",
    "FEEDBACK_KEYS",
]
