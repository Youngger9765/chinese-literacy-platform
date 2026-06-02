from __future__ import annotations

import hashlib
import logging
import re

logger = logging.getLogger(__name__)

PHONEME_CORRECTIONS: list[tuple[str, str]] = [
    (
        "喝采",
        '<phoneme alphabet="x-microsoft-zhuyin" ph="ㄏㄜˋ">喝</phoneme>采',
    ),
    (
        "喝彩",
        '<phoneme alphabet="x-microsoft-zhuyin" ph="ㄏㄜˋ">喝</phoneme>彩',
    ),
    (
        "打的漂亮",
        '打<phoneme alphabet="x-microsoft-zhuyin" ph="˙ㄉㄜ">的</phoneme>漂亮',
    ),
    (
        "打得漂亮",
        '打<phoneme alphabet="x-microsoft-zhuyin" ph="˙ㄉㄜ">得</phoneme>漂亮',
    ),
]

_PHONEME_CORRECTIONS = PHONEME_CORRECTIONS

MAX_SENTENCE_LEN = 40


def _apply_phoneme_corrections(text_escaped: str) -> str:
    result = text_escaped
    for pattern, replacement in PHONEME_CORRECTIONS:
        if pattern in result:
            result = result.replace(pattern, replacement)
            logger.debug("Phoneme correction applied: %r → %r", pattern, replacement)
    return result


def _has_phoneme_corrections(text: str) -> bool:
    return any(pattern in text for pattern, _ in PHONEME_CORRECTIONS)


def _clean_for_tts(text: str) -> str:
    text = re.sub(r'[~～]+', '', text)
    text = re.sub(r'[──—–−]{1,}', '，', text)
    text = re.sub(r'-{2,}', '，', text)
    text = re.sub(r'[.]{3,}|[…⋯]+', '，', text)
    text = re.sub(r'#', '', text)
    text = re.sub(r'(\d+)/(\d+)', r'\1 之 \2', text)
    text = re.sub(r'[/\\|]+', '', text)
    text = re.sub(r'[\*\[\]\{\}]+', '', text)
    text = re.sub(r'[·‧・°○]+', '', text)
    text = re.sub(r'%', '百分之', text)
    text = re.sub(r'[\uf410\U000E01E0-\U000E01E4]+', '', text)
    text = re.sub(r'，{2,}', '，', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _cache_key(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


def _numbers_to_chinese_tw(text: str) -> str:
    def _int_to_tw(n: int) -> str:
        if n == 0:
            return "零"
        if n < 0:
            return "負" + _int_to_tw(-n)
        digits = "零一二三四五六七八九"
        result = ""
        if n >= 10000:
            wan = n // 10000
            result += (_int_to_tw(wan) if wan > 1 else "一") + "萬"
            n %= 10000
            if 0 < n < 1000:
                result += "零"
        if n >= 1000:
            qian = n // 1000
            result += ("兩" if qian == 2 else digits[qian]) + "千"
            n %= 1000
            if 0 < n < 100:
                result += "零"
        if n >= 100:
            bai = n // 100
            result += ("兩" if bai == 2 else digits[bai]) + "百"
            n %= 100
            if 0 < n < 10:
                result += "零"
        if n >= 10:
            shi = n // 10
            result += ("十" if shi == 1 and not result else digits[shi] + "十")
            n %= 10
        if n > 0:
            result += digits[n]
        return result

    def _replace_number(m: re.Match) -> str:
        raw = m.group(0)
        range_m = re.fullmatch(r"(\d+)-(\d+)", raw)
        if range_m:
            a, b = int(range_m.group(1)), int(range_m.group(2))
            return _int_to_tw(a) + "到" + _int_to_tw(b)
        decimal_m = re.fullmatch(r"(\d+)\.(\d+)", raw)
        if decimal_m:
            int_part = _int_to_tw(int(decimal_m.group(1)))
            frac_part = "".join("零一二三四五六七八九"[int(d)] for d in decimal_m.group(2))
            return int_part + "點" + frac_part
        return _int_to_tw(int(raw))

    return re.sub(r"\d+(?:[.\-]\d+)?", _replace_number, text)


def _split_sentences(text: str) -> list[str]:
    parts = re.split(r'(?<=[。！？\n])', text)
    sentences = [s.strip() for s in parts if s.strip()]

    result: list[str] = []
    for s in sentences:
        if len(s) <= MAX_SENTENCE_LEN:
            result.append(s)
        else:
            sub = re.split(r'(?<=[，、；：」）])', s)
            chunk = ""
            for part in sub:
                if len(chunk) + len(part) > MAX_SENTENCE_LEN and chunk:
                    result.append(chunk)
                    chunk = part
                else:
                    chunk += part
            if chunk:
                result.append(chunk)
    return result
