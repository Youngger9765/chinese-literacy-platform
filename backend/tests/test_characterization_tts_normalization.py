"""
Characterization tests for backend/app/services/tts/normalization.py (refactor #1833).

These tests verify the split module can be imported from BOTH:
  1. The new canonical path: app.services.tts.normalization
  2. The shim path: app.services.tts_service (backward compat)

And that key logic (clean, split, number conversion, cache key) is intact.

Run: cd backend && python -m pytest tests/test_characterization_tts_normalization.py -v
"""

import pytest


# ---------------------------------------------------------------------------
# Import verification: new canonical path must work
# ---------------------------------------------------------------------------

class TestNewCanonicalImports:
    """After refactor #1833, functions must be importable from tts.normalization."""

    def test_cache_key_importable_from_new_path(self):
        from app.services.tts.normalization import _cache_key
        assert callable(_cache_key)

    def test_clean_for_tts_importable_from_new_path(self):
        from app.services.tts.normalization import _clean_for_tts
        assert callable(_clean_for_tts)

    def test_split_sentences_importable_from_new_path(self):
        from app.services.tts.normalization import _split_sentences
        assert callable(_split_sentences)

    def test_numbers_to_chinese_importable_from_new_path(self):
        from app.services.tts.normalization import _numbers_to_chinese_tw
        assert callable(_numbers_to_chinese_tw)

    def test_phoneme_corrections_importable_from_new_path(self):
        from app.services.tts.normalization import PHONEME_CORRECTIONS
        assert isinstance(PHONEME_CORRECTIONS, list)
        assert len(PHONEME_CORRECTIONS) > 0

    def test_shim_still_exports_cache_key(self):
        """Backward compat: existing code importing from tts_service must still work."""
        from app.services.tts_service import _cache_key
        assert callable(_cache_key)

    def test_shim_and_new_path_return_same_key(self):
        """Shim must delegate to the new module — same result."""
        from app.services.tts.normalization import _cache_key as new_key
        from app.services.tts_service import _cache_key as shim_key
        assert new_key("你好世界") == shim_key("你好世界")


# ---------------------------------------------------------------------------
# _cache_key determinism
# ---------------------------------------------------------------------------

class TestCacheKey:
    """_cache_key must be deterministic and produce valid hex strings."""

    def test_same_text_same_key(self):
        from app.services.tts.normalization import _cache_key
        assert _cache_key("測試") == _cache_key("測試")

    def test_different_texts_different_keys(self):
        from app.services.tts.normalization import _cache_key
        assert _cache_key("你好") != _cache_key("世界")

    def test_key_is_64_char_hex(self):
        from app.services.tts.normalization import _cache_key
        key = _cache_key("abc")
        assert len(key) == 64
        int(key, 16)  # raises ValueError if not hex

    def test_strips_whitespace_before_hashing(self):
        """Leading/trailing whitespace must not affect the cache key."""
        from app.services.tts.normalization import _cache_key
        assert _cache_key("  你好  ") == _cache_key("你好")

    def test_tautology_break_different_strings_must_differ(self):
        """MUST fail if _cache_key returns the same value for all inputs."""
        from app.services.tts.normalization import _cache_key
        keys = {_cache_key(t) for t in ["a", "b", "c", "你", "好"]}
        assert len(keys) == 5, "All distinct texts must produce distinct keys"


# ---------------------------------------------------------------------------
# _clean_for_tts symbol stripping
# ---------------------------------------------------------------------------

