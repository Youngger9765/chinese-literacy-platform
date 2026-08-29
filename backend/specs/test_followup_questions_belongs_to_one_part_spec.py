"""第一篇專屬的加碼題，不可以出現在其他篇（#2930）。

`keypoints_followup_questions` 自己就寫著 `part_no: 1`、
`instruction: 請依據第一篇文章的內容` —— 它明確屬於第 1 篇。

但它只掛在 detail 頂層、`repeat_rounds` 三輪都沒有，
前端於是無條件顯示 —— 學生在第 2、3 篇的重點表底下也看到
「請依據第一篇文章的內容」的題目。

擁有者 2026-08-27：「我們換了 slug 應該去找到正確資料來 render 才對」。
這一份正是唯一落在 slug 機制外的資料。
"""
from app.services.lesson_loader import get_lesson_by_id
from app.services.lesson_indexes import _rounds_with_flat_paragraphs

LESSON = 20063
FIELD = "keypoints_followup_questions"


def _first_article(lesson: dict) -> str:
    """帳本裡第一篇課文的 slug。"""
    for sec in lesson.get("manifest_sections") or []:
        if sec.get("module") == "full_text_annotate":
            return sec["slug"]
    raise AssertionError("帳本裡沒有課文節 —— 這一課不是多篇？")


def test_followup_questions_exist_at_all():
    """正向對照：這一課真的有加碼題，否則下面兩條測不到東西。"""
    lesson = get_lesson_by_id(LESSON)
    assert lesson is not None, f"找不到 {LESSON}"
    assert lesson.get(FIELD) or any(
        (r or {}).get(FIELD) for r in (lesson.get("repeat_rounds") or {}).values()
    ), "這一課沒有加碼題"


def test_followup_questions_only_on_its_own_part():
    """只有它自己那一篇有；別篇拿不到。"""
    lesson = get_lesson_by_id(LESSON)
    rounds = _rounds_with_flat_paragraphs(lesson)
    assert len(rounds) >= 2, "不是多篇課，換一課測"

    mine = _first_article(lesson)
    has = {slug: bool((mods or {}).get(FIELD)) for slug, mods in rounds.items()}
    assert has.get(mine), f"第 1 篇（{mine}）沒有加碼題 —— 它 part_no 就是 1"
    others = [s for s, ok in has.items() if s != mine and ok]
    assert not others, f"別篇也拿到第一篇專屬的加碼題：{others}"


def test_not_left_bare_on_top_level():
    """送給前端的 detail 頂層不可以掛它 —— 沒覆蓋到的篇次會退回去讀到。

    ⚠️ 要測**送出去的那一份**（build_all_lessons），不是原始 lesson dict：
    原始 yml 當然有這個欄位，測那裡永遠紅，而那不是使用者看到的東西。
    """
    from app.services.lesson_indexes import build_all_lessons

    detail = next((d for d in build_all_lessons() if d.get("lesson_number") == LESSON), None)
    assert detail is not None, f"build_all_lessons 裡找不到 {LESSON}"
    if not (detail.get("repeat_rounds") or {}):
        return   # 單篇課照舊掛頂層
    assert not detail.get(FIELD), (
        "加碼題還掛在 detail 頂層 —— 沒覆蓋到的篇次會退回頂層讀到它，"
        "第 2、3 篇的畫面就會出現「請依據第一篇文章的內容」"
    )
