"""
TDD tests for reading_evaluation_service.py (Issue #454)

Run with:  cd backend && pytest tests/test_reading_evaluation_service.py -v

Red phase: all tests should FAIL before the service is implemented.
Green phase: all tests should PASS after implementation.
"""
import sys
import os
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.reading_evaluation_service import (
    evaluate_reading_with_ai,
    _apply_short_text_compensation,
    _build_fallback_result,
    _calculate_tier,
    _normalize_text,
)
from app.services.persona import Thresholds


# ---------------------------------------------------------------------------
# _normalize_text
# ---------------------------------------------------------------------------

def test_normalize_removes_punctuation():
    result = _normalize_text("他們，去公園！")
    assert "，" not in result
    assert "！" not in result
    assert "他們去公園" == result


def test_normalize_strips_whitespace():
    result = _normalize_text("  他們 去  ")
    assert result == "他們去"


def test_normalize_strips_bopomofo():
    result = _normalize_text("你好ㄋㄧˇㄏㄠˇ")
    assert result == "你好"


# ---------------------------------------------------------------------------
# _apply_short_text_compensation
# ---------------------------------------------------------------------------

def test_short_text_compensation_long_text():
    """No compensation for long texts (> 10 chars)."""
    base = Thresholds.READING_PASS
    result = _apply_short_text_compensation(base, 15)
    assert result == base


def test_short_text_compensation_medium_text():
    """≤10 chars: READING_PASS decreases by 0.1."""
    base = Thresholds.READING_PASS  # 0.60
    result = _apply_short_text_compensation(base, 8)
    assert abs(result - (base - 0.1)) < 0.001


def test_short_text_compensation_very_short():
    """≤5 chars: READING_PASS decreases by 0.2."""
    base = Thresholds.READING_PASS  # 0.60
    result = _apply_short_text_compensation(base, 4)
    assert abs(result - (base - 0.2)) < 0.001


def test_short_text_compensation_floor_zero():
    """Threshold should not go below 0."""
    result = _apply_short_text_compensation(0.1, 3)
    assert result >= 0.0


# ---------------------------------------------------------------------------
# _calculate_tier
# ---------------------------------------------------------------------------

def test_tier_excellent():
    tier = _calculate_tier(0.90, Thresholds.READING_PASS, Thresholds.READING_EXCELLENT)
    assert tier == 1


def test_tier_pass():
    tier = _calculate_tier(0.70, Thresholds.READING_PASS, Thresholds.READING_EXCELLENT)
    assert tier == 2


def test_tier_fail():
    tier = _calculate_tier(0.40, Thresholds.READING_PASS, Thresholds.READING_EXCELLENT)
    assert tier == 3


def test_tier_at_excellent_boundary():
    tier = _calculate_tier(0.80, Thresholds.READING_PASS, Thresholds.READING_EXCELLENT)
    assert tier == 1


def test_tier_at_pass_boundary():
    tier = _calculate_tier(0.60, Thresholds.READING_PASS, Thresholds.READING_EXCELLENT)
    assert tier == 2


# ---------------------------------------------------------------------------
# _build_fallback_result
# ---------------------------------------------------------------------------

def test_fallback_result_structure():
    result = _build_fallback_result(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
    )
    assert "match_rate" in result
    assert "adjusted_match_rate" in result
    assert "tier" in result
    assert "feedback" in result
    assert "diff_tokens" in result
    assert "stats" in result
    assert "thresholds" in result
    assert result["evaluation_method"] == "fallback"


def test_fallback_result_match_rate_range():
    result = _build_fallback_result(
        spoken_text="他們去公園玩耍",
        target_text="他們去公園玩耍",
    )
    assert 0.0 <= result["match_rate"] <= 1.0
    assert 0.0 <= result["adjusted_match_rate"] <= 1.0


def test_fallback_exact_match():
    result = _build_fallback_result(
        spoken_text="他們去公園玩耍",
        target_text="他們去公園玩耍",
    )
    assert result["match_rate"] >= 0.9
    assert result["tier"] in (1, 2)


def test_fallback_diff_tokens_list():
    result = _build_fallback_result(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
    )
    assert isinstance(result["diff_tokens"], list)
    for token in result["diff_tokens"]:
        assert "char" in token
        assert "type" in token


def test_fallback_stats_keys():
    result = _build_fallback_result(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
    )
    stats = result["stats"]
    assert "correct_count" in stats
    assert "forgiven_count" in stats
    assert "wrong_count" in stats
    assert "missing_count" in stats
    assert "extra_count" in stats


# ---------------------------------------------------------------------------
# evaluate_reading_with_ai — AI path (mocked)
# ---------------------------------------------------------------------------

MOCK_AI_RESPONSE = {
    "diff_tokens": [
        {"char": "他", "type": "correct"},
        {"char": "們", "type": "forgiven", "spoken": "門", "reason": "同音字"},
        {"char": "去", "type": "correct"},
        {"char": "公", "type": "forgiven", "spoken": "工", "reason": "同音字"},
        {"char": "園", "type": "correct"},
        {"char": "玩", "type": "forgiven", "spoken": "完", "reason": "同音字"},
        {"char": "耍", "type": "forgiven", "spoken": "刷", "reason": "近音字"},
    ],
    "feedback": "唸得很棒！下一段。",
}


