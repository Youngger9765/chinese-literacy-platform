"""#3252 —— 詞界對齊之後，四個詞可以零代價放回例外清單

## 為什麼這張票存在

#3238 把 9 個 2 字詞移出例外清單，因為當時的比對是**子字串**，那些詞會跨詞界誤中
（`溫暖|和|改變` 裡出現「暖和」）。它在 `_dropped_boundary_collision_3238._why`
留了一條指示：

> ⛔ **不要把詞放回來 —— 放回來會再誤擋 68 處**

而那 68 處誤擋的成因**就是子字串比對**，#3246／#3248 已經把它換成詞界對齊。
所以那條指示對其中四個詞（求和／和善／暖和／太和）**已經是錯的指示**，
而它會讓下一個人照著走。

## 這一份鎖什麼

1. 四個詞在 `words` 裡（= 真的放回來了）
2. 它們原本的**誤擋上下文仍然判成連接詞**（= 放回來沒有代價）
3. 仍然被移除的那五個詞（人和／中和／和氣／和風／言和）**還在移除清單裡** ——
   它們的移除理由沒有改變，jieba 對 `濕度/和氣/壓`、`老中/和老/美` 的斷詞就是那樣

⚠️ 第 3 條是這一份的負向對照。少了它，「把九個詞全部放回」也會讓 1、2 條綠。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.he_conjunction import _he_conjunction_positions, _load_he_exceptions

_PATH = Path(__file__).resolve().parents[1] / "data" / "tts" / "he_exceptions.json"

# 放回來的四個，以及它們在 #3238 當時被記錄的誤擋上下文
_BACK = {
    "求和": "追求和唯美的境界",
    "和善": "坦率和善意的態度",
    "暖和": "信件傳遞溫暖和改變",
    "太和": "正太和小豬的故事",
}

# 仍然要留在移除清單裡的（移除理由沒變）
_STILL_DROPPED = ("人和", "中和", "和氣", "和風", "言和")


def _raw() -> dict:
    return json.loads(_PATH.read_text(encoding="utf-8"))


@pytest.mark.parametrize("word", sorted(_BACK))
def test_word_is_back_in_the_list(word: str):
    assert word in _raw()["words"], f"{word} 沒有放回 words"
    assert word not in _raw()["_dropped_boundary_collision_3238"], (
        f"{word} 同時出現在 words 與移除清單 —— 兩份來源會互相矛盾"
    )


@pytest.mark.parametrize("word,context", sorted(_BACK.items()))
def test_putting_it_back_costs_nothing(word: str, context: str):
    """它原本的誤擋上下文，現在仍然要判成連接詞。

    這條就是「零代價」的意思：詞界對齊之後，`溫暖|和|改變` 裡的「暖和」不再對齊
    token 邊界，所以例外清單不會覆蓋那個位置。
    """
    idx = context.index("和")
    assert idx in set(_he_conjunction_positions(context)), (
        f"放回「{word}」之後，「{context}」的「和」不再判成連接詞 —— 那是回歸"
    )


@pytest.mark.parametrize("word", _STILL_DROPPED)
def test_the_other_five_stay_dropped(word: str):
    """負向對照：少了這條，「九個詞全部放回」也會讓上面兩組綠。"""
    raw = _raw()
    assert word in raw["_dropped_boundary_collision_3238"], (
        f"{word} 不在移除清單裡了 —— 它的移除理由沒有改變（見該區塊的 _why）"
    )
    assert word not in raw["words"], f"{word} 被放回 words，但它會誤擋"


def test_he_qi_still_collides_which_is_why_it_stays_out():
    """把「和氣」放回去會弄壞 `濕度和氣壓` —— 實測 8 處。

    這條是上面那組負向對照的**行為版**：不只檢查清單長什麼樣，而是證明
    「為什麼不能放」這個理由現在仍然成立。
    """
    ctx = "濕度和氣壓的變化"
    idx = ctx.index("和")
    assert idx in set(_he_conjunction_positions(ctx)), "濕度和氣壓 的「和」應該是連接詞"
    assert "和氣" not in _load_he_exceptions(), "「和氣」在例外清單裡 —— 上面那句會壞掉"
