"""
TDD tests for reading_evaluation_service.py

History:
  Issue #454 (original): AI path tests using Gemini mock.
  Issue #2266 (2026-06-18): AI path removed. Tests updated to test the
  deterministic DP path directly (no mock needed — no Gemini in the path).

Run with:  cd backend && pytest tests/test_reading_evaluation_service.py -v
"""
import sys
import os

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.reading_evaluation_service import (
    evaluate_reading_with_ai,
    _apply_short_text_compensation,
    _build_fallback_result,
    _calculate_tier,
    _is_near_sound,
    _normalize_text,
)
from app.services.stt_service import is_homophone
from app.services.persona import Thresholds

MENGCHANGJUN_LINE = (
    "中國的戰國時期，有七個國家總是爭強鬥勝、互比苗頭，為了要在競爭中勝出，各國都在搶傑出的管理人才，"
    "其中最有名的人才，就是齊國的孟嘗君。孟嘗君是有錢的貴族，最讓人津津樂道的是他在家裡養了三千名食客，"
    "食客就是在家裡吃飯的客人，三千人開飯的場面一眼望不完，真是非常壯觀。"
    "只要自認為有本事的人來投奔孟嘗君，他二話不說，總是張開雙手歡迎。"
    "這些食客具備各式各樣的才能，可以隨時幫他解決各種問題。"
)


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

# ---------------------------------------------------------------------------
# evaluate_reading_with_ai — deterministic path (Issue #2266)
#
# All tests below replaced from AI-path (Gemini mock) tests to deterministic
# path tests. The homophone case "他門去工園完刷" → "他們去公園玩耍" is
# preserved: 們/門(同音), 公/工(同音), 玩/完(同音), 耍/刷(近音) → all forgiven.
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_deterministic_path_returns_adjusted_match_rate():
    """Deterministic path: evaluation_method is 'deterministic' and result is usable."""
    result = await evaluate_reading_with_ai(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
    )
    assert result["evaluation_method"] == "deterministic"
    # homophones are forgiven → adjusted_match_rate is high
    assert result["adjusted_match_rate"] >= 0.8


@pytest.mark.asyncio
async def test_deterministic_path_response_structure():
    """Deterministic path result has all required keys."""
    result = await evaluate_reading_with_ai(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
    )
    for key in ("match_rate", "adjusted_match_rate", "tier", "feedback",
                "diff_tokens", "stats", "thresholds", "evaluation_method"):
        assert key in result, f"Missing key: {key}"


@pytest.mark.asyncio
async def test_deterministic_path_tier_calculated_from_adjusted():
    """Tier is based on adjusted_match_rate (forgiven chars count)."""
    result = await evaluate_reading_with_ai(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
    )
    # 3 correct + 4 forgiven = 7/7 → adjusted 1.0 → tier 1
    assert result["tier"] == 1
    assert result["adjusted_match_rate"] == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_deterministic_path_stats_counts():
    """Stats counts reflect actual char alignment."""
    result = await evaluate_reading_with_ai(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
    )
    stats = result["stats"]
    assert stats["correct_count"] == 3   # 他, 去, 園
    assert stats["forgiven_count"] == 4  # 們/門, 公/工, 玩/完, 耍/刷
    assert stats["wrong_count"] == 0


@pytest.mark.asyncio
async def test_deterministic_path_cpm_calculated_with_duration():
    """CPM is calculated when duration_ms is provided."""
    result = await evaluate_reading_with_ai(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
        duration_ms=5000,
    )
    assert result["cpm"] is not None
    assert result["cpm"] > 0


# Both CPM tests read "中國的戰國時期" — 7 characters that are a clean prefix of
# the target. That is the exact signature the #2321 sanity gate looks for (a
# short exact prefix under 35% of the target is how STT hallucinates on
# silence), so the call routes to fallback and CPM is None by design. The gate
# was added after these tests; the property they check is still worth checking,
# it just needs input the gate does not claim.
#
# "中國的戰國時期有個人叫做孟嘗君他很喜歡" diverges from the target after a few
# characters, so it reaches the deterministic aligner. Verified against
# _is_hallucination_prefix directly rather than assumed.
_PARTIAL_READ = "中國的戰國時期有個人叫做孟嘗君他很喜歡"


@pytest.mark.asyncio
async def test_deterministic_path_cpm_uses_correct_count_not_full_target():
    """Partial read: CPM uses chars actually matched, not full target length."""
    long_target = MENGCHANGJUN_LINE
    spoken = _PARTIAL_READ
    duration_ms = 60_000
    expected_cpm = round(_build_fallback_result(spoken, long_target)["stats"]["correct_count"] / 60 * 60, 1)

    result = await evaluate_reading_with_ai(
        spoken_text=spoken,
        target_text=long_target,
        duration_ms=duration_ms,
    )
    assert result["cpm"] == expected_cpm
    assert result["cpm"] < len(_normalize_text(long_target)) * 0.5


@pytest.mark.asyncio
async def test_deterministic_path_cpm_matches_fallback_helper():
    """CPM via evaluate_reading_with_ai equals CPM from _build_fallback_result directly."""
    spoken = _PARTIAL_READ
    target = MENGCHANGJUN_LINE
    duration_ms = 60_000

    result = await evaluate_reading_with_ai(
        spoken_text=spoken,
        target_text=target,
        duration_ms=duration_ms,
    )
    assert result["evaluation_method"] == "deterministic"
    preview = _build_fallback_result(spoken, target)
    expected_cpm = round(preview["stats"]["correct_count"] / 60 * 60, 1)
    assert result["cpm"] == expected_cpm


