"""句子中間的兩個空格，被我拆成兩列孤兒選項。

Young 看著 `/learn/20011/keypoints-table`：

    結果    【________】
    結果-1  □ 贏了   □ 輸了
    結果-2  □ 贏得   □ 失去

> 結果1 2 感覺你沒有認真做？？？他是單選嗎？？？？還是填充？？？

原本的形狀是**一句話兩個空格**，各自一組選項：

    結果，小戴（　）球賽，卻（　）全國人民的尊敬。
                ↑ 贏了/輸了      ↑ 贏得/失去

2026-08-19 我把 `sub_items` 展開成兩個獨立列讓門變綠。門綠了，
而學生看到一個空的填空、下面兩組不知道對應哪個空格的選項 ——
**比原本「什麼都不顯示」更難懂**。那是為了讓斷言過而做出的形狀，不是對的形狀。

正確的表達：**一列**，句子照原樣，每個空格帶自己的選項。
schema 用 `blank_choices`（與既有的 `blank_hints` 同位置、同順序）。
"""
from __future__ import annotations

import pathlib
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.routes.stories import (  # noqa: E402
    _format_yaml_structure_table,
    _sanitize_structure_for_client,
)
from app.services.keypoints_to_structure import keypoints_to_structure_table  # noqa: E402

LESSONS = pathlib.Path(__file__).resolve().parent.parent / "data" / "lessons"


def _served(uid: str):
    kp = (yaml.safe_load((LESSONS / uid / "v3" / "keypoints.yml").read_text(encoding="utf-8"))
          or {}).get("keypoints") or {}
    return _sanitize_structure_for_client(_format_yaml_structure_table(
        keypoints_to_structure_table(kp)))


def _walk(rows):
    for r in rows or []:
        yield r
        yield from _walk(r.get("sub_rows"))


def test_the_source_is_still_the_shape_this_is_about():
    """前置：L0011 那一列還是「一句兩空格 + sub_items」。"""
    kp = (yaml.safe_load((LESSONS / "L0011" / "v3" / "keypoints.yml").read_text(encoding="utf-8"))
          or {}).get("keypoints") or {}
    row = kp["rows"][3]["sub_rows"][2]
    assert row["label"] == "結果"
    assert len(row["sub_items"]) == 2, "sub_items 不是兩個 —— 這條在測別的東西"
    assert row["value"].count("（　）") == 2, f"句子裡不是兩個空格：{row['value']!r}"


def test_no_orphan_numbered_rows():
    """不可以出現「結果-1」「結果-2」這種把句子拆開的孤兒列。

    它們沒有句子，學生看不出這組選項要填進哪一個空格。
    """
    orphans = [
        r.get("label") for r in _walk(_served("L0011").get("rows"))
        if isinstance(r.get("label"), str) and r["label"].startswith("結果-")
    ]
    assert not orphans, f"句子被拆成孤兒列：{orphans}"


def test_the_sentence_keeps_its_choices():
    """那一列要同時有完整句子**和**兩組選項，而且看得出哪組對應哪個空格。

    ⚠️ 第一版斷言一個我還沒實作的欄位（`blank_choices`）。橋回的是 list-of-lists，
    新欄位穿不過去 —— 我是先想像了 schema 才去看資料流。改成斷言**保證**
    （一列、句子完整、兩組選項、標得出對應），不綁定我猜的機制。

    「標得出對應」不是裝飾：兩組選項長得幾乎一樣（贏了/輸了 vs 贏得/失去），
    沒有標示的話學生分不出哪組填哪個空格。
    """
    rows = list(_walk(_served("L0011").get("rows")))
    row = next((r for r in rows if r.get("label") == "結果"), None)
    assert row is not None, "找不到「結果」那一列"

    value = str(row.get("value") or "")
    assert "小戴" in value and "尊敬" in value, f"句子不完整：{value!r}"
    assert value.count("【") >= 2, f"兩個空格不見了：{value!r}"

    # 兩組選項各自標明對應第幾個空格
    assert "第一個空格" in value and "第二個空格" in value, (
        f"沒有標明哪組對應哪個空格：{value!r}"
    )

    opts = row.get("options") or []
    assert opts == ["贏了", "輸了", "贏得", "失去"], (
        f"選項不對（跨行切壞會出現「輸了\\n第二個空格：」這種）：{opts}"
    )


def test_the_answer_is_not_in_there():
    """正向對照：補回選項不可以順手把答案也送出去。"""
    import json

    blob = json.dumps(_served("L0011"), ensure_ascii=False)
    for key in ('"answer"', '"correct_options"'):
        assert key not in blob, f"學生端 payload 帶答案：{key}"
