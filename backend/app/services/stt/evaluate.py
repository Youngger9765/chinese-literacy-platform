"""
Reading evaluation entry point.

evaluate_reading() is the main public function consumed by API routes and
reading_evaluation_service.py (as a fallback).
"""

from typing import Literal

from .normalization import normalize_for_comparison
from .algorithm import correct_homophones, compute_match_rate

Tier = Literal[1, 2, 3]

FEEDBACK_KEYS = {
    1: "tier1",  # >= 80% — very good, advance
    2: "tier2",  # >= 60% — good, advance
    3: "tier3",  # < 60% — retry same line
}


def evaluate_reading(stt_text: str, target_text: str) -> dict:
    """
    Full evaluation pipeline:
      1. Normalize target for alignment (strip punctuation).
      2. Correct homophones.
      3. Compute match rate.
      4. Return tier, match_rate, and feedback_key.

    Returns:
        {
            "corrected": str,
            "match_rate": float,
            "tier": int (1 | 2 | 3),
            "feedback_key": str,
        }
    """
    target_for_alignment = normalize_for_comparison(target_text)
    corrected = correct_homophones(stt_text, target_for_alignment)
    match_rate = compute_match_rate(corrected, target_text)

    if match_rate >= 0.8:
        tier: Tier = 1
    elif match_rate >= 0.6:
        tier = 2
    else:
        tier = 3

    return {
        "corrected": corrected,
        "match_rate": round(match_rate, 4),
        "tier": tier,
        "feedback_key": FEEDBACK_KEYS[tier],
    }
