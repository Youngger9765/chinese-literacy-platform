"""「和」是不是連接詞 —— 一個關於文字本身的事實，兩個消費者。

台灣把當連接詞的「和」讀 **ㄏㄢˋ**；`和平` 是 ㄏㄜˊ、`一唱一和` 是 ㄏㄜˋ。
判斷「這一個『和』是哪一種」既不是語音合成的事、也不是注音標示的事 ——
它是關於這段文字的事實。所以住在這裡，而不是任何一個消費者裡面。

## 兩個消費者

- `services/tts/normalization.py` —— 把它換成 `<sub alias="漢">和</sub>` 讓 Azure 唸對
  （2026-08，起因是案主在 L01「『和』向心力」聽到大陸音）
- `services/zhuyin_readings.py` 的呼叫端 —— 把它標成 ㄏㄢˋ（#3204）

⚠️ **抽出來之前這整套只有語音那邊接著**，畫面上的注音（朗讀診斷報告）
語料 730 處全部標成 ㄏㄜˊ，包括當連接詞的時候。邏輯與 489 筆例外清單早就在，
只是沒有第二個人來拿。

## 為什麼是「位置集合」而不是「替換字串」

回 `frozenset[int]` 而不是回改好的文字 —— 因為兩個消費者要的產物形狀不同
（一個要 SSML、一個要注音字串），但要的**判斷**是同一個。
回字串的話第二個消費者就只能自己再寫一套。
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


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
    # ⚠️ 這個檔在 app/services/ → backend/ 是往上 **2** 層。
    # 原本住 app/services/tts/ 是 3 層，搬家時這一格算錯**不會紅**，
    # 只會 fail-open 回空 tuple、所有「和」靜靜地不再被修正。
    # 所以下面有一條「清單非空」的測試，那條會抓到。
    path = Path(__file__).resolve().parents[2] / "data" / "tts" / "he_exceptions.json"
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
