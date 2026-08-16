"""聚光燈的表格練習必須把內容帶出來，不能被當成沒有圖的插圖丟掉 (#2683).

REPRODUCED against the real corpus before fixing:

    聚光燈範圍內被歸成 assetless table-figure（會被丟棄）的表格: 172 個，跨 88 / 175 課

`classify_block` sends any 2+ column table it does not otherwise recognise to
`{type: figure, referent: table}`, and `lesson_uid_loader._drop_assetless_table_figures`
removes those because a figure with no asset renders as an empty box. So the CONTENT
goes with it. What is being dropped is exercise material:

    動物例子 | 重要細節        柴棺龜、食蛇龜 | 把頭和四肢【 縮進龜殼 】
    事件 | 背後可能的想法（單選）| 情緒感受   1.上課舉手發言… □①天啊… ②幸好…

Young found this by opening 《十秒的背後》 閱讀聚光燈 and asking what
「3.〈𪹚龍慶元宵〉　彭仁星」 was — a prompt whose four sentences were in one of these
tables.

Dropping was the right call when the alternative was an empty box. Carrying the table's
rows is better than either.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))

import pytest


def _lessons():
    from app.services.lesson_loader import get_all_lessons

    return [l for l in get_all_lessons() if l.get("spotlight_v2")]


def _blocks(l):
    return (l.get("spotlight_v2") or {}).get("blocks") or []


def test_no_spotlight_serves_a_figure_that_points_at_a_table_with_no_asset():
    """The shape the loader has to delete. If none are produced, none are lost."""
    bad = [
        (l["lesson_uid"], b)
        for l in _lessons()
        for b in _blocks(l)
        if b.get("type") == "figure" and b.get("referent") == "table" and not b.get("asset")
    ]
    assert bad == [], f"assetless table-figures still produced: {[b[0] for b in bad][:5]}"


def test_the_table_exercises_reach_the_lesson():
    """88 lessons had tables in their spotlight range. They must arrive as content."""
    with_tables = [
        l["lesson_uid"] for l in _lessons()
        if any(b.get("type") == "table" and b.get("rows") for b in _blocks(l))
    ]
    assert len(with_tables) >= 70, (
        f"only {len(with_tables)} lessons carry spotlight tables — 88 have them in the "
        "source, and dropping them is what emptied half the spotlight steps"
    )


def test_a_table_block_carries_readable_cells():
    """Present is not the same as usable: rows must hold text, not empty strings."""
    empty = []
    for l in _lessons():
        for b in _blocks(l):
            if b.get("type") != "table":
                continue
            rows = b.get("rows") or []
            if not rows or not any(any(str(c).strip() for c in row) for row in rows):
                empty.append(l["lesson_uid"])
    assert empty == [], f"table blocks with no readable cells: {empty[:5]}"
