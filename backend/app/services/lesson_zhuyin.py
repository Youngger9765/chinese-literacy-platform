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
    out: dict[str, dict[int, str]] = {}
    for t in raw.get("texts") or []:
        text = t.get("text")
        if not isinstance(text, str):
            continue
        # 對齊守衛：表若與課文不同步就整段跳過，不要拿位移的答案去標
        if t.get("n") != len(text):
            logger.warning("注音表與課文字數不符 lesson_uid=%s section=%s",
                           lesson_uid, t.get("section"))
            continue
        readings: dict[int, str] = {}
        for i, ch in enumerate(text):
            r = single.get(ch)
            if r:
                readings[i] = r
        for entry in t.get("poly") or []:
            i, b = entry.get("i"), entry.get("b")
            # 位置要真的指到表說的那個字 —— 否則寧可不標
            if isinstance(i, int) and 0 <= i < len(text) and b and text[i] == entry.get("c"):
                readings[i] = b
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

