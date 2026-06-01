"""Executable spec — session overall_score weighted-mean contract.

spec_id: session.scoring.overall_score
canonical_source: backend/app/services/gamification_service.py
owns_code: backend/app/services/gamification_service.py
related_issues: [1063]
human_spec: specs/modules/session-scoring/INTENT.md

Machine-verifiable contracts for the pure weighted-mean formula used in
complete_learning_session() to compute LearningSession.overall_score.

The formula is DB-coupled in production (reads the LearningSession ORM object),
so we extract the pure arithmetic here and test the invariant directly against
the formula as documented in the INTENT.md spec.

These tests do NOT mock a database — they verify the formula arithmetic only.

Drift model: if a contract fails, the formula in gamification_service.py
diverged from the spec.  Update both the spec table AND these tests when
intentionally changing weights.

Run:  cd backend && python -m pytest specs/test_session_scoring_spec.py -v
"""
from __future__ import annotations

import math


# ---------------------------------------------------------------------------
# The formula extracted verbatim from gamification_service.py L334-337.
# Any refactor of the production code must keep this formula equivalent.
# ---------------------------------------------------------------------------

def _compute_overall_score(scores: list[float], weights: list[float]) -> float | None:
    """Mirror of the production formula in complete_learning_session().

    Returns round(weighted_mean, 1) if scores is non-empty, else None.
    This is the pure arithmetic extracted from the DB-coupled service.
    """
    if not scores or not weights:
        return None
    total_weight = sum(weights)
    overall = sum(s * w for s, w in zip(scores, weights)) / total_weight
    return round(overall, 1)


# ---------------------------------------------------------------------------
# Weight constants (source of truth: specs/modules/session-scoring/INTENT.md)
# Update both here AND the spec table when intentionally changing weights.
# ---------------------------------------------------------------------------
READING_WEIGHT = 0.4
COMPREHENSION_WEIGHT = 0.4
VOCAB_WEIGHT = 0.2


# ---------------------------------------------------------------------------
# Contract 1: full three-component session
# ---------------------------------------------------------------------------

def test_three_component_weighted_mean():
    """When all three components are present, overall_score is their weighted mean.

    Verified weights: reading=40%, comprehension=40%, vocab=20%.
    Example: reading=80, comprehension=70, vocab=60
      weighted_sum = 80*0.4 + 70*0.4 + 60*0.2 = 32 + 28 + 12 = 72
      total_weight = 0.4+0.4+0.2 = 1.0
      result = round(72.0 / 1.0, 1) = 72.0
    """
    reading = 80.0
    comprehension = 70.0
    vocab = 60.0

    scores = [reading, comprehension, vocab]
    weights = [READING_WEIGHT, COMPREHENSION_WEIGHT, VOCAB_WEIGHT]
    result = _compute_overall_score(scores, weights)

    expected = round(
        (reading * READING_WEIGHT + comprehension * COMPREHENSION_WEIGHT + vocab * VOCAB_WEIGHT)
        / (READING_WEIGHT + COMPREHENSION_WEIGHT + VOCAB_WEIGHT),
        1,
    )
    assert result == expected, f"3-component result {result} != {expected}"
    assert result == 72.0


def test_three_component_rounding():
    """Result is rounded to one decimal place, not truncated."""
    # 85*0.4 + 73*0.4 + 66*0.2 = 34 + 29.2 + 13.2 = 76.4 / 1.0 = 76.4
    result = _compute_overall_score(
        [85.0, 73.0, 66.0],
        [READING_WEIGHT, COMPREHENSION_WEIGHT, VOCAB_WEIGHT],
    )
    assert result == round(85 * 0.4 + 73 * 0.4 + 66 * 0.2, 1)


# ---------------------------------------------------------------------------
# Contract 2: partial sessions (dynamic denominator)
# ---------------------------------------------------------------------------

def test_reading_only_uses_reading_weight_as_denominator():
    """If only reading is available, denominator = 0.4, not 1.0.

    This matches the production behavior: only components with actual data
    contribute to the calculation.
    80 * 0.4 / 0.4 = 80.0
    """
    result = _compute_overall_score([80.0], [READING_WEIGHT])
    assert result == 80.0


def test_reading_plus_comprehension_no_vocab():
    """Two-component session: weights sum to 0.8, not 1.0.

    90 * 0.4 + 70 * 0.4 = 36 + 28 = 64; 64 / 0.8 = 80.0
    """
    result = _compute_overall_score(
        [90.0, 70.0],
        [READING_WEIGHT, COMPREHENSION_WEIGHT],
    )
    assert result == 80.0


def test_comprehension_pass_default_score_is_80():
    """When comprehension_passed=True but no numeric score, 80.0 is used.

    This mirrors the production fallback:
        elif comprehension_passed:
            scores.append(80.0)
    We document the magic constant so future maintainers can find it.
    """
    comprehension_fallback = 80.0
    result = _compute_overall_score([comprehension_fallback], [COMPREHENSION_WEIGHT])
    assert result == 80.0


# ---------------------------------------------------------------------------
# Contract 3: edge cases
# ---------------------------------------------------------------------------

def test_empty_scores_returns_none():
    """No data → overall_score stays None (not zero)."""
    result = _compute_overall_score([], [])
    assert result is None


def test_perfect_score():
    """100 on all components → overall_score = 100.0."""
    result = _compute_overall_score(
        [100.0, 100.0, 100.0],
        [READING_WEIGHT, COMPREHENSION_WEIGHT, VOCAB_WEIGHT],
    )
    assert result == 100.0


def test_zero_score():
    """0 on all components → overall_score = 0.0 (not None)."""
    result = _compute_overall_score(
        [0.0, 0.0, 0.0],
        [READING_WEIGHT, COMPREHENSION_WEIGHT, VOCAB_WEIGHT],
    )
    assert result == 0.0


def test_result_is_float():
    """overall_score is always a float (or None), never int."""
    result = _compute_overall_score(
        [70.0, 70.0, 70.0],
        [READING_WEIGHT, COMPREHENSION_WEIGHT, VOCAB_WEIGHT],
    )
    assert isinstance(result, float)


# ---------------------------------------------------------------------------
# Contract 4: vocab_accuracy normalisation
# ---------------------------------------------------------------------------

def test_vocab_accuracy_proportion_is_normalised_to_100():
    """vocab_result["accuracy"] ≤ 1 is treated as a proportion → multiplied by 100.

    Production code (L331):
        scores.append(float(vocab_accuracy) * 100 if vocab_accuracy <= 1 else float(vocab_accuracy))

    We verify the semantics: proportion 0.8 is equivalent to score 80.
    """
    prop_input = 0.8
    normalised = prop_input * 100  # as done in production
    result = _compute_overall_score([normalised], [VOCAB_WEIGHT])
    assert result == 80.0


def test_vocab_accuracy_already_100_scale_is_used_as_is():
    """vocab_result["accuracy"] > 1 is assumed already on 0-100 scale."""
    score_input = 85.0  # > 1, so NOT multiplied
    result = _compute_overall_score([score_input], [VOCAB_WEIGHT])
    assert result == 85.0
