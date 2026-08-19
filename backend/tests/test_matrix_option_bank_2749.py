"""配對題把答案印在畫面上，而且沒有東西可以作答。

L0016《這是什麼「意思」？》是配對題：8 個例句配 A–H 的語意，共用選項收在
`option_bank`。來源長這樣：

    layout: matrix
    columns: [例句, 配對]
    rows:
      - 例句: "1.這訓練量對先發選手來說只是「小意思」。"
        配對: "G"                                    ← 這是答案
    option_bank: {A: 表達歉意或害羞, …, G: 指這件事很簡單…}

橋沒有 `option_bank` 這個 case，於是「配對」欄被當成純文字送出去：

    {"label": "1.這訓練量…", "sub_rows": [
      {"label": "配對", "value": "G", "interactive_type": "display"}]}

兩個問題疊在一起（2026-08-19 實測）：
  1. **八題的答案代號全部印在學生眼前** —— 學生手上有紙本學習單（印著 A–H 對照），
     螢幕等於把答案給了
  2. **17 個互動元素全部是 `display`** —— 這一課完全不能作答

修法不是把答案挖掉就好（那會留下八個空欄位、還是不能作答），
而是還原它本來的形狀：**選項來自 `option_bank`，答案走 `correct_options`**。
那條路今天已經鋪好了 —— 消毒器會把 `correct_options` 擋在學生端之外
（`test_structure_answer_key_not_served_2736.py`），判分端點在作答後才回傳它。
"""

from __future__ import annotations

import json
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
UID = "L0016"


def _source():
    doc = yaml.safe_load((LESSONS / UID / "v3" / "keypoints.yml").read_text(encoding="utf-8")) or {}
    return doc.get("keypoints") or {}


def _walk(rows):
    for row in rows or []:
        yield row
        yield from _walk(row.get("sub_rows"))


def _served():
    return _sanitize_structure_for_client(
        _format_yaml_structure_table(keypoints_to_structure_table(_source()))
    )


def test_the_source_is_the_shape_this_test_is_about():
    """前置：確認 L0016 還是 matrix + option_bank。

    資料改了的話下面的斷言就在測別的東西，要先知道。
    """
    kp = _source()
    assert kp.get("layout") == "matrix", kp.get("layout")
    assert kp.get("option_bank"), "option_bank 不見了 —— 這課的形狀變了"
    assert "配對" in (kp.get("columns") or []), kp.get("columns")


def test_the_answer_letters_do_not_reach_the_student():
    """A–H 是答案代號，不可以出現在學生端。"""
    blob = json.dumps(_served(), ensure_ascii=False)
    import re

    lone = re.findall(r'"\s*([A-H])\s*"', blob)
    assert not lone, (
        f"{len(lone)} 個答案代號送到了學生端：{lone[:8]} —— "
        "學生手上有紙本 A–H 對照，這等於把答案印出來"
    )


def test_the_lesson_is_answerable_at_all():
    """這一課要有東西可以作答，不能整課都是 display。"""
    types = [r.get("interactive_type") for r in _walk(_served().get("rows"))]
    interactive = [t for t in types if t and t != "display"]
    assert interactive, (
        f"全部 {len(types)} 個元素都是 display —— 這一課學生完全不能作答"
    )


def test_the_option_bank_becomes_the_choices():
    """選項要來自 `option_bank`，學生才有得選。"""
    bank = _source()["option_bank"]
    served_opts = [o for r in _walk(_served().get("rows")) for o in (r.get("options") or [])]
    assert served_opts, "沒有任何選項送到學生端 —— option_bank 沒有被用上"
    for text in list(bank.values())[:3]:
        assert any(text in o for o in served_opts), f"選項裡找不到 {text!r}"


def test_grading_still_knows_the_answer_server_side():
    """伺服器端（消毒前）必須留著答案，否則判分會全錯。"""
    pre = _format_yaml_structure_table(keypoints_to_structure_table(_source()))
    withanswer = [r for r in _walk(pre.get("rows")) if r.get("correct_options")]
    assert withanswer, "消毒前的結構沒有 correct_options —— 判分沒有依據"
