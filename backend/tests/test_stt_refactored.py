"""
Characterization tests for the refactored stt package.

These tests verify that the new module layout exports the same public API
as the original stt_service.py and that behaviour is preserved.

RED phase: these tests will FAIL before the stt/ package is created.
GREEN phase: pass after the package is in place.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ---- Import from the NEW package structure (RED: will fail before creation) ----
from app.services.stt.pinyin import get_pinyin, is_homophone
from app.services.stt.normalization import (
    normalize_for_comparison,
    normalize_numbers,
)
from app.services.stt.algorithm import correct_homophones, compute_match_rate
from app.services.stt.evaluate import evaluate_reading, Tier, FEEDBACK_KEYS


# ---------------------------------------------------------------------------
# pinyin module
# ---------------------------------------------------------------------------

def test_pinyin_get_pinyin_known():
    assert get_pinyin("和") == "he"
    assert get_pinyin("禾") == "he"
    assert get_pinyin("農") == "nong"


def test_pinyin_get_pinyin_unknown():
    assert get_pinyin("ß") is None


def test_pinyin_is_homophone_same():
    assert is_homophone("好", "好") is True


def test_pinyin_is_homophone_he_group():
    assert is_homophone("和", "禾") is True
    assert is_homophone("河", "禾") is True


def test_pinyin_is_homophone_different():
    assert is_homophone("好", "壞") is False


# ---------------------------------------------------------------------------
# normalization module
# ---------------------------------------------------------------------------

def test_normalize_numbers_arabic_to_chinese():
    assert normalize_numbers("1") == "一"
    assert normalize_numbers("10") == "十"
    assert normalize_numbers("100") == "一百"


def test_normalize_for_comparison_strips_punctuation():
    text = "農夫，每天。去田裡！"
    result = normalize_for_comparison(text)
    assert "，" not in result
    assert "。" not in result
    assert "！" not in result
    assert "農夫" in result


def test_normalize_for_comparison_strips_bopomofo():
    assert normalize_for_comparison("人ㄖㄣˊ") == "人"


def test_normalize_for_comparison_converts_numbers():
    result = normalize_for_comparison("12個")
    assert "12" not in result
    assert "十二" in result


def test_normalize_for_comparison_converts_fullwidth_digits():
    result = normalize_for_comparison("公元前２９９年")
    assert "２" not in result
    assert "二百九十九" in result


# ---------------------------------------------------------------------------
# algorithm module
# ---------------------------------------------------------------------------

def test_algorithm_correct_homophones_exact_match():
    assert correct_homophones("農夫", "農夫") == "農夫"


def test_algorithm_correct_homophones_replaces_homophone():
    # 河 and 和 share pinyin "he"
    assert correct_homophones("河", "和") == "和"


def test_algorithm_correct_homophones_keeps_genuine_error():
    assert correct_homophones("大", "小") == "大"


def test_algorithm_correct_homophones_empty():
    assert correct_homophones("", "anything") == ""
    assert correct_homophones("something", "") == "something"


def test_algorithm_compute_match_rate_perfect():
    text = "農夫每天去田裡"
    assert compute_match_rate(text, text) == 1.0


def test_algorithm_compute_match_rate_partial():
    target = "農夫每天去田裡"
    spoken = "農夫每天去田"  # missing 裡
    rate = compute_match_rate(spoken, target)
    assert 0.7 <= rate <= 1.0


def test_algorithm_compute_match_rate_empty():
    assert compute_match_rate("", "target") == 0.0
    assert compute_match_rate("spoken", "") == 0.0


# ---------------------------------------------------------------------------
# evaluate module
# ---------------------------------------------------------------------------

def test_evaluate_reading_response_shape():
    """Characterization: assert response shape is preserved."""
    result = evaluate_reading("農夫每天去田裡", "農夫每天去田裡")
    assert isinstance(result, dict)
    assert "corrected" in result
    assert "match_rate" in result
    assert "tier" in result
    assert "feedback_key" in result


def test_evaluate_reading_perfect_is_tier1():
    target = "農夫每天去田裡"
    result = evaluate_reading(target, target)
    assert result["tier"] == 1
    assert result["feedback_key"] == "tier1"
    assert result["match_rate"] == 1.0


def test_evaluate_reading_poor_is_tier3():
    result = evaluate_reading("蘋果香蕉", "古時候有一個農夫")
    assert result["tier"] == 3
    assert result["feedback_key"] == "tier3"


def test_evaluate_constants_shape():
    """FEEDBACK_KEYS should map 1/2/3 to string keys."""
    assert FEEDBACK_KEYS[1] == "tier1"
    assert FEEDBACK_KEYS[2] == "tier2"
    assert FEEDBACK_KEYS[3] == "tier3"


# ---------------------------------------------------------------------------
# Backward-compat: stt_service facade still exports everything
# ---------------------------------------------------------------------------

def test_facade_still_exports_all():
    """The thin facade stt_service.py must still export all public symbols."""
    from app.services import stt_service as svc
    assert hasattr(svc, "get_pinyin")
    assert hasattr(svc, "is_homophone")
    assert hasattr(svc, "correct_homophones")
    assert hasattr(svc, "compute_match_rate")
    assert hasattr(svc, "evaluate_reading")
    assert hasattr(svc, "Tier")
    assert hasattr(svc, "FEEDBACK_KEYS")


def test_facade_evaluate_reading_same_result():
    """Facade and direct module must return identical results."""
    from app.services import stt_service as svc
    from app.services.stt.evaluate import evaluate_reading as direct_eval

    target = "農夫每天去田裡"
    spoken = "農夫每天"
    result_facade = svc.evaluate_reading(spoken, target)
    result_direct = direct_eval(spoken, target)
    assert result_facade == result_direct
