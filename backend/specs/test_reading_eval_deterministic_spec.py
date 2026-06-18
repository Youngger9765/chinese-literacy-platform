"""Executable spec — Issue #2266: reading eval must use deterministic scorer.

spec_id: reading.eval.deterministic_scorer
canonical_source: backend/app/services/reading_evaluation_service.py
owns_code:
  - backend/app/services/reading_evaluation_service.py
related_issues: [2266]

Root cause (verified 2026-06-18):
  evaluate_reading_with_ai() called Gemini to produce per-char diff_tokens.
  Three bugs in the AI path:
  Bug A: long texts → JSON truncated → missing tokens → 58% on near-perfect
  Bug B: spoken == target → Gemini returned [] diff_tokens → 0% score
  Bug C: extra spoken chars → adjusted_match_rate could exceed 1.0 (>100%)

Fix (C1 - deterministic scorer):
  evaluate_reading_with_ai() now returns _build_fallback_result() directly.
  No Gemini call, no truncation, no variance.
  evaluation_method is labelled "deterministic".

TDD strategy:
  - Mock generate_structured_response to reproduce each AI path bug exactly.
    (Without mock, local env gets 403 → fallback → scores are accidentally correct.)
  - After fix: the mock is never called → tests pass by construction.

Run: cd backend && python -m pytest specs/test_reading_eval_deterministic_spec.py -v
"""
from __future__ import annotations

import asyncio

import pytest

from app.services.persona import Thresholds
from app.services.reading_evaluation_service import evaluate_reading_with_ai, _normalize_text


# ---------------------------------------------------------------------------
# Shared targets
# ---------------------------------------------------------------------------

_SHORT_TARGET = "春風吹過田野花兒開了"

_LONG_TARGET = (
    "大樹媽媽張開雙臂，讓風箏緊緊靠在懷中。"
    "孩子們仰望天空，臉上掛著燦爛的笑容，"
    "任微風拂過臉頰，任陽光灑在肩上。"
    "遠處的山巒連綿起伏，像是大地的臂彎，"
    "把村莊輕輕抱在中間。河水潺潺流過石橋，"
    "倒映出蔚藍的天空和輕柔的白雲。"
    "老爺爺坐在榕樹下，手裡搖著蒲扇，"
    "嘴角帶著淡淡的微笑，眼神悠然望向遠方。"
    "小狗在院子裡跑來跑去，尾巴搖個不停，"
    "好像也感受到了這美好的午後時光。"
)

# Fang's near-perfect case: 連→聯 is the only difference (homophone pair)
_FANG_TARGET = "我和你心連心，共住地球村，為夢想千里行，攜手走天下，歡聚五環旗下，同是一家人。"
_FANG_SPOKEN = "我和你心聯心，共住地球村，為夢想千里行，攜手走天下，歡聚五環旗下，同是一家人。"


# ---------------------------------------------------------------------------
# Bug A fix: near-perfect reading (Fang's case) must score >=90%
# Old AI path: JSON truncation on long text caused ~58% (10/target_len)
# New deterministic path: DP aligner gives ~98% (homophone 連/聯 is forgiven)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_near_perfect_reading_scores_high():
    """Bug A fix: Fang's near-perfect STT case must score >=90%.

    Original failure: Gemini JSON truncation on long text → 58% score.
    Deterministic DP: homophone 連→聯 forgiven → ~98%.
    """
    result = await evaluate_reading_with_ai(_FANG_SPOKEN, _FANG_TARGET)
    adj = result["adjusted_match_rate"]
    assert adj >= 0.90, (
        f"Near-perfect reading (Fang's case) must score >=90%. Got {adj}. "
        f"If this fails, the deterministic path is not being used."
    )


# ---------------------------------------------------------------------------
# Bug B fix: perfect reading (spoken==target) must score ~100%, not 0%
# Old AI path: Gemini returned empty diff_tokens [] → 0/target_len = 0%
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_perfect_reading_scores_100():
    """Bug B fix: spoken==target must score ~100%, not 0%.

    Original failure: Gemini returned [] diff_tokens → adjusted_match_rate=0.0.
    Deterministic DP: every char matches → 1.0.
    """
    result = await evaluate_reading_with_ai(_SHORT_TARGET, _SHORT_TARGET)
    adj = result["adjusted_match_rate"]
    assert adj >= 0.99, (
        f"Perfect reading (spoken==target) must score ~100%. Got {adj}. "
        f"This was 0% on old AI path (empty diff_tokens bug)."
    )


