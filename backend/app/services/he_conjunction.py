"""「和」是不是連接詞 —— 一個關於文字本身的事實，兩個消費者。

台灣把當連接詞的「和」讀 **ㄏㄢˋ**；`和平` 是 ㄏㄜˊ、`一唱一和` 是 ㄏㄜˋ。
判斷「這一個『和』是哪一種」既不是語音合成的事、也不是注音標示的事 ——
它是關於這段文字的事實。所以住在這裡，而不是任何一個消費者裡面。

## 兩個消費者

- `services/tts/normalization.py` —— 把它換成 `<sub alias="漢">和</sub>` 讓 Azure 唸對
  （2026-08，起因是案主在 L01「『和』向心力」聽到大陸音）
- `services/zhuyin_readings.py` 的呼叫端 —— 把它標成 ㄏㄢˋ（#3204）

⚠️ **抽出來之前這整套只有語音那邊接著**，畫面上的注音（朗讀診斷報告）
語料 730 處全部標成 ㄏㄜˊ，包括當連接詞的時候。邏輯與 371 筆例外清單早就在，
只是沒有第二個人來拿。

## 為什麼是「位置集合」而不是「替換字串」

回 `frozenset[int]` 而不是回改好的文字 —— 因為兩個消費者要的產物形狀不同
（一個要 SSML、一個要注音字串），但要的**判斷**是同一個。
回字串的話第二個消費者就只能自己再寫一套。
"""

from __future__ import annotations

import json
import logging
import threading
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
#     multi-character MOE entry whose 和 is read as anything but ㄏㄢˋ — 371 of
#     them, taken from the dictionary rather than guessed.
#
# In the lesson corpus, every standalone 和 (506 of 506, by POS tagging) is a
# conjunction, so "standalone and not inside a listed word" is the whole rule.


def _load_he_exceptions() -> tuple[str, ...]:
    """Words where 和 is NOT ㄏㄢˋ.

    ⚠️ 排序（長的在前）現在的唯一用途是**決定性** —— `_get_tokenizer` 加詞的順序
    會影響 jieba 算出來的頻率，而產表必須可重現。原本的用途是貪婪子字串比對，
    那支（`_he_exception_spans`）在 #3246 刪掉了。
    """
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


#: jieba 缺的繁體詞 —— #3238 沒查到的第二層根因（#3246）。
#:
#: jieba 的字典是簡體導向的。下面這些**繁體常用詞根本不在字典裡**，
#: 於是在它的動態規劃裡，「和」黏住鄰字的分析是**沒有對手的**：
#:
#:     freq(和平)   = 7998    ← 正向對照，字典確實查得到
#:     freq(和解)   = 394
#:     freq(和服)   = 81
#:     freq(解釋)   = None    ← 字典裡只有簡體的「解释」
#:     freq(解決)   = None    ← 只有「解决」
#:     freq(服務業) = None
#:     freq(隊友)   = None
#:     freq(好朋友) = None
#:     freq(面臨)   = None
#:
#: 所以「理解|和解|釋」「工作|和服|務業」不是被誤判，是**贏家只有一個候選**。
#: 補上這些詞，正確的切法才有機會競爭。
#:
#: ⚠️ 加詞之前先實測「加了會不會把真詞拆壞」—— 跑全語料比對加前加後的判決，
#:    不要只看要修的那一句。這張表只放**毫無爭議的常用繁體詞**。
#: ⛔ 也要實測「加了到底有沒有用」。`嘴喙` 一度在這張表裡，實測加與不加**判決完全相同**
#:    （`和尾羽` 是 jieba 字典裡 freq=6 的詞，攔住它的是斷詞那道門，不是這張表），
#:    所以移掉了 —— 惰性的條目會讓人以為某個 case 有人在顧。
_MISSING_TRADITIONAL_WORDS = (
    "解釋",     # 理解|和|解釋       （字典只有「解释」）
    "解決",     # 問題|和|解決       （只有「解决」）
    "服務業",   # 勞力工作|和|服務業 （只有「服务业」）
    "隊友",     # 不|和|隊友         （只有「队友」）
    "好朋友",   # 你|和|好朋友
    "面臨",     # 世界和平|面臨考驗  ← 少了它會切成 世界/和/平面/臨，把「和平」拆散
    "溫暖",     # 溫暖|和|改變 ×6（L0035/L0059/L0083）—— jieba 原本給 溫/暖和
)

#: 例外清單裡的多字詞（單字「和」本身不算例外）
_EXCEPTION_WORDS = frozenset(w for w in _HE_EXCEPTIONS if len(w) > 1)
_MAX_EXCEPTION_LEN = max((len(w) for w in _EXCEPTION_WORDS), default=0)

#: `None` 代表還沒建；`False` 代表建不起來（jieba 沒裝），不要每次呼叫都重試。
_tokenizer = None
_tokenizer_lock = threading.Lock()