@pytest.mark.asyncio
async def test_ai_path_returns_adjusted_match_rate():
    """AI path: forgiven chars boost adjusted_match_rate vs match_rate."""
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(return_value=MOCK_AI_RESPONSE),
    ):
        result = await evaluate_reading_with_ai(
            spoken_text="他門去工園完刷",
            target_text="他們去公園玩耍",
        )
    assert result["evaluation_method"] == "ai"
    assert result["adjusted_match_rate"] > result["match_rate"]


@pytest.mark.asyncio
async def test_ai_path_response_structure():
    """AI path result has all required keys."""
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(return_value=MOCK_AI_RESPONSE),
    ):
        result = await evaluate_reading_with_ai(
            spoken_text="他門去工園完刷",
            target_text="他們去公園玩耍",
        )
    for key in ("match_rate", "adjusted_match_rate", "tier", "feedback",
                "diff_tokens", "stats", "thresholds", "evaluation_method"):
        assert key in result, f"Missing key: {key}"


@pytest.mark.asyncio
async def test_ai_path_tier_calculated_from_adjusted():
    """Tier is based on adjusted_match_rate, not raw match_rate."""
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(return_value=MOCK_AI_RESPONSE),
    ):
        result = await evaluate_reading_with_ai(
            spoken_text="他門去工園完刷",
            target_text="他們去公園玩耍",
        )
    # 3 correct + 4 forgiven = 7/7 → adjusted 1.0 → tier 1
    assert result["tier"] == 1
    assert result["adjusted_match_rate"] == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_ai_path_stats_counts():
    """Stats counts match diff_tokens content."""
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(return_value=MOCK_AI_RESPONSE),
    ):
        result = await evaluate_reading_with_ai(
            spoken_text="他門去工園完刷",
            target_text="他們去公園玩耍",
        )
    stats = result["stats"]
    assert stats["correct_count"] == 3
    assert stats["forgiven_count"] == 4
    assert stats["wrong_count"] == 0


@pytest.mark.asyncio
async def test_ai_path_cpm_calculated_with_duration():
    """CPM is calculated when duration_ms is provided."""
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(return_value=MOCK_AI_RESPONSE),
    ):
        result = await evaluate_reading_with_ai(
            spoken_text="他門去工園完刷",
            target_text="他們去公園玩耍",
            duration_ms=5000,  # 5 seconds → 7 chars * 60/5 = 84 cpm
        )
    assert result["cpm"] is not None
    assert result["cpm"] > 0


@pytest.mark.asyncio
async def test_ai_path_no_cpm_without_duration():
    """CPM is None when duration_ms is not provided."""
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(return_value=MOCK_AI_RESPONSE),
    ):
        result = await evaluate_reading_with_ai(
            spoken_text="他門去工園完刷",
            target_text="他們去公園玩耍",
        )
    assert result["cpm"] is None


@pytest.mark.asyncio
async def test_ai_path_thresholds_in_response():
    """Thresholds are returned for frontend use."""
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(return_value=MOCK_AI_RESPONSE),
    ):
        result = await evaluate_reading_with_ai(
            spoken_text="他門去工園完刷",
            target_text="他們去公園玩耍",
        )
    assert "reading_pass" in result["thresholds"]
    assert "reading_excellent" in result["thresholds"]


@pytest.mark.asyncio
async def test_ai_path_uses_dynamic_max_tokens_for_long_text():
    """Long targets should request a larger token budget than 1024."""
    long_target = "天" * 120
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(return_value={"diff_tokens": [], "feedback": "加油"}),
    ) as mocked_generate:
        await evaluate_reading_with_ai(
            spoken_text=long_target,
            target_text=long_target,
        )

    kwargs = mocked_generate.await_args.kwargs
    assert "max_tokens" in kwargs
    assert kwargs["max_tokens"] > 1024
    assert kwargs["max_tokens"] <= 4096


# ---------------------------------------------------------------------------
# evaluate_reading_with_ai — fallback on AI error
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fallback_on_ai_exception():
    """AI failure triggers fallback; evaluation_method = 'fallback'."""
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(side_effect=RuntimeError("Gemini unavailable")),
    ):
        result = await evaluate_reading_with_ai(
            spoken_text="他門去工園完刷",
            target_text="他們去公園玩耍",
        )
    assert result["evaluation_method"] == "fallback"
    assert "tier" in result


@pytest.mark.asyncio
async def test_fallback_does_not_auto_pass():
    """Fallback for zero-match input must NOT produce tier 1."""
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(side_effect=RuntimeError("Gemini unavailable")),
    ):
        result = await evaluate_reading_with_ai(
            spoken_text="aaaaa",
            target_text="他們去公園玩耍",
        )
    # Completely wrong input should not produce tier 1
    assert result["tier"] != 1


# ---------------------------------------------------------------------------
# Short paragraph compensation via evaluate_reading_with_ai
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_short_text_lowers_pass_threshold():
    """Short target (≤10 chars) lowers the effective pass threshold in thresholds."""
    with patch(
        "app.services.reading_evaluation_service.generate_structured_response",
        new=AsyncMock(return_value=MOCK_AI_RESPONSE),
    ):
        result = await evaluate_reading_with_ai(
            spoken_text="他門去",
            target_text="他們去",  # 3 chars → very short
        )
    effective_pass = result["thresholds"]["reading_pass"]
    assert effective_pass < Thresholds.READING_PASS
