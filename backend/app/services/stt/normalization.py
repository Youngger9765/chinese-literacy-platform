"""
Text normalization utilities for STT evaluation.

Shared by algorithm.py and reading_evaluation_service.py.
Parity with frontend textDiff.ts normalizeForComparison pipeline.
"""

import re

_BOPOMOFO_RE = re.compile(r"[\u3100-\u312F\u31A0-\u31BF\u02CA\u02C7\u02CB\u02D9]")
# Use unicode escapes for curly quotes — raw-string ""'' breaks the character class.
_PUNCTUATION_RE = re.compile(
    r"[「」『』，。！？：；、．…—－\-（）()\[\]《》"
    r"\u201c\u201d\u2018\u2019"
    r"\s,.!?;:'\"]"
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


def normalize_fullwidth_digits(text: str) -> str:
    """Full-width ０-９ → half-width 0-9 before Arabic→Chinese numeral conversion."""
    out: list[str] = []
    for ch in text:
        o = ord(ch)
        if 0xFF10 <= o <= 0xFF19:
            out.append(chr(ord("0") + o - 0xFF10))
        else:
            out.append(ch)
    return "".join(out)


def normalize_numbers(text: str) -> str:
    """Replace Arabic numerals with Chinese numeral equivalents."""
    return re.sub(r"\d+", lambda m: _int_to_chinese(int(m.group())), text)


def normalize_punctuation_to_chinese(text: str) -> str:
    """Half-width STT punctuation → full-width Chinese (matches frontend)."""
    return (
        text.replace(",", "，")
        .replace(";", "；")
        .replace(".", "。")
        .replace("?", "？")
        .replace("!", "！")
        .replace(":", "：")
        .replace("(", "（")
        .replace(")", "）")
        .replace(" ", "")
    )


def _strip_decorative_symbols(text: str) -> str:
    t = re.sub(r"~+", "", text)
    t = t.replace("…", "").replace("...", "").replace("．．．", "")
    t = t.replace("——", "").replace("—", "").replace("－", "").replace("-", "")
    for ch in "「」『』《》[]【】\"'\u201c\u201d\u2018\u2019":
        t = t.replace(ch, "")
    t = re.sub(r"（[^）]*）", "", t)
    t = re.sub(r"\([^)]*\)", "", t)
    return t


def normalize_chinese_number_variants(text: str) -> str:
    """兩 → 二 for spoken-number alignment (matches frontend)."""
    return text.replace("兩", "二")


def normalize_for_comparison(text: str) -> str:
    """Strip punctuation, bopomofo, whitespace; convert numerals for alignment."""
    pipeline = normalize_fullwidth_digits(normalize_punctuation_to_chinese(text))
    pipeline = _strip_decorative_symbols(pipeline)
    pipeline = normalize_chinese_number_variants(normalize_numbers(pipeline))
    stripped = _PUNCTUATION_RE.sub("", pipeline)
    return _BOPOMOFO_RE.sub("", stripped)
