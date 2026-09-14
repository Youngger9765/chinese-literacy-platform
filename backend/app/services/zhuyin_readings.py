"""台灣注音讀音對照表 —— 抽自出貨字型 BpmfZihiSerif-Regular.ttf。(#3202)

## 為什麼存在

`pypinyin` 是大陸的函式庫，讀音是普通話的。全站有三處會產生注音，
其中兩處早就接了台灣來源（課文顯示走字型＋`poyin_db.json`，
語音走 `services/tts/normalization.py` ＋ `data/tts/taiwan_pronunciation.json`），
**只有朗讀診斷報告直接吐 pypinyin 的原始輸出**。

真環境重現（staging，2026-09-14）：「研究垃圾的消息和血型」十個字五個是大陸音 ——
究 ㄐㄧㄡ、垃 ㄌㄚ、圾 ㄐㄧ、息 ㄒㄧ、血 ㄒㄩㄝˋ。

## 真值選字型，不選教育部辭典

字型就是**畫面上實際會畫出來的那個讀音**，而且是本專案已經在出貨的檔案，
不受辭典 CC BY-ND 授權限制。這個 repo 已經用
`tests/test_font_is_taiwan_reading_authority_3173.py` 宣告過它是台灣讀音權威
（Young 2026-09-12 逐字確認 12 個經典兩岸差異字）。

## 為什麼住在 service 而不是 route

原本寫在 `routes/learning/learning_reading.py` 裡。搬出來有三個具體理由：

1. **已經有第二個消費者被卡住** —— `learning_reading.py` 的 `RecommendedVocabItem`
   有 `zhuyin` 欄位，而 `routes/learning/learning_errors.py` 硬寫 `zhuyin=None`，
   因為產生器是另一個 route 模組裡的私有函式
2. `learning_reading.py` 已經 742 行，越過 CLAUDE.md 的 production code warn 500
3. 最接近的先例就在隔壁：`services/tts/normalization.py` 做同一件事
   （字→台灣讀音、committed JSON、fail-open）

## ⚠️ 路徑要錨在這個檔自己身上

原本寫 `Path(__file__).resolve().parents[3]`，那是**跟模組深度綁死**的寫法：
`app/routes/learning/x.py` 跟 `app/services/x/y.py` 剛好同深度，搬家時算錯不會紅，
只會 fail-open 回空表、注音全部悄悄退回 pypinyin。所以這裡用
`_BACKEND_ROOT` 常數並配一條「表真的載得到」的測試 —— 那條會抓到路徑算錯。
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

#: 這個檔是 backend/app/services/zhuyin_readings.py → 往上三層是 backend/
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
TABLE_PATH = _BACKEND_ROOT / "data" / "zhuyin" / "font_readings.json"


@lru_cache(maxsize=1)
def font_zhuyin_table() -> tuple[dict[str, str], dict[str, dict]]:
    """回傳 (單音字表, 破音字表)。

    `single`: 字 → 注音字串（字型只收一個讀音的字，11050 個）
    `poly`:   字 → {"d": 預設讀音, "v": [全部候選讀音]}（2037 個）

    兩邊的值都是**注音**不是拼音，記法沿用 pypinyin 自己的 `BopomofoConverter`
    （見產生器）—— 讀音一致的那 10057 個字，兩邊產出的字串逐字相同，
    所以換來源不會順便換記法。

    檔案讀不到就回空表，呼叫端退回 pypinyin（＝#3202 之前的行為）。
    注音是錦上添花，不該讓整個朗讀評分掛掉 —— 同 `tts/normalization.py`
    的 `_load_taiwan_corrections`。

    `lru_cache` 讓它變成懶載：第一個要注音的請求才付這 4.6 ms，
    不在 import 期、不影響沒碰注音的冷啟動。
    """
    try:
        raw = json.loads(TABLE_PATH.read_text(encoding="utf-8"))
        return raw["single"], raw["poly"]
    except (OSError, ValueError, KeyError) as exc:  # pragma: no cover
        logger.warning("Taiwan zhuyin table unavailable (%s); falling back to pypinyin", exc)
        return {}, {}
