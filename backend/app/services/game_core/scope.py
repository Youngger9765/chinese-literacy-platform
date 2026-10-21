"""Shared `scope_type`/`scope_ref` resolution for student-self-serve game
modes — extracted verbatim (behavior-identical, including every error
string) from `services/pk/engine.py` and `services/escape_room/engine.py`,
which had carried byte-identical copies of all four functions below since
their respective PRDs (see `docs/architecture/game-modules.md` §duplication
for the file:line evidence this was built from).

A "scope" is how a student picks what they're about to be quizzed on:
  - ``scope_type == "lesson"``:     one specific lesson, ``scope_ref`` = its
    ``lesson_uid``.
  - ``scope_type == "grade_pool"``: every lesson in a grade's library,
    ``scope_ref`` = the grade as a string (``"1"``..``"12"``, or a
    non-numeric pool name such as 品格教育／文言文 that only ever resolves
    to itself).

Every function here is pure/read-only except for raising ``HTTPException``
on bad input — no DB writes, no module carries any per-call state.
"""
from __future__ import annotations

from fastapi import HTTPException

from ..lesson_loader import get_available_grades, search_lessons
from ..lesson_uid_loader import load_lesson

ERR_UNKNOWN_LESSON = "找不到這一課的題目，請回上一頁重新選擇"
ERR_UNKNOWN_GRADE = "找不到這個年級的題庫，請回上一頁重新選擇"
ERR_UNKNOWN_SCOPE = "不支援這種題目範圍，請回上一頁重新選擇"
ERR_EMPTY_POOL = "這個年級目前還沒有題目，請改選其他範圍"

# #3610: grade-3 classrooms exist (demo 三年甲班) but the library starts at
# grade 4, so a numeric classroom grade with no lessons of its own falls
# back to the NEAREST grade that has some, preferring the higher one on a
# tie ("學得會" over "太簡單" is a wash at equal distance; a slightly harder
# pool is still on-level practice, an easier one is review).
_CLASSROOM_GRADE_RANGE = range(1, 13)


def resolve_pool_grade(scope_ref: str) -> str:
    """The grade whose lessons a ``grade_pool`` scope actually draws from.
    Non-numeric pools (品格教育／文言文) are only ever valid as themselves."""
    available = [str(g) for g in get_available_grades()]
    if scope_ref in available:
        return scope_ref
    try:
        wanted = int(scope_ref)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=ERR_UNKNOWN_GRADE)
    if wanted not in _CLASSROOM_GRADE_RANGE:
        raise HTTPException(status_code=400, detail=ERR_UNKNOWN_GRADE)
    numeric = sorted(int(g) for g in available if g.isdigit())
    if not numeric:
        raise HTTPException(status_code=400, detail=ERR_EMPTY_POOL)
    best = min(numeric, key=lambda g: (abs(g - wanted), -g))
    return str(best)


def validate_scope(scope_type: str, scope_ref: str) -> None:
    if scope_type == "lesson":
        if load_lesson(scope_ref) is None:
            raise HTTPException(status_code=400, detail=ERR_UNKNOWN_LESSON)
    elif scope_type == "grade_pool":
        resolve_pool_grade(scope_ref)
    else:
        raise HTTPException(status_code=400, detail=ERR_UNKNOWN_SCOPE)


def load_lessons_for_scope(scope_type: str, scope_ref: str) -> list[dict]:
    if scope_type == "lesson":
        lesson = load_lesson(scope_ref)
        if lesson is None:
            raise HTTPException(status_code=400, detail=ERR_UNKNOWN_LESSON)
        return [{"lesson_uid": scope_ref, "lesson": lesson}]
    if scope_type != "grade_pool":
        raise HTTPException(status_code=400, detail=ERR_UNKNOWN_SCOPE)
    results = search_lessons(grade=resolve_pool_grade(scope_ref))
    lessons = []
    for entry in results:
        uid = entry.get("lesson_uid")
        if not uid:
            continue
        lesson = load_lesson(uid)
        if lesson is not None:
            lessons.append({"lesson_uid": uid, "lesson": lesson})
    if not lessons:
        raise HTTPException(status_code=400, detail=ERR_EMPTY_POOL)
    return lessons
