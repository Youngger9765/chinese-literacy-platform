"""課文模組裡「印在學習單上的內容」欄位，必須真的送到服務端的那一列。

`lesson_indexes.py` 組的那一列是**逐欄寫死的字典**，檔案裡自己就寫著警告：

    ⚠️ 沒有宣告在這裡的欄位，loader 讀到了也永遠送不出去，
      而且不會有任何錯誤或紅燈

這道門就是那句警告的機器版。2026-09-22 實測到的後果：13 份 yml 帶著五種
表格／出處欄位，後端與前端**各 0 處引用** —— 抽出來了、過了逐字門、
學生看不到。L0035 的 `source_line` 從 #2736 就在檔案裡。

⛔ 這裡列的是「印出來給學生看的內容」，不是註記。要新增一欄的正確做法是
   先把它接進 row，再列進來 —— 不是把它從這裡刪掉。
"""
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import pytest  # noqa: E402
import yaml  # noqa: E402

from app.services.lesson_indexes import (  # noqa: E402
    _body,
    _uid_tree_lessons,
    build_all_lessons,
)

LESSONS = _BACKEND / "data" / "lessons"

# 印在學習單上、學生該看得到的課文層欄位
CONTENT_FIELDS = (
    "source_line",        # 本課選自…
    "inline_table",       # 正文裡的單一表格
    "inline_tables",      # 正文裡的多個表格
    "comparison_table",   # 對照表
    "summary_table",      # 摘要表
)


def _lessons_declaring(field: str) -> list[str]:
    out = []
    for f in sorted(LESSONS.glob("L*/v3/full_text_annotate*.yml")):
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        inner = d.get("full_text_annotate") if isinstance(d.get("full_text_annotate"), dict) else d
        if isinstance(inner, dict) and inner.get(field):
            out.append(f.parts[-3])
    return sorted(set(out))


@pytest.mark.parametrize("field", CONTENT_FIELDS)
def test_the_field_is_declared_by_at_least_one_lesson(field):
    """對照組：沒有任何一課用它，這一欄的斷言就什麼都沒證明。"""
    assert _lessons_declaring(field), (
        f"沒有任何一課的 yml 宣告 `{field}` —— 這一欄要嘛拼錯、要嘛該從清單移除"
    )


@pytest.mark.parametrize("field", CONTENT_FIELDS)
def test_every_declaring_lesson_serves_the_field(field):
    rows = {l["id"]: l for l in build_all_lessons()}
    raw = {l["lesson_uid"]: l for l in _uid_tree_lessons() if l.get("lesson_uid")}
    missing = []
    for uid in _lessons_declaring(field):
        r = rows.get(20000 + int(uid[1:]))
        if r is None:
            continue
        if not r.get(field):
            want = _body(raw[uid]).get(field) if uid in raw else "?"
            missing.append(f"{uid}（yml 有：{str(want)[:40]}…，服務端沒有）")
    assert not missing, (
        f"`{field}` 在 yml 裡但沒送到服務端的那一列：\n  " + "\n  ".join(missing) +
        "\n\n→ 到 `lesson_indexes.py` 組 row 的那個字典裡加上這一欄。"
    )


# ── 不住在課文層底下的那兩處（#3277）──────────────────────────────────────
#
# 上面那組欄位住在 `full_text_annotate` 底下，所以接到 `_body()` 就對了。
# 這兩課不是，而我第一版的六個探針**剛好全挑到 full_text_annotate 那幾課** ——
# 正好是盲區。它們各自屬於自己那個位置，提到課文層會印在錯的地方：
#
#   L0096  出處行屬於聚光燈裡那段文章       → 走 spotlight_v2 整包穿透
#   L0150  出處行屬於選擇題附的那張表       → 走 multiple_choice 的 material_table
#
# ⚠️ L0150 比「少一行出處」嚴重：第 4 題問的就是那張 PISA 排名表，
#    表沒送 = 學生被要求讀一張看不到的表。


def test_the_mcq_material_table_reaches_the_student():
    """L0150 第 4 題附的那張表要跟題目一起送出去。"""
    rows = {l["id"]: l for l in build_all_lessons()}
    r = rows.get(20150)
    assert r is not None, "L0150 不在服務端"
    mcq = r.get("multiple_choice") or []
    assert mcq, "L0150 的 multiple_choice 是空的 —— 題目本身就沒送出去"
    with_table = [q for q in mcq if q.get("material_table")]
    assert with_table, (
        "L0150 有一題附了 `material_table`（PISA 排名表），但送到學生面前的題目裡"
        "一張表都沒有 —— 那一題是在問一張看不到的表。\n"
        "→ `lesson_indexes.py` 的 `_mcq_from()` 要把 `material_table` 帶出去。"
    )
    t = with_table[0]["material_table"]
    assert t.get("rows"), "表送出去了但沒有列"
    assert t.get("source_line"), "表的出處行（資料來源：…）掉了"


def test_the_spotlight_passage_source_line_reaches_the_student():
    """L0096 聚光燈那段文章的出處行要跟著 block 一起送出去。"""
    rows = {l["id"]: l for l in build_all_lessons()}
    r = rows.get(20096)
    assert r is not None, "L0096 不在服務端"
    blocks = ((r.get("spotlight_v2") or {}).get("blocks")) or []
    assert blocks, "L0096 的 spotlight_v2 沒有 blocks"
    passages = [b for b in blocks if b.get("type") == "passage"]
    assert passages, "L0096 的聚光燈沒有 passage block"
    assert any(b.get("source_line") for b in passages), (
        "L0096 的 yml 在 passage block 裡寫了 `source_line`"
        "（〈節選自國語日報網路新聞…〉），但送出去的 block 沒帶它"
    )
