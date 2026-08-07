from __future__ import annotations

import hashlib
import logging
import re

logger = logging.getLogger(__name__)

# Azure's SSML endpoint rejects the <phoneme> element outright — HTTP 400,
# empty body — regardless of alphabet (x-microsoft-zhuyin / sapi / ipa / ups
# all 400). Confirmed against the real Azure REST API on 2026-08-08 (#2612).
# We use <sub alias="..."> instead: Azure's documented pronunciation-
# substitution element. Azure synthesizes the alias text verbatim and ignores
# the wrapped content for audio purposes (verified via byte-identical audio
# between `<sub alias="X">Y</sub>` and plain text "X"), so each alias below
# must itself be plain text that a Chinese TTS reads correctly on its own —
# no per-character phoneme control is available anymore.
#
# Do NOT reintroduce <phoneme> here without re-verifying against real Azure
# first (see backend/tests/test_tts_service.py::TestAzureRealAPIPhonemeCorrections).
#
# Matching is first-match-in-list-order, not longest-match (see
# _apply_phoneme_corrections below) — if a future entry's pattern is a
# prefix of an existing one (e.g. adding "喝" before "喝采"), whichever
# is earlier in this list wins and the other never fires. No current
# entry is a prefix of another, so this doesn't bite today.
PHONEME_CORRECTIONS: list[tuple[str, str]] = [
    (
        # 喝采: 喝 should be hè (4th tone), not hē (1st tone, "to drink").
        # 賀采 is an unambiguous homophone — 賀 has only the hè reading.
        "喝采",
        '<sub alias="賀采">喝采</sub>',
    ),
    (
        "喝彩",
        '<sub alias="賀彩">喝彩</sub>',
    ),
    (
        # 打的漂亮: colloquial spelling of 打得漂亮 (的 used for 得). Left as-is,
        # Azure tends to parse 打的 as the 打的(take-a-taxi) idiom and read 的
        # as dī instead of the V-得-Adj complement particle (neutral tone de).
        # Alias to the grammatically standard spelling to route around it.
        "打的漂亮",
        '<sub alias="打得漂亮">打的漂亮</sub>',
    ),
    (
        # 打得漂亮 is already the standard V-得-Adj complement spelling — no
        # 打的(taxi) collision is possible since there's no 的 in the text.
        # alias == content is intentional: it's a no-op substitution that
        # keeps this entry's behavior identical to unmarked plain text.
        "打得漂亮",
        '<sub alias="打得漂亮">打得漂亮</sub>',
    ),
]

_PHONEME_CORRECTIONS = PHONEME_CORRECTIONS

MAX_SENTENCE_LEN = 40


def _apply_phoneme_corrections(text_escaped: str) -> str:
    # Single left-to-right pass over the ORIGINAL text — never re-scan text
    # we just emitted. Sequential `result.replace(...)` per pattern (the old
    # approach) mutates `result` in place, so a later pattern in the loop can
    # match a substring that only exists because an earlier replacement
    # introduced it (e.g. an alias that happens to contain another pattern's
    # key), producing garbled double-substitution. Caught by TDD in #2612
    # when "打得漂亮" (used as the 打的漂亮 alias) got re-matched and wrapped
    # a second time.
    out: list[str] = []
    i = 0
    n = len(text_escaped)
    while i < n:
        for pattern, replacement in PHONEME_CORRECTIONS:
            # An empty pattern would match at every position with i += 0,
            # hanging every TTS request forever — guard against that
            # footgun rather than relying on the table never containing one.
            if pattern and text_escaped.startswith(pattern, i):
                out.append(replacement)
                logger.debug("Phoneme correction applied: %r → %r", pattern, replacement)
                i += len(pattern)
                break
        else:
            out.append(text_escaped[i])
            i += 1
    return "".join(out)


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
