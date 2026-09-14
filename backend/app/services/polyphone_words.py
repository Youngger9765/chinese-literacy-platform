"""詞 → 那個多音字讀什麼。(#3215)

朗讀診斷報告的破音字讀音原本只靠 pypinyin 的上下文判讀，而它是大陸語料 ——
結構上給不出「銀行 = ㄏㄤˊ」「災難 = ㄋㄢˋ」。prod 實測：`難` 的五種情境
pypinyin **全部回 ㄋㄢˊ**，即使字型明明收了 `ss01 = nan4`。

正確答案一直在 `frontend/public/data/poyin_db.json` 的詞樣式表裡 ——
課文頁用的就是它。`scripts/generate_polyphone_words.py` 把那些樣式展開成
具體的詞（`災*` → 「災難」、多音字在位移 1），這裡做最長詞優先比對。

⛔ **沒有判讀邏輯，只有查表。** 這是刻意的：前端的 `polyphonicPatternMatcher.ts`
被移植過一次，漏掉一/不 變調與 `skipPrev` 狀態，吐出 `不 → ㄈㄨ` 這種
看起來合理的錯答案。展開字串沒有可以移植錯的東西。

同 `services/he_conjunction.py` 的形狀：回「位置 → 讀音」，不回改好的文字，
因為呼叫端要的產物形狀可能不同。
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

#: 這個檔在 app/services/ → backend/ 是往上 2 層
TABLE_PATH = Path(__file__).resolve().parents[2] / "data" / "zhuyin" / "polyphone_words.json"


@lru_cache(maxsize=1)
def _words() -> tuple[dict[str, dict[str, str]], dict[str, list[str]]]:
    """回傳 (詞表, 首字索引)。

    首字索引讓執行期只比對「以這個字開頭」的詞 —— 3167 個詞如果每個位置都全掃，
    10000 字的輸入要 3167 萬次字串比對。

    讀不到就回空表，呼叫端維持原本的 pypinyin 判讀（＝這次改動之前的行為）。
    """
    try:
        raw = json.loads(TABLE_PATH.read_text(encoding="utf-8"))["words"]
    except (OSError, ValueError, KeyError) as exc:  # pragma: no cover
        logger.warning("polyphone word table unavailable (%s); leaving readings to pypinyin", exc)
        return {}, {}
    by_first: dict[str, list[str]] = defaultdict(list)
    for w in raw:
        by_first[w[0]].append(w)
    # 最長詞優先：`多難興邦` 要贏過 `多難`
    for k in by_first:
        by_first[k].sort(key=len, reverse=True)
    return raw, dict(by_first)


def readings_in(text: str) -> dict[int, str]:
    """回傳 {原文的字元索引: 注音}，只含詞表命中的多音字。

    最長詞優先，且**已決定的位置不會被後面較短的詞覆蓋** ——
    否則「多難興邦」會先被判對、再被「多難」蓋掉。
    """
    words, by_first = _words()
    if not words:
        return {}

    out: dict[int, str] = {}
    i = 0
    n = len(text)
    while i < n:
        for word in by_first.get(text[i], ()):
            if text.startswith(word, i):
                for offset_str, reading in words[word].items():
                    pos = i + int(offset_str)
                    out.setdefault(pos, reading)
                i += len(word) - 1        # 這個詞整體消耗掉，不從詞中間再起一次
                break
        i += 1
    return out
