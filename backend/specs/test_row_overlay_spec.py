"""row 算過的欄位，不可以被 lesson.yml 的原始欄位蓋掉（#2916）。

`_uid_tree_lessons` 先逐欄組一個 row，最後跑一個 overlay 迴圈把 lesson.yml
自己帶的欄位覆蓋上去。欄名撞到時，**你算的那份會被原值取代** ——
沒有錯誤、型別也對，只是計算白做了。

已經踩過三次，每次症狀都不一樣、都很難追：
    `parts`             → 篇次 0/5 課拿得到
    `repeat_rounds`     → 攤平好的段落被 [{idx,text}] 蓋回去，讀全文整頁當掉
    `manifest_sections` → 兩份形狀不同互蓋，type/number 全變 None

所以這裡不再靠記憶，改成每次 CI 都問一遍。
"""
from __future__ import annotations

import pytest

from app.services.lesson_indexes import _uid_tree_lessons
from app.services.lesson_uid_loader import _latest_version, _is_uid_dir, load_lesson

#: 這些欄位 row 會重新計算 / 加工，原始 payload 不可以蓋掉它們。
COMPUTED = {
    "repeat_rounds": "每一輪多了攤平好的 paragraphs",
    "manifest_sections": "帳本，形狀跟原始一致但由 row 決定",
    "paragraphs": "從 [{idx,text}] 攤平成字串陣列",
    "part_rounds": "篇次摘要，附各節自己的代號",
    "step_sequence": "照帳本算出來的步驟順序",
}


@pytest.fixture(scope="module")
def rows():
    return {r.get("lesson_uid"): r for r in _uid_tree_lessons()}


def test_the_corpus_is_there(rows):
    assert len(rows) > 150, f"只載到 {len(rows)} 課"


def test_which_computed_fields_can_actually_collide(rows):
    """先分清楚：哪些計算欄位的名字，lesson.yml 自己也有？

    只有這些會被 overlay 蓋到。沒撞名的欄位安全，但**要點名**——
    哪天某課的 yml 長出同名欄位，這條會先變，而不是等瀏覽器當掉。
    """
    collides = set()
    for uid in rows:
        raw = load_lesson(uid)
        for f in COMPUTED:
            if raw.get(f) not in (None, "", [], {}):
                collides.add(f)
    assert collides == {"repeat_rounds", "manifest_sections"}, (
        f"會撞名的計算欄位變了：{sorted(collides)}。"
        f"新撞到的那個要加進 `_IDENTITY`，否則它的計算值會被原值蓋掉。")


def test_round_paragraphs_survive_the_overlay(rows):
    """`repeat_rounds` 的加工（每輪攤平好的 paragraphs）不可以被蓋掉。

    這正是 2026-08-25 讀全文整頁當掉的原因：row 把攤平好的放進去，
    overlay 迴圈用原始的 `[{idx,text}]` 蓋回來，前端拿去 render 就炸了。
    """
    checked = bad = 0
    for uid, row in rows.items():
        raw_rounds = load_lesson(uid).get("repeat_rounds") or {}
        if not raw_rounds:
            continue
        checked += 1
        if not any((m or {}).get("paragraphs") for m in (row.get("repeat_rounds") or {}).values()):
            bad += 1
    assert checked >= 5, f"只驗到 {checked} 課有多輪 —— 這條測不到東西"
    assert bad == 0, f"{bad} 課的輪次沒有攤平好的段落 —— 被原值蓋掉了"


def test_top_level_paragraphs_are_flat_strings(rows):
    """頂層 `paragraphs` 是字串陣列，不是 `[{idx,text}]`。"""
    bad = [uid for uid, r in rows.items()
           if (r.get("paragraphs") or []) and isinstance(r["paragraphs"][0], dict)]
    have = sum(1 for r in rows.values() if r.get("paragraphs"))
    assert have > 150, f"只有 {have} 課有段落 —— 這條測不到東西"
    assert not bad, f"這些課的段落沒攤平: {bad[:6]}"


def test_the_guard_list_actually_covers_the_colliding_names(rows):
    """反向：凡是 row 有、lesson.yml 也有的**計算**欄位，都要在 `_IDENTITY` 裡。

    這條是給未來的人看的 —— 加了新的計算欄位又剛好跟 yml 撞名時，
    這裡會先紅，而不是等到某一頁在瀏覽器裡當掉。
    """
    import inspect
    from app.services import lesson_indexes
    src = inspect.getsource(lesson_indexes._uid_tree_lessons)
    missing = [f for f in COMPUTED if f'"{f}"' not in src.split("_IDENTITY = ")[1].split("}")[0]
               and f in ("repeat_rounds", "manifest_sections")]
    assert not missing, f"這些計算欄位沒進 _IDENTITY: {missing}"