# ---------------------------------------------------------------------------
# Bug C fix: extra spoken chars must NOT inflate score above 100%
# Old AI path: could produce adjusted_match_rate > 1.0
# Deterministic path: denominator = target_length only, extras don't count
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extra_spoken_chars_no_score_above_100():
    """Bug C fix: student reading more than target must score <=100%.

    Denominator is always target_length.
    Extra spoken chars (not in target) appear as 'extra' tokens, not 'correct'.
    """
    spoken_with_extras = _SHORT_TARGET + "春風吹花開了啊！"
    result = await evaluate_reading_with_ai(spoken_with_extras, _SHORT_TARGET)
    adj = result["adjusted_match_rate"]
    assert adj <= 1.0, (
        f"Extra chars must not inflate score above 100%. Got {adj}."
    )
    assert adj >= 0.90, (
        f"All target chars matched, score should be high. Got {adj}."
    )


# ---------------------------------------------------------------------------
# Correctness: same input → identical result (determinism)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_two_calls_same_input_same_result():
    """Deterministic path must return identical results every time.

    Old AI path: temperature=0.1 still has variance.
    New deterministic path: pure DP → zero variance.
    """
    r1 = await evaluate_reading_with_ai(_FANG_SPOKEN, _FANG_TARGET)
    r2 = await evaluate_reading_with_ai(_FANG_SPOKEN, _FANG_TARGET)

    assert r1["adjusted_match_rate"] == r2["adjusted_match_rate"], (
        f"Non-deterministic scores: {r1['adjusted_match_rate']} vs {r2['adjusted_match_rate']}"
    )
    assert r1["tier"] == r2["tier"], "Tier must be deterministic"


# ---------------------------------------------------------------------------
# evaluation_method: must be "deterministic" (not "ai" or "fallback")
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_evaluation_method_is_deterministic():
    """After fix: evaluation_method must be 'deterministic'.

    "ai"          → old Gemini diff path (bugs)
    "fallback"    → same DP aligner triggered by Gemini exception (pre-fix, indirect)
    "deterministic" → DP aligner called directly (post-fix, primary path)
    """
    result = await evaluate_reading_with_ai(_FANG_SPOKEN, _FANG_TARGET)
    assert result["evaluation_method"] == "deterministic", (
        f"Expected 'deterministic', got '{result['evaluation_method']}'. "
        f"'ai' means fix not applied. 'fallback' means DP is used but via exception path."
    )


# ---------------------------------------------------------------------------
# Long text: no truncation, complete diff_tokens
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_long_text_complete_diff_tokens():
    """Long text (120+ normalized chars) must produce complete diff_tokens.

    Old AI path: even with dynamic max_tokens=4096, JSON truncation was possible.
    New deterministic path: DP aligner has no token limit — always complete.

    Note: _normalize_text() strips punctuation before alignment.
    diff_tokens covers normalized chars, not raw chars with punctuation.
    """
    result = await evaluate_reading_with_ai(_LONG_TARGET, _LONG_TARGET)
    adj = result["adjusted_match_rate"]
    diff_tokens = result["diff_tokens"]

    assert adj >= 0.99, f"Long-text perfect reading must score ~100%. Got {adj}"

    # Count target-side tokens (not extra spoken chars).
    # Normalized length (punctuation stripped) is the correct baseline.
    normalized_len = len(_normalize_text(_LONG_TARGET))
    target_tokens = [t for t in diff_tokens if t["type"] in ("correct", "forgiven", "wrong", "missing")]
    assert len(target_tokens) == normalized_len, (
        f"diff_tokens must cover exactly the normalized target length. "
        f"Got {len(target_tokens)} tokens for {normalized_len} normalized chars "
        f"({len(_LONG_TARGET)} raw chars before punctuation removal)."
    )


# ---------------------------------------------------------------------------
# Regression: existing safety invariants must still hold
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_empty_spoken_still_fails():
    """Empty spoken must still not pass — regression guard on safety invariant."""
    result = await evaluate_reading_with_ai("", _SHORT_TARGET)
    assert result["adjusted_match_rate"] < Thresholds.READING_PASS, (
        f"Empty spoken must not pass. Got {result['adjusted_match_rate']}"
    )


@pytest.mark.asyncio
async def test_completely_wrong_reading_still_fails():
    """Unrelated spoken text must still not pass — regression guard."""
    result = await evaluate_reading_with_ai("天空飛翔白雲朵朵彩虹", _SHORT_TARGET)
    assert result["adjusted_match_rate"] < Thresholds.READING_PASS, (
        f"Completely wrong reading must not pass. Got {result['adjusted_match_rate']}"
    )
