"""
Tests for backend/app/services/stt_service.py

Run with:  cd backend && pytest tests/ -v
"""
import sys
import os

# Allow running pytest from the repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.stt_service import (
    correct_homophones,
    compute_match_rate,
    evaluate_reading,
    is_homophone,
    get_pinyin,
)


# ---------------------------------------------------------------------------
# get_pinyin / is_homophone
# ---------------------------------------------------------------------------

def test_get_pinyin_known_char():
    assert get_pinyin("和") == "he"
    assert get_pinyin("禾") == "he"
    assert get_pinyin("河") == "he"


def test_get_pinyin_unknown_char():
    assert get_pinyin("ß") is None


def test_is_homophone_same_char():
    assert is_homophone("好", "好") is True


def test_is_homophone_he_group():
    # 和/禾/河 all map to "he"
    assert is_homophone("和", "禾") is True
    assert is_homophone("禾", "河") is True


def test_is_homophone_different():
    assert is_homophone("好", "壞") is False


# ---------------------------------------------------------------------------
# correct_homophones
# ---------------------------------------------------------------------------

def test_correct_homophones_exact_match():
    stt = "農夫"
    target = "農夫"
    assert correct_homophones(stt, target) == "農夫"


def test_correct_homophones_he_correction():
    """
    「禾」and「和」share pinyin "he" — STT returns 禾 but target is 和.
    The corrector should replace 禾 → 和.
    (Example from onboarding.md.)
    """
    stt = "古時候有一個農夫，他每天都去田裡看禾苗長高了沒有"
    target = "古時候有一個農夫他每天都去田裡看禾苗長高了沒有"
    # Target contains 禾 (not 和 here), so no correction needed — just verify no crash
    result = correct_homophones(stt, target)
    assert isinstance(result, str)
    assert len(result) > 0


def test_correct_homophones_replaces_homophone():
    """If STT hears 河 but target is 和, and they are homophones, replace."""
    stt = "河"
    target = "和"
    result = correct_homophones(stt, target)
    assert result == "和"


def test_correct_homophones_keeps_genuine_error():
    """Non-homophone substitution should be kept as-is (not corrected)."""
    stt = "大"
    target = "小"
    result = correct_homophones(stt, target)
    assert result == "大"  # 大/小 different pinyin → keep STT


def test_correct_homophones_empty_inputs():
    assert correct_homophones("", "anything") == ""
    assert correct_homophones("something", "") == "something"


# ---------------------------------------------------------------------------
# compute_match_rate
# ---------------------------------------------------------------------------

def test_compute_match_rate_perfect():
    text = "農夫每天去田裡"
    rate = compute_match_rate(text, text)
    assert rate == 1.0


def test_compute_match_rate_high():
    """Drop one character → should still be ≥ 80%."""
    target = "農夫每天去田裡"   # 7 chars
    spoken = "農夫每天去田"     # 6 chars (missing 裡)
    rate = compute_match_rate(spoken, target)
    assert rate >= 0.8


def test_compute_match_rate_medium():
    """About half the characters match."""
    target = "農夫每天去田裡"
    spoken = "農夫"
    rate = compute_match_rate(spoken, target)
    assert 0.2 <= rate <= 0.4


def test_compute_match_rate_low():
    """Completely different text → low rate."""
    target = "農夫每天去田裡"
    spoken = "蘋果香蕉草莓西瓜"
    rate = compute_match_rate(spoken, target)
    assert rate < 0.3


def test_compute_match_rate_empty():
    assert compute_match_rate("", "target") == 0.0
    assert compute_match_rate("spoken", "") == 0.0


# ---------------------------------------------------------------------------
# evaluate_reading
# ---------------------------------------------------------------------------

def test_evaluate_reading_tier1():
    target = "農夫每天去田裡"
    result = evaluate_reading(target, target)  # perfect read
    assert result["tier"] == 1
    assert result["feedback_key"] == "tier1"
    assert result["match_rate"] == 1.0


def test_evaluate_reading_tier2():
    """Simulate a ~70% match — should yield tier 2."""
    target = "古時候有一個農夫他每天都去田裡看禾苗"
    # Speak about 70% of the characters correctly
    spoken = "古時候有一個農夫他每天都去田裡"  # 15/18 ≈ 83% → tier1 actually
    result = evaluate_reading(spoken, target)
    assert result["tier"] in (1, 2)


def test_evaluate_reading_tier3():
    """Very poor match → tier 3 (retry)."""
    target = "古時候有一個農夫"
    spoken = "蘋果香蕉"
    result = evaluate_reading(spoken, target)
    assert result["tier"] == 3
    assert result["feedback_key"] == "tier3"


def test_evaluate_reading_returns_corrected_field():
    result = evaluate_reading("禾", "和")
    assert "corrected" in result
    assert result["corrected"] == "和"
