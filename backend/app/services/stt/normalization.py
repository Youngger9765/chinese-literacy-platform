"""
Text normalization utilities for STT evaluation.

Shared by algorithm.py and reading_evaluation_service.py.
"""

import re

_BOPOMOFO_RE = re.compile(r"[\u3100-\u312F\u31A0-\u31BF\u02CA\u02C7\u02CB\u02D9]")
_PUNCTUATION_RE = re.compile(
    r"[「」『』，。！？：；、．…—－\-（）()\[\]《》""'']"
    + r"[\s,.!?;:'\"]"
)
_NUMERAL_MAP = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]


def _int_to_chinese(n: int) -> str:
    """Convert a non-negative integer to its Chinese numeral string."""
    if n == 0:
        return "零"
    result = ""
    if n >= 100_000_000:
        result += _int_to_chinese(n // 100_000_000) + "億"
        n %= 100_000_000
        if 0 < n < 10_000_000:
            result += "零"
    if n >= 10_000:
        result += _int_to_chinese(n // 10_000) + "萬"
        n %= 10_000
        if 0 < n < 1_000:
            result += "零"
    if n >= 1_000:
        result += _NUMERAL_MAP[n // 1_000] + "千"
        n %= 1_000
        if 0 < n < 100:
            result += "零"
    if n >= 100:
        result += _NUMERAL_MAP[n // 100] + "百"
        n %= 100
        if 0 < n < 10:
            result += "零"
    if n >= 10:
        tens = n // 10
        if tens > 1 or result:
            result += _NUMERAL_MAP[tens]
        result += "十"
        n %= 10
    if n > 0:
        result += _NUMERAL_MAP[n]
    return result


def normalize_numbers(text: str) -> str:
    """Replace Arabic numerals with Chinese numeral equivalents."""
    return re.sub(r"\d+", lambda m: _int_to_chinese(int(m.group())), text)


def normalize_for_comparison(text: str) -> str:
    """Strip punctuation, bopomofo, whitespace; convert numerals for alignment."""
    stripped = _PUNCTUATION_RE.sub("", normalize_numbers(text))
    return _BOPOMOFO_RE.sub("", stripped)