def _get_tokenizer():
    """自己的一份 jieba 字典，只建一次。

    用獨立的 `Tokenizer` 而不是全域的 `jieba.dt` —— 這裡會為了判「和」而動字典
    （加繁體鄰詞、把「和」灌成高頻），那些調整不該外溢給任何其他使用者。

    ⛔ **只建一份。** 一度是兩份（一份灌「和」、一份灌例外詞），那個版本有兩個缺陷，
    而且同一個根因：

      - 兩份分兩步賦值，**晚到的執行緒會看到半建好的狀態**。而漏掉的那一份
        是例外詞那道門，它 fail-open（回空集合）→ `溫和`／`和好`／`和諧`
        會被讀成連接詞。TTS 走 `asyncio.to_thread`，多個學生同時按朗讀就會進來。
      - 兩份 50 萬條的 prefix dict 多吃 **+71 MB** 穩態 RSS，而後端的上限是 512Mi。
        更糟的是 jieba 的初始化鎖是 per-instance，N 個執行緒同時首呼叫會各建各的
        （實測 8 執行緒 → 16 份字典）。

    現在只有一份，例外詞改用「對齊詞界」判定（見 `_covered_by_exception_word`），
    不需要第二份字典。⛔ 賦值只有一次，別再拆成多步。

    ⚠️ 加詞順序會影響 `add_word(freq=None)` 算出來的頻率（它走 `suggest_freq`，
    而那讀當下的 `self.total`）。所以一律走有序的 tuple，不要走 set ——
    set 的走訪順序每個 process 都可能不同，而產表必須可重現。
    """
    global _tokenizer
    tk = _tokenizer
    if tk is not None:
        return tk or None
    with _tokenizer_lock:
        if _tokenizer is not None:
            return _tokenizer or None
        try:
            import jieba
        except ImportError:  # pragma: no cover - jieba is a hard dependency
            logger.warning("jieba unavailable; leaving 和 uncorrected")
            _tokenizer = False
            return None
        built = jieba.Tokenizer()
        built.initialize()
        for w in _MISSING_TRADITIONAL_WORDS:
            built.add_word(w)
        # 「和」是單字功能詞，被黏進鄰詞就是 bug（#3238）—— `和歌`（大衛和歌利亞）、
        # `和瑪雅`（諾查丹瑪斯和瑪雅）、`和小紅` 都是這樣來的。
        # ⛔ 這一行是 5 個位置的唯一守衛，有測試盯著，別當成可有可無的調校。
        built.add_word("和", freq=2_000_000)
        _tokenizer = built          # ← 單次賦值，觀察不到中間狀態
        return _tokenizer


def _covered_by_exception_word(text: str, i: int, boundaries: frozenset[int]) -> bool:
    """位置 `i` 的「和」是不是落在一個**對齊詞界**的例外詞裡。

    這是這次改動的核心。舊版掃子字串，而子字串**沒有詞界概念**：

        困惑和好奇   字串裡有「和好」→ 整段被當成例外詞，但那裡是連接詞
        理解和解釋   字串裡有「和解」→ 同上
        壞事和好事   字串裡有「和好」→ 同上

    改成「例外詞的頭尾都必須落在斷詞邊界上」之後，上面三句分別切成
    困惑/和/好奇、理解/和/解釋、壞事/和/好事 —— 例外詞的尾端切在詞中間，
    不算覆蓋；而 朋友/和/好、與/仇人/和解 的頭尾都在邊界上，照樣被擋住。

    ⚠️ 判準是「頭尾都在邊界上」，**不是**「例外詞自己剛好是一個 token」。
    後者太嚴：jieba 常把 `和好` 切成 `和`/`好` 兩個 token（`和好` 在它的字典裡
    freq 是 0），那時例外詞仍然完整覆蓋了兩個 token，應該算覆蓋。
    """
    n = len(text)
    for length in range(2, _MAX_EXCEPTION_LEN + 1):
        for start in range(max(0, i - length + 1), i + 1):
            if start + length > n:
                continue
            if (start in boundaries and start + length in boundaries
                    and text[start:start + length] in _EXCEPTION_WORDS):
                return True
    return False


def _he_conjunction_positions(text: str) -> frozenset[int]:
    """Indices of every 和 that should be read ㄏㄢˋ.

    三道門，每一道都擋不同的東西：

      - **斷詞**說「和」是不是獨立的。它會過度回報（jieba 的字典是簡體導向的，
        `溫和` 有時被切成 `很溫/和`），但它擋住一件別人擋不住的事：
        **例外清單漏收的真和詞**。`和煦` 不在那 371 筆裡，是斷詞讓它保持完整。
      - **例外清單**擋斷詞漏掉的。#3246 之前它用子字串比對，會跨詞界誤中 ——
        現在要求對齊詞界，見 `_covered_by_exception_word`。
      - **`_is_self_reference`** 擋指稱這個字本身的「和」（「和」、〈和〉、
        單獨一個字的 UI 標籤）—— 前兩道門都沒有這個概念。

    任何一道門攔下來就不動它，那是安全的方向：沒改的「和」聽起來跟今天一樣，
    改錯的「和」聽起來就是個錯。

    ⛔ `HMM=False`（#3238）。jieba 的 HMM 會從沒見過的字串自己造新詞，而它是
    簡體語料訓練的 —— 對繁體課文它把「和」黏進鄰詞（`象鼻/蟲和黃面/蜂`、
    `臺/灣和/周邊`、`狗狗/和貓/咪`）。這裡只問「和是否獨立」，HMM 造的是純噪音。
    ⛔ 這個參數是 82 個位置的唯一守衛，有測試盯著 —— 不要「為了斷詞更自然」打開它。
    """
    tk = _get_tokenizer()
    if tk is None:
        return frozenset()

    boundaries = {0}
    standalone = []
    cursor = 0
    for token in tk.cut(text, HMM=False):
        if token == "和":
            standalone.append(cursor)
        cursor += len(token)
        boundaries.add(cursor)
    frozen = frozenset(boundaries)
    return frozenset(
        i for i in standalone
        if not _covered_by_exception_word(text, i, frozen)
        and not _is_self_reference(text, i)
    )
