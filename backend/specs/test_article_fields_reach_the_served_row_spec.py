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
import json
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
    "underlined_terms",   # 課文裡加底線的專有名詞（#3309）
)


def _declared_values(field: str) -> dict[str, list]:
    """課號 → 這一欄在 yml 裡宣告的值（可能多篇，所以是 list）。

    ⛔ 刻意**直接解析 yml**，不走 `_body()`：服務端那一列也是用 `_body()` 取值，
       兩邊共用同一個取值函式的話，`_body()` 自己讀錯東西是看不見的（同義反覆）。
       這裡要當的是獨立的第二個來源。
    """
    out: dict[str, list] = {}
    for f in sorted(LESSONS.glob("L*/v3/full_text_annotate*.yml")):
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        inner = d.get("full_text_annotate") if isinstance(d.get("full_text_annotate"), dict) else d
        if isinstance(inner, dict) and inner.get(field):
            out.setdefault(f.parts[-3], []).append(inner[field])
    return out


def _primary_article_values(uid: str, field: str) -> list:
    """主篇（服務端那一列取值的那一篇）對這一欄宣告了什麼，含明確的空值。

    `_declared_values` 刻意跳過 falsy —— 它問的是「有沒有人宣告」。這裡問的是
    另一件事：「主篇是不是**宣告了但是空的**」。兩者混用會讓「主篇真的沒有」
    跟「根本沒送到」長得一樣，而那是兩個完全不同的狀況。
    """
    out = []
    for f in sorted(LESSONS.glob(f"{uid}/v3/full_text_annotate*.yml")):
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        inner = d.get("full_text_annotate") if isinstance(d.get("full_text_annotate"), dict) else d
        if isinstance(inner, dict) and field in inner:
            out.append(inner[field])
    return out


def _lessons_declaring(field: str) -> list[str]:
    return sorted(_declared_values(field))


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
        declared = _declared_values(field).get(uid) or []
        got = r.get(field)
        # 多篇課的頂層那一列反映的是**主篇**。主篇自己沒有這一欄時，頂層是 None
        # 才對 —— 去撈「隨便哪一篇的第一個非空」會把第二篇的東西掛到第一篇上，
        # 那正是 #2930／L0137 那個 bug（讀第二篇的學生看到第一篇的表）。
        # 每一篇有沒有拿到自己那一份，由
        # `test_each_article_of_a_multi_text_lesson_gets_its_own_fields` 管。
        # ⚠️ 只在「主篇明確宣告成空」時放行，不是「找不到就算了」。
        primary_empty = any(
            isinstance(v, (list, dict, str)) and not v
            for v in _primary_article_values(uid, field)
        )
        if not got and primary_empty:
            continue
        if not got:
            missing.append(f"{uid}（yml 有：{str(declared[:1])[:40]}…，服務端沒有）")
        elif declared and not any(
            json.dumps(got, ensure_ascii=False, sort_keys=True)
            == json.dumps(w, ensure_ascii=False, sort_keys=True)
            for w in declared
        ):
            # ⛔ 只驗 truthy 是不夠的 —— 「有送」跟「送對」是兩件事，
            #    而學生看到的是後者。這裡比的是**直接解析 yml** 得到的值
            #    （多篇課有多個候選，命中任一個就算對；哪一篇該對哪一篇
            #    由 `test_each_article_of_a_multi_text_lesson_gets_its_own_fields` 管）。
            missing.append(
                f"{uid} 送出去的值不在 yml 宣告的那幾份裡：\n"
                f"      yml={str(declared[0])[:70]}\n      服務端={str(got)[:70]}"
            )
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



def test_each_article_of_a_multi_text_lesson_gets_its_own_fields():
    """一課多篇時，每一篇要拿到**自己那一篇**的那五欄（#3277 / 同 #2930 那族）。

    ⛔ 修之前：L0137 是兩篇課（巨石陣／摩艾石像），服務端那一列掛的是第一篇的
       摘要表，而兩個 round 一張表都沒有 —— 於是前端 `scopeDetailToRound` 沒東西
       可覆蓋，**讀第二篇的學生看到第一篇的表**。畫面上看不出異常：有表、畫得出來、
       不報錯，只是那張表講的是別一篇。2026-09-22 由 codex 對抗式複審抓到。

    這一條刻意用「兩篇的值必須不同」當判準，而不是「round 上有值」——
    後者在「兩個 round 都被塞頂層那一份」時照樣綠。
    """
    rows = {l["lesson_uid"]: l for l in build_all_lessons() if l.get("lesson_uid")}
    checked = 0
    per_field: dict[str, int] = {f: 0 for f in CONTENT_FIELDS}
    bad = []
    for uid, r in rows.items():
        rounds = r.get("repeat_rounds") or {}
        if len(rounds) < 2:
            continue
        for field in CONTENT_FIELDS:
            vals = {slug: (rd or {}).get(field) for slug, rd in rounds.items()}
            present = {k: v for k, v in vals.items() if v}
            if len(present) < 2:
                continue
            checked += 1
            per_field[field] += 1
            if len({json.dumps(v, ensure_ascii=False, sort_keys=True)
                    for v in present.values()}) == 1:
                bad.append(f"{uid} 的 `{field}`：{len(present)} 篇拿到**同一份**"
                           f"（{str(list(present.values())[0])[:50]}）")
    assert checked > 0, (
        "沒有任何一課的多篇 round 帶著這幾欄 —— 這條斷言等於沒在測"
    )
    # ⛔ 逐欄的命中數，不是總數。總數 > 0 只要有**任何一欄**被比到就成立，
    #    於是「某一欄根本沒被 carry 出去」會靜默跳過（`present` 是空的就 continue），
    #    而整條測試照樣綠。2026-09-25 實測：把 `underlined_terms` 從 carry 迴圈
    #    拿掉，15 個測試全過 —— 沒有任何東西察覺那一欄在多篇課上消失了。
    # 哪幾欄「應該」比得到 —— 從 yml 推導，不是手寫清單：某一課有 ≥2 篇
    # 各自宣告了非空的值，那一欄就該在上面的迴圈被比到。
    coverable = set()
    for uid in {p.parts[-3] for p in LESSONS.glob("L*/v3/full_text_annotate*.yml")}:
        for field in CONTENT_FIELDS:
            vals = [v for v in _primary_article_values(uid, field) if v]
            if len(vals) >= 2:
                coverable.add(field)
    assert coverable, "沒有任何一欄是多篇課涵蓋得到的 —— 這個推導壞了"

    never_checked = sorted(f for f in coverable if per_field[f] == 0)
    assert not never_checked, (
        f"{never_checked} 有多篇課在 yml 裡各自宣告了值，卻在任何一課的多篇 round 上"
        f"都沒被比對到 —— `_rounds_with_flat_paragraphs` 的 carry 迴圈漏了它。\n"
        f"後果是第二篇拿不到自己那一份，而且完全沒有紅燈。\n"
        f"（2026-09-25 實測：把 `underlined_terms` 從 carry 拿掉，15 個測試全過。）"
    )
    assert not bad, "多篇課拿到別篇的內容：\n  " + "\n  ".join(bad)