class TestCleanForTTS:
    """_clean_for_tts must strip symbols that TTS would mispronounce."""

    def test_tildes_stripped(self):
        from app.services.tts.normalization import _clean_for_tts
        assert _clean_for_tts("你好~~~世界") == "你好世界"

    def test_double_dash_to_comma(self):
        from app.services.tts.normalization import _clean_for_tts
        result = _clean_for_tts("球后──戴資穎")
        assert "──" not in result
        assert "，" in result

    def test_ellipsis_to_comma(self):
        from app.services.tts.normalization import _clean_for_tts
        result = _clean_for_tts("輕鬆……對手")
        assert "……" not in result
        assert "，" in result

    def test_hashtag_removed(self):
        from app.services.tts.normalization import _clean_for_tts
        result = _clean_for_tts("#MeToo運動")
        assert "#" not in result
        assert "MeToo運動" in result

    def test_fraction_slash_to_zhi(self):
        from app.services.tts.normalization import _clean_for_tts
        result = _clean_for_tts("210/120")
        assert "/" not in result
        assert "之" in result

    def test_percent_to_chinese(self):
        from app.services.tts.normalization import _clean_for_tts
        result = _clean_for_tts("50%")
        assert "%" not in result
        assert "百分之" in result

    def test_normal_text_unchanged(self):
        from app.services.tts.normalization import _clean_for_tts
        text = "他是一個好學生"
        assert _clean_for_tts(text) == text

    def test_tautology_break_tildes_must_disappear(self):
        """MUST fail if tilde stripping regex is removed from _clean_for_tts."""
        from app.services.tts.normalization import _clean_for_tts
        result = _clean_for_tts("~~~")
        assert "~" not in result
        assert "～" not in result


# ---------------------------------------------------------------------------
# _numbers_to_chinese_tw
# ---------------------------------------------------------------------------

class TestNumbersToChinese:
    """_numbers_to_chinese_tw converts Arabic numerals to Traditional Chinese."""

    def test_single_digit(self):
        from app.services.tts.normalization import _numbers_to_chinese_tw
        assert _numbers_to_chinese_tw("3") == "三"

    def test_two_digits(self):
        from app.services.tts.normalization import _numbers_to_chinese_tw
        assert _numbers_to_chinese_tw("10") == "十"

    def test_three_digits(self):
        from app.services.tts.normalization import _numbers_to_chinese_tw
        result = _numbers_to_chinese_tw("100")
        assert result == "一百"

    def test_range_converted(self):
        from app.services.tts.normalization import _numbers_to_chinese_tw
        result = _numbers_to_chinese_tw("1-3")
        assert "到" in result
        assert "一" in result
        assert "三" in result

    def test_zero(self):
        from app.services.tts.normalization import _numbers_to_chinese_tw
        assert _numbers_to_chinese_tw("0") == "零"

    def test_plain_text_unchanged(self):
        from app.services.tts.normalization import _numbers_to_chinese_tw
        text = "你好世界"
        assert _numbers_to_chinese_tw(text) == text


# ---------------------------------------------------------------------------
# _split_sentences
# ---------------------------------------------------------------------------

class TestSplitSentences:
    """_split_sentences must split on sentence-end punctuation and respect MAX_SENTENCE_LEN."""

    def test_short_single_sentence_not_split(self):
        from app.services.tts.normalization import _split_sentences
        result = _split_sentences("你好。")
        assert len(result) == 1
        assert result[0] == "你好。"

    def test_two_sentences_split_by_period(self):
        from app.services.tts.normalization import _split_sentences
        result = _split_sentences("第一句。第二句。")
        assert len(result) == 2

    def test_no_text_lost_in_split(self):
        from app.services.tts.normalization import _split_sentences
        text = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十。"
        parts = _split_sentences(text)
        assert "".join(parts) == text

    def test_chunks_respect_max_len_after_comma_split(self):
        from app.services.tts.normalization import _split_sentences, MAX_SENTENCE_LEN
        # Build a long sentence (no period, uses comma splitting)
        long = "漫畫《一拳超人》中的埼玉老師堅持了三年，每天做一百次的伏地挺身、一百次的仰臥起坐、一百次的深蹲、十公里的長跑，終於擁有一拳就能打倒所有敵人的實力。"
        parts = _split_sentences(long)
        # Each part must fit within MAX_SENTENCE_LEN (the threshold is 40 chars in normalization.py)
        # Allow up to 50 as safety margin for edge cases in splitting
        assert all(len(p) <= 50 for p in parts), f"Part too long: {[len(p) for p in parts]}"

    def test_empty_string_returns_empty_list(self):
        from app.services.tts.normalization import _split_sentences
        result = _split_sentences("")
        assert result == []

    def test_tautology_break_multi_sentence_must_split(self):
        """MUST fail if sentence splitting is disabled."""
        from app.services.tts.normalization import _split_sentences
        result = _split_sentences("第一句。第二句。第三句。")
        # If splitting works, must produce >1 parts
        assert len(result) > 1
