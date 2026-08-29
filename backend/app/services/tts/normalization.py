from __future__ import annotations

import hashlib
import logging
import json
import logging
import re
from pathlib import Path

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


def _load_taiwan_corrections() -> list[tuple[str, str]]:
    """Generated Taiwan-reading corrections from the MOE dictionary.

    The hand-maintained list above is four entries added one at a time as
    someone happened to hear a mistake. That does not converge: the 2026-05-01
    expert review's audit found 4298 items needing review across 31 characters
    and 22 were ever fixed, and the four cases reported on 2026-08-09 were none
    of them in the table.

    These entries are derived instead: segment the corpus, look each word up in
    教育部《重編國語辭典修訂本》, compare against pypinyin's mainland reading, and
    for each differing syllable pick a character whose only reading is the
    Taiwanese one. Adding coverage means regenerating the file, not appending
    another tuple here.

    Missing or malformed file degrades to the hand-maintained entries rather
    than failing synthesis — a pronunciation nicety must never take down TTS.
    """
    path = Path(__file__).resolve().parents[3] / "data" / "tts" / "taiwan_pronunciation.json"
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))["corrections"]
    except (OSError, ValueError, KeyError) as exc:  # pragma: no cover
        logger.warning("Taiwan pronunciation data unavailable (%s); using built-ins only", exc)
        return []
    return [(r["word"], f'<sub alias="{r["alias"]}">{r["word"]}</sub>') for r in rows]


# Longest first: _apply_phoneme_corrections scans left to right and takes the
# first match, so a shorter key that is a prefix of a longer one would win and
# leave the rest of the longer phrase uncorrected.
PHONEME_CORRECTIONS = sorted(
    PHONEME_CORRECTIONS + _load_taiwan_corrections(),
    key=lambda kv: -len(kv[0]),
)

_PHONEME_CORRECTIONS = PHONEME_CORRECTIONS

MAX_SENTENCE_LEN = 40



# ── 「和」as a conjunction ────────────────────────────────────────────────────
#
# Taiwan reads the conjunction 和 as ㄏㄢˋ; Azure says ㄏㄜˊ. Reported on L01
# (「和」向心力) and confirmed by the owner as the target reading.
#
# This one gets a rule of its own rather than a table row, because 和 is a
# polyphone and a blind swap trades one wrong reading for another — 和平 is
# ㄏㄜˊ, 一唱一和 is ㄏㄜˋ. Two things make it tractable where 摸不著 is not:
#
#   - A stand-in exists. 漢 is single-reading ㄏㄢˋ. (摸不著 needs ㄓㄠˊ, and 著
#     is the only character in the entire MOE dictionary with that reading, so
#     there is nothing to substitute and it stays uncorrected.)
#   - The exceptions are enumerable. data/tts/he_exceptions.json holds every
#     multi-character MOE entry whose 和 is read as anything but ㄏㄢˋ — 489 of
#     them, taken from the dictionary rather than guessed.
#
# In the lesson corpus, every standalone 和 (506 of 506, by POS tagging) is a
# conjunction, so "standalone and not inside a listed word" is the whole rule.


def _load_he_exceptions() -> tuple[str, ...]:
    """Words where 和 is NOT ㄏㄢˋ, longest first for greedy matching."""
    path = Path(__file__).resolve().parents[3] / "data" / "tts" / "he_exceptions.json"
    try:
        words = json.loads(path.read_text(encoding="utf-8"))["words"]
    except (OSError, ValueError, KeyError) as exc:
        logger.warning("和 exception list unavailable (%s); leaving 和 uncorrected", exc)
        return ()
    return tuple(sorted((w for w in words if isinstance(w, str) and "和" in w), key=len, reverse=True))


_HE_EXCEPTIONS = _load_he_exceptions()

