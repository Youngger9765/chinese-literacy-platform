"""逐課注音對照表的讀取端 —— 後端不選讀音，只查表（#3218）

## 為什麼後端不選讀音

讀音選擇的權威是出貨的 `frontend/src/components/zhuyin/polyphonicProcessor.ts`
（方大哥策展的樣式表 + 一/不變調 + `skipPrev` 狀態機 + hardcode 特例）。
後端**結構上無法重現它** —— #3215 移植過一次，吐出 `不 → ㄈㄨ`。

所以離線把 175 課逐字算好固化成表（`backend/scripts/generate_lesson_zhuyin.py`），
執行期兩邊讀同一份。前後端不一致因此**不是「要修到 0」，是不可能存在**。

## 表只收破音字位置

單音字的讀音由字型唯一決定，這裡用 `font_zhuyin_table()` 的 `single` 補上 ——
在表裡再存一份只會多一個會漂移的地方。

## 懶載入

一課的表約 40KB。⛔ 不可以在 import 時載 —— #3205 剛把冷啟動從 38.7 秒降到 18.3 秒，
其中 38 秒是在 import 時解析課文 YAML。這裡沿用同一個紀律：第一次用到才讀。
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path

from .lesson_uid_loader import _latest_version
from .zhuyin_readings import font_zhuyin_table

# ── 索引與編碼：三處必須同語意（產生器 / 這裡 / 前端 ZhuyinContext）──────────
_DEFAULT_SLOT = "0000"


def u16_chars(text: str) -> list[str]:
    """把字串切成 **UTF-16 單位**，跟 JS 的 `text[i]` 一致。

    ⛔ Python 的 `list(text)` 是碼點。純 BMP 相同，非 BMP 差一格 —— 而槽位是照
    UTF-16 產的，混用就是整串位移（#3175 的形狀）。
    """
    out: list[str] = []
    for ch in text:
        if ord(ch) > 0xFFFF:
            enc = ch.encode("utf-16-le")
            out.append(enc[0:2].decode("utf-16-le", "surrogatepass"))
            out.append(enc[2:4].decode("utf-16-le", "surrogatepass"))
        else:
            out.append(ch)
    return out


def unpack_slots(z: str) -> list[str]:
    """`.` = 預設槽 · `1`..`5` = `ss01`..`ss05`（表裡 96.9% 是預設，所以壓成字串）。"""
    return [_DEFAULT_SLOT if c == "." else f"ss{int(c):02d}" for c in z]


@lru_cache(maxsize=1)
def font_slot_readings() -> dict[str, dict[str, str]]:
    """破音字的 槽位 → 注音（由出貨字型推出、產生器寫檔）。

    讀不到就回空表 —— 注音是錦上添花，不該讓朗讀評分整個掛掉（同 `font_zhuyin_table`）。
    """
    path = Path(__file__).resolve().parents[2] / "data" / "zhuyin" / "font_slot_readings.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))["slots"]
    except (OSError, ValueError, KeyError) as exc:  # pragma: no cover
        logger.warning("font_slot_readings.json unavailable (%s)", exc)
        return {}


logger = logging.getLogger(__name__)

_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_LESSONS = _BACKEND_ROOT / "data" / "lessons"
_UID_RE = re.compile(r"^L\d+$")


def _table_path(lesson_uid: str) -> Path | None:
    """`backend/data/lessons/<uid>/v<n>/zhuyin.json`（取版本號最大的那個 v 目錄）。

    ⛔ `lesson_uid` 會從 HTTP 進來 —— 用白名單 regex 擋掉 `../`，不要只清路徑分隔符。
    """
    if not _UID_RE.match(lesson_uid):
        return None
    uid_dir = _LESSONS / lesson_uid
    if not uid_dir.is_dir():
        return None
    # ⛔ 版本選擇**共用 loader 的 `_latest_version`**，不自己寫一份 ——
    #    兩邊若分岔，注音表與服務出去的課文會來自不同版本，而那不會有任何錯誤訊息。
    #    ⚠️ 已知共用缺陷：它是字典序（`v10` < `v3`）。目前只有 v3 所以還沒咬人，
    #    但要修就是改 `_latest_version` 那一處，不是在這裡繞過去。
    vdir = _latest_version(uid_dir)
    if vdir is None:
        return None
    return vdir / "zhuyin.json"


def _read_table(lesson_uid: str) -> dict | None:
    """讀原始檔。獨立成一個函式是為了讓測試能換掉它（驗「真的在讀表」）。"""
    p = _table_path(lesson_uid)
    if p is None or not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        # fail-open：表壞掉時回 None 讓呼叫端走 fallback。
        # 漏標只是少一排注音，標錯是教錯讀音。
        logger.warning("注音表讀取失敗 lesson_uid=%s", lesson_uid, exc_info=True)
        return None


@lru_cache(maxsize=32)
def lesson_zhuyin_table(lesson_uid: str) -> dict[str, dict[int, str]] | None:
    """課號 → {課文段落文字: {字元位置: 注音}}。查不到回 None。

    ⚠️ `maxsize=32` 的實際記憶體（2026-09-15 `tracemalloc` 實測，字型表先暖好不計入）：

        lesson_zhuyin_table 32 課:  2.55 MB
        lesson_zhuyin_raw   32 課:  8.07 MB   ← 下面那個獨立 cache
        合計:                      10.62 MB

    最大的表是 `L0063/v3/zhuyin.json` **138 KB**（不是 40 KB），179 檔共約 10 MB。
    而「一個 session 只會碰一課」對 `lesson_zhuyin_raw` **不成立** —— 它由不需登入的
    公開端點餵，任何 client 都能輪流打 179 課把兩個 cache 各塞滿 32 筆
    （單次 miss 量過是 1.0 ms / 41 KB 回應，所以不是 DoS，只是預算要算對）。

    ⛔ 改表之後要清**兩個** cache：`lesson_zhuyin_table.cache_clear()` **和**
    `lesson_zhuyin_raw.cache_clear()`。只清前者的話端點仍回舊表，而且測試是綠的
    （實測分歧：換掉 `_read_table` 只清 table → raw 仍回 `['0000',…]`）。
    """
    raw = _read_table(lesson_uid)
    if not raw:
        return None
    single, _ = font_zhuyin_table()
    slot_readings = font_slot_readings()
    out: dict[str, dict[int, str]] = {}
    for t in raw.get("texts") or []:
        text = t.get("text")
        if not isinstance(text, str):
            continue
        units = u16_chars(text)
        slots = unpack_slots(t.get("ssz") or "")
        # 對齊守衛：表若與課文不同步就整段跳過，不要拿位移的答案去標。
        # ⛔ 長度一律用 **UTF-16 單位**（#3230）—— `len(text)` 是碼點，
        #    非 BMP 字（課名〈𪹚龍慶元宵〉的 U+2AE5A）會差一格，而槽位是
        #    照 UTF-16 產的。兩種索引混用就是整串位移。
        if not (len(slots) == t.get("n") == len(units)):
            logger.warning("注音表與課文字數不符 lesson_uid=%s section=%s",
                           lesson_uid, t.get("section"))
            continue
        readings: dict[int, str] = {}
        for i, ch in enumerate(units):
            poly = slot_readings.get(ch)
            if poly:
                # 破音字：注音由 (字, 槽位) 經出貨字型決定 —— 表只存槽位，
                # 不重複存注音（#3230，以前每個位置存一份、179 個檔各一份副本）
                r = poly.get(slots[i])
                if r:
                    readings[i] = r
                continue
            r = single.get(ch)
            if r:
                readings[i] = r
        out[text] = readings
    return out or None


def zhuyin_for_text(lesson_uid: str, text: str) -> dict[int, str] | None:
    """這一課裡這段文字的逐字注音。不在表裡回 None（呼叫端決定 fallback）。"""
    table = lesson_zhuyin_table(lesson_uid)
    if not table:
        return None
    return table.get(text)


@lru_cache(maxsize=32)
def lesson_zhuyin_raw(lesson_uid: str) -> dict | None:
    """原始表（含逐字槽位）—— 給前端渲染用。

    前端要的是**槽位**不是注音：畫面上的注音是字型的 IVS 變體畫出來的
    （`zhuyinStringBuilder` 把 `ss01` 轉成 U+E0101 接在字後面）。
    後端診斷報告要的才是注音字串，那條走 `zhuyin_for_text()`。

    ⛔ 這是**第二個獨立 cache** —— 改表之後 `lesson_zhuyin_table.cache_clear()`
    清不到它，要另外呼叫 `lesson_zhuyin_raw.cache_clear()`。
    """
    return _read_table(lesson_uid)



# ── #3247 難字 fallback：年級字頻，不是本課生詞 ──────────────────────────────
#
# 家長實測（2026-09-17）：難字模式標了「之 加 千 同 大 失 小 手 成」，而生詞欄位
# 是空的那課**一個字都不標**。根因是前端 `buildDifficultCharSet(story.vocabulary)`
# ——生詞是**課程的屬性**，難字是**讀者的屬性**。
#
# #3224 已經把「這孩子唸錯過的字」那條路接對了；這裡修的是**還沒有錯字紀錄**時
# （第一次玩的孩子，也就是最需要鷹架的那一刻）走的 fallback。
#
# 判定與 cut 的來源寫在 `backend/scripts/generate_char_difficulty.py` 的檔頭。
# ⛔ 難易度**不在這裡算**，這裡只查表 —— 跟注音同一條紀律。

_DIFFICULTY_PATH = Path(__file__).resolve().parents[2] / "data" / "zhuyin" / "char_difficulty.json"

# 難字至少給幾個 —— 短課文乘上比例會不足 1 個，而「開關沒作用」是這張票的症狀本身
_PICK_MIN = 3


@lru_cache(maxsize=1)
def char_difficulty_table() -> dict:
    """全庫逐字難易度表（懶載入，約 100 KB）。"""
    return json.loads(_DIFFICULTY_PATH.read_text(encoding="utf-8"))


# 課文本文住在哪個 section —— **11 課不在 `full_text_annotate` 底下**（2026-09-17
# 複審實測）：10 課文言文的本文是 `classical_text` + `modern_translation`，
# L0136 的本文在聚光燈的 `passage_paragraphs`。漏掉它們的後果不是「少標幾個字」，
# 是那 11 課（含 9 課文言文，最難的內容）**一個字都不標** —— 因為它們的生詞欄位
# 也都是 0，前端連 fallback 都沒有東西可退。這正是 #3247 要修的症狀本身。
#
# ⛔ 產生器（`generate_char_difficulty.py`）**必須用同一支函式**取語料。兩邊若分岔，
#    `lesson_hard_chars` 裡「不在表裡 = 不在任何課文本文出現過」那個假設就變成假的，
#    文言文的字會整批掉進那個縫裡而且沒有任何訊息。
_BODY_SECTIONS = ("full_text_annotate", "classical_text", "modern_translation")
_BODY_SECTION_RE = re.compile(r"^served:spotlight_v2\.blocks\[\d+\]\.passage_paragraphs\[\d+\]$")


def _is_body_section(section: object) -> bool:
    if not isinstance(section, str):
        return False
    return section in _BODY_SECTIONS or bool(_BODY_SECTION_RE.match(section))


@lru_cache(maxsize=32)
def lesson_body_text(lesson_uid: str) -> str | None:
    """這一課的**課文本文**。沒有本文回 None。

    ⛔ 不含題幹／選項／策略說明／聚光燈的解說 —— 那些是教學鷹架的文字，不是孩子
       讀的課文。把它們算進字頻會讓「請」「選」「答」變成常用字。
    """
    raw = _read_table(lesson_uid)
    if not raw:
        return None
    parts = [
        t["text"]
        for t in (raw.get("texts") or [])
        if _is_body_section(t.get("section")) and isinstance(t.get("text"), str)
    ]
    return "\n".join(parts) if parts else None


def _lesson_grade(lesson_uid: str) -> int | None:
    p = _table_path(lesson_uid)
    if p is None:
        return None
    f = p.parent / "lesson.yml"
    if not f.is_file():
        return None
    m = re.search(r"^catalog_slot:\s*G(\d+)-", f.read_text(encoding="utf-8"), re.M)
    return int(m.group(1)) if m else None


@lru_cache(maxsize=32)
def lesson_hard_chars(lesson_uid: str) -> frozenset[str] | None:
    """這一課對**這個年級**的難字集合。沒有課文本文回 None。

    ## 選法：逐課取最少見的一小撮，不是全域門檻

    先按「這個年級才新出現的」優先、再按「在整套教材裡出現在幾篇」排序，取前
    `pick_ratio` 比例（下限 3 個）。

    ⚠️ 2026-09-17 複審擋下的上一版是**全域門檻**（出現 ≤6 篇算難）＋算不出東西時
       的地板。它有兩個由構造而來的毛病：
         ① 標記率隨年級崩掉 —— 九年級與無年級課程只有 ~0.3%，整篇課文標一個字，
            對孩子來說跟開關壞掉沒有差別（實測 21 課低於 0.5%，19 課是九年級帶）
         ② 「無年級」被當成九年級，於是年級那條篩不掉任何東西
       逐課取比例把量**由構造保證**：實測 179 課標記率中位 1.8%、最低 1.03%、
       最高 5.3%，而且每個年級都落在 1.6–2.0%（之前是 0.4%–17.5%）。
       同時不再需要地板那個特例。

    ⚠️ 回 `None`（這課沒有課文本文）跟回**空集合**是兩件事。現在 179 課都有本文，
       所以空集合代表有東西壞了 —— 回歸鎖會叫。
    """
    body = lesson_body_text(lesson_uid)
    if body is None:
        return None
    t = char_difficulty_table()
    chars = t["chars"]
    # 不在表裡 = 不在任何課文本文出現過（標點、數字、注音符號…）→ 一律不是難字
    # ⛔ 排序的最後一鍵是**字本身**，不能少。`set(body)` 的迭代序跟 Python 的
    #    字串雜湊種子有關，而 `sorted` 是穩定排序 —— 出現次數相同的字，取誰會隨
    #    行程而變。症狀是「同一課在不同後端實例顯示不同的難字」，重啟一次就換一批，
    #    而且**沒有任何錯誤訊息**。2026-09-17 是寫測試時撞到才發現的。
    cand = [(ch, chars[ch]) for ch in set(body) if ch in chars]
    if not cand:
        return frozenset()
    k = max(_PICK_MIN, round(t["pick_ratio"] * len(cand)))
    grade = t.get("lesson_grade", {}).get(lesson_uid)
    if grade is None:
        # 無年級（文言文／品格教育／體育）—— ⛔ 不要假裝它是九年級（上一版就是這樣
        # 才讓整批課程只剩 0.3% 的標記率）。不知道年級就只用罕見度排序。
        ranked = sorted(cand, key=lambda kv: (kv[1][1], kv[0]))
    else:
        # 這個年級才新出現的排前面；不足 k 個才放寬到「更低年級出現過但仍罕見」的字。
        # 放寬是有意的：這套教材每個年級只有 20–30 課，「首見 G4」常常只代表
        # 「這 175 篇裡剛好有一篇四年級用過」，不等於孩子學過。
        ranked = sorted(
            cand, key=lambda kv: (kv[1][0] < grade, kv[1][1], kv[0])
        )
    return frozenset(ch for ch, _ in ranked[:k])