@pytest.mark.asyncio
async def test_deterministic_path_no_cpm_without_duration():
    """CPM is None when duration_ms is not provided."""
    result = await evaluate_reading_with_ai(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
    )
    assert result["cpm"] is None


@pytest.mark.asyncio
async def test_deterministic_path_thresholds_in_response():
    """Thresholds are returned for frontend use."""
    result = await evaluate_reading_with_ai(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
    )
    assert "reading_pass" in result["thresholds"]
    assert "reading_excellent" in result["thresholds"]


@pytest.mark.asyncio
async def test_deterministic_path_long_text_complete():
    """Long texts (120+ chars) return complete results — no truncation risk."""
    long_target = "天" * 120
    result = await evaluate_reading_with_ai(
        spoken_text=long_target,
        target_text=long_target,
    )
    assert result["evaluation_method"] == "deterministic"
    assert result["adjusted_match_rate"] >= 0.99


# ---------------------------------------------------------------------------
# evaluate_reading_with_ai — correctness properties (replaces fallback tests)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_deterministic_path_always_produces_result():
    """Deterministic path never raises — always returns a valid result dict."""
    result = await evaluate_reading_with_ai(
        spoken_text="他門去工園完刷",
        target_text="他們去公園玩耍",
    )
    assert result["evaluation_method"] == "deterministic"
    assert "tier" in result


@pytest.mark.asyncio
async def test_deterministic_path_does_not_auto_pass_wrong_input():
    """Completely wrong input must NOT produce tier 1."""
    result = await evaluate_reading_with_ai(
        spoken_text="aaaaa",
        target_text="他們去公園玩耍",
    )
    assert result["tier"] != 1


# ---------------------------------------------------------------------------
# Short paragraph compensation via evaluate_reading_with_ai
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_short_text_lowers_pass_threshold():
    """Short target (≤10 chars) lowers the effective pass threshold in thresholds."""
    result = await evaluate_reading_with_ai(
        spoken_text="他門去",
        target_text="他們去",  # 3 chars → very short
    )
    effective_pass = result["thresholds"]["reading_pass"]
    assert effective_pass < Thresholds.READING_PASS


# ===========================================================================
# 口音通融分類 golden set (Issue #2566 / #2570 review) — red-green regression
#
# 對齊前端 frontend/src/utils/textDiff.accentTolerance.test.ts：
#   曾教授三類台灣口音（前後鼻音*/捲舌/n·l·r·l）視為「唸對」→ correct（計入
#   correct_count/CPM）；真同音字（is_homophone）仍 forgiven；其餘真念錯仍 wrong。
#   (*前後鼻音因 _is_near_sound 目前只比對開頭抓不到帶聲母者，另立 issue #2572)
# 移除 reading_evaluation_service 的 `elif _is_near_sound: correct` 分支即會紅。
# ===========================================================================


class TestAccentToleranceClassification:
    def test_is_near_sound_detects_three_categories(self):
        assert _is_near_sound("知", "資")   # 捲舌 zh/z
        assert _is_near_sound("是", "四")   # 捲舌 sh/s
        assert _is_near_sound("吃", "詞")   # 捲舌 ch/c
        assert _is_near_sound("你", "李")   # n/l
        assert _is_near_sound("然", "懶")   # r/l（#2570 review 補）

    def test_is_near_sound_excludes_true_homophone(self):
        # 真同音字不是 near-sound（避免把標準開太寬）
        assert not _is_near_sound("在", "再")
        assert is_homophone("在", "再")

    def test_near_sound_classified_correct_into_cpm(self):
        # 知→資（zh/z 口音）+ 道完全相同 → 兩字都 correct、計入 correct_count
        r = _build_fallback_result(spoken_text="資道", target_text="知道")
        assert r["stats"]["correct_count"] == 2
        assert r["stats"]["forgiven_count"] == 0
        assert "forgiven" not in [t["type"] for t in r["diff_tokens"]]

    def test_rl_confusion_classified_correct(self):
        # r/l（#2570 review 新補）：懶→然 應判 correct
        r = _build_fallback_result(spoken_text="懶", target_text="然")
        assert r["stats"]["correct_count"] == 1
        assert r["stats"]["forgiven_count"] == 0

    def test_true_homophone_still_forgiven(self):
        # 負向控制：真同音字（在/再）仍 forgiven，不進 correct_count/CPM
        r = _build_fallback_result(spoken_text="再", target_text="在")
        assert r["stats"]["forgiven_count"] == 1
        assert r["stats"]["correct_count"] == 0

    def test_genuine_mispronunciation_still_wrong(self):
        # 負向控制：非三類的真念錯（馬/知）仍 wrong
        r = _build_fallback_result(spoken_text="馬", target_text="知")
        assert r["stats"]["wrong_count"] == 1
        assert r["stats"]["correct_count"] == 0
        assert r["stats"]["forgiven_count"] == 0


@pytest.mark.asyncio
async def test_hallucination_prefix_blocks_cpm():
    """A silence-hallucinated prefix must not produce a fluency rate.

    The input the two tests above used to send. Keeping it as its own case so
    the #2321 gate has a lock of its own — without this, moving those tests off
    the blocked input would have quietly removed the only coverage it had.
    """
    result = await evaluate_reading_with_ai(
        spoken_text="中國的戰國時期",
        target_text=MENGCHANGJUN_LINE,
        duration_ms=60_000,
    )
    assert result["hallucination_blocked"] is True
    assert result["cpm"] is None, "a blocked read must not report a reading speed"