# 和 that names the character itself, rather than joining two things, is not
# a conjunction: a worksheet asking students to circle 「和」, a title like
# 〈和〉/《和》, or a UI label that is nothing but the bare glyph. jieba
# tokenizes all of these as a standalone "和" exactly like a real conjunction
# — segmentation cannot tell the two apart — so this is a second, independent
# gate checked alongside the exception-word list. Straight ASCII quotes are
# included for completeness (and for testing this function directly on raw
# text) even though in production they never reach here as literal characters:
# _synthesize_azure XML-escapes the text before calling
# _apply_phoneme_corrections, turning '"' into "&quot;" and "'" into
# "&apos;" first. The CJK brackets and curly quotes are not XML-special and
# survive that escaping unchanged, which is the case that matters in practice
# — Taiwanese worksheets quote a single character with 「」, not with ASCII
# quotes.
_QUOTE_PAIRS = {
    "「": "」",
    "〈": "〉",
    "《": "》",
    "“": "”",  # “ ”
    "‘": "’",  # ‘ ’
    '"': '"',
    "'": "'",
}


def _is_self_reference(text: str, i: int) -> bool:
    """True when the 和 at index i names the character, not a conjunction.

    Two shapes: the entire input is nothing but 和 (a bare UI label with no
    surrounding sentence to conjoin), or it is immediately sandwiched by a
    matching quote/bracket pair with nothing else inside (「和」, 〈和〉,
    《和》) — a reference to the character, not a use of it.
    """
    if text.strip() == "和":
        return True
    if i > 0 and i + 1 < len(text):
        closer = _QUOTE_PAIRS.get(text[i - 1])
        if closer is not None and text[i + 1] == closer:
            return True
    return False


def _he_exception_spans(text: str) -> set[int]:
    """Indices covered by a word whose 和 is not ㄏㄢˋ.

    Greedy and left-to-right, which is what keeps 「和平和戰爭」 working: 和平
    claims index 1 first, so 平和 cannot then claim it and the second 和 stays a
    conjunction. Scanning for any overlapping window instead — the first version
    — swallowed that one.
    """
    covered: set[int] = set()
    i = 0
    n = len(text)
    while i < n:
        for w in _HE_EXCEPTIONS:          # longest first
            if text.startswith(w, i):
                covered.update(range(i, i + len(w)))
                i += len(w)
                break
        else:
            i += 1
    return covered


def _he_conjunction_positions(text: str) -> frozenset[int]:
    """Indices of every 和 that should be read ㄏㄢˋ.

    Three gates, because neither of the first two alone is enough:

      - Segmentation says whether 和 stands alone. In the lesson corpus every
        standalone 和 (506 of 506, by POS tagging) is a conjunction. But jieba
        ships a Simplified-oriented dictionary and mis-splits some Traditional
        words — 溫和 comes back as 很溫/和 — so it over-reports. It also
        cannot tell a proper noun it has never seen (鄭和, 大和) from a real
        conjunction; both come back as two single-character tokens.
      - The MOE exception list catches those. On its own it *under*-reports,
        because substring matching crosses word boundaries: 「白天和黑夜」
        contains the archaic 天和. The list is therefore curated to modern
        words, and rare two-character entries are dropped for exactly that
        reason (recorded in the data file) — 鄭和/大和/和麵/零和 were
        wrongly dropped as "rare" when they are a proper noun, a proper
        noun, a verb, and a modern loanword respectively, and jieba's
        segmentation does not catch any of them, so they are back in the list.
      - Neither gate has any notion of a 和 that names the character rather
        than using it — 「和」, 〈和〉, a bare UI label. That is
        _is_self_reference's job, checked per position below.

    Any gate failing leaves the 和 alone, which is the safe direction: an
    unchanged 和 sounds like today, a wrong one sounds like a mistake.
    """
    try:
        import jieba
    except ImportError:  # pragma: no cover - jieba is a hard dependency
        logger.warning("jieba unavailable; leaving 和 uncorrected")
        return frozenset()

    excluded = _he_exception_spans(text)
    positions = []
    cursor = 0
    for token in jieba.cut(text):
        if (
            token == "和"
            and cursor not in excluded
            and not _is_self_reference(text, cursor)
        ):
            positions.append(cursor)
        cursor += len(token)
    return frozenset(positions)


_HE_CONJUNCTION = '<sub alias="漢">和</sub>'


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
    # Computed once per call, against the ORIGINAL text — segmenting the
    # partially-rewritten output would see SSML tags as words.
    he_positions = _he_conjunction_positions(text_escaped) if "和" in text_escaped else frozenset()
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
            if text_escaped[i] == "和" and i in he_positions:
                out.append(_HE_CONJUNCTION)
                i += 1
                continue
            out.append(text_escaped[i])
            i += 1
    return "".join(out)


def _has_phoneme_corrections(text: str) -> bool:
    return any(pattern in text for pattern, _ in PHONEME_CORRECTIONS)


#: 文言文課文帶著兩種**給眼睛看的**標記，它們不是字：
#:
#:      斷詞點   賈人.某，至.直隸1界      ASCII `.` 夾在字之間
#:      註腳數字 直隸1界 的 `1`           貼在字中間的孤立數字
#:
#: 兩者都會被念出來。⚠️ 這個清理**只掛在文言文來源**，沒有進共用的
#: `_clean_for_tts` —— `衛福部2023年` 跟 `直隸1界` 的形狀完全一樣
#: （中文-數字-中文），全域規則分不出註腳與年份，套上去會把一般課文的
#: 數字一起吃掉。
_CJK = r"\u4e00-\u9fff"
_WORD_BREAK_DOT = re.compile(rf"(?<=[{_CJK}])\.(?=[{_CJK}])")
_FOOTNOTE_DIGIT = re.compile(rf"(?<=[{_CJK}])\d{{1,2}}(?=[{_CJK}])")


def strip_classical_markup(text: str) -> str:
    """把文言文的斷詞點與註腳數字拿掉，標點與字都留著。"""
    if not text:
        return text
    out = _WORD_BREAK_DOT.sub("", str(text))
    out = _FOOTNOTE_DIGIT.sub("", out)
    return out


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


def _compute_corrections_fingerprint() -> str:
    """A short digest of the pronunciation table.

    Sorted first, so the fingerprint tracks the table's *content* and not the
    order it happens to be in. PHONEME_CORRECTIONS is sorted by length, and a
    tie between two same-length entries could reorder between runs — that must
    not invalidate the entire cache for a change nobody made.
    """
    body = "\u0000".join(f"{k}\u0001{v}" for k, v in sorted(PHONEME_CORRECTIONS))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]


CORRECTIONS_FINGERPRINT = _compute_corrections_fingerprint()


def _cache_key(text: str) -> str:
    """Cache key for a piece of synthesized speech.

    Includes how the text is *pronounced*, not just what it says. The key used
    to be the text alone, which meant adding a correction fixed nothing already
    cached: every stored clip containing that word kept serving the old reading
    forever, because its key had not moved. The only escape was deleting those
    objects by hand — and the person who forgets is the person who just changed
    the table.

    That is the mechanism behind the mispronunciations that got reported, not a
    hypothetical. With the fingerprint in the key, a corrections change makes
    the old audio *unreachable* instead of *wrong*, and the next request
    regenerates it. Regenerating the whole corpus costs about $2.

    Not yet included: the voice and the prosody rate. Both are currently fixed,
    but the rate is commented "product-tunable" in azure.py, so changing it
    would resurrect exactly this bug. Add them here when either becomes a
    variable.
    """
    return hashlib.sha256(
        f"{CORRECTIONS_FINGERPRINT}\u0000{text.strip()}".encode("utf-8")
    ).hexdigest()


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
    # 只剩標點的片段不是句子。切在「。」之後會把結尾的「」」單獨留成一段，
    # 送去合成就是一個沒有字的請求（多一次 API 呼叫、多一段沒意義的音）。
    sentences = [
        s.strip() for s in parts
        if s.strip() and s.strip(' 「」『』（）()，。、！？：；\u3000')
    ]

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
