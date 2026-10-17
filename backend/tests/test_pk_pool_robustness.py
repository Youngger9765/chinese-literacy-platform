"""#3610 — one malformed question must not take down a whole question pool,
and a grade with no lessons must not dead-end a student in English.

Test List (Canon TDD, one at a time, each seen red before the fix):

  N1 (bad item kills the pool)
   1. comprehension adapter withholds a question whose CORRECT option is blank
      (L0052 Q3: an image question, D has a picture and no text) — and keeps
      the lesson's other questions.
   2. choice pool: an adapter that raises on one lesson does not fail the
      pool — the other lessons' items still come back.
   3. ...and the skip is logged as a WARNING once per item, not per request.
   4. PK grade-6 pool builds from real data (the staging 500).
   5. PK fails closed, in Chinese, when too few valid items remain.

  N2 (grade with no lessons)
   6. grade_pool "3" falls back to the nearest grade that has a pool,
      preferring the higher one ("3" -> "4", "12" -> "9").
   7. validate_scope accepts a classroom grade with no pool (it will fall
      back) instead of rejecting it in English.
   8. Every student-facing error out of the scope helpers is Chinese.

  Class-level prevention
   9. Whole-library scan: every lesson x every source adapter, through the
      real loader the game uses — every produced item is a valid QuizItem,
      and each module produces > 0 items overall (positive control).
  10. Whole-grade scan: every grade a classroom may carry (schema allows
      1..12) builds a PK round set; every grade pool also builds a 課堂搶答
      round set from all four question types.
"""
from __future__ import annotations

import logging
import random
import re

import pytest
from fastapi import HTTPException

from app.services.lesson_loader import get_available_grades, search_lessons
from app.services.lesson_uid_loader import load_lesson
from app.services.live_quiz.round_types import choice
from app.services.live_quiz.sources import SOURCE_ADAPTERS, base, comprehension
from app.services.live_quiz.sources.base import QuizItem
from app.services.pk import engine
from app.services.pk.rounds import ROUNDS_PER_MATCH, build_pk_rounds

_CJK = re.compile(r"[一-鿿]")


def _assert_chinese(detail: str) -> None:
    assert _CJK.search(str(detail)), f"student-facing error is not Chinese: {detail!r}"


# --------------------------------------------------------------------------- N1


def test_comprehension_withholds_question_whose_correct_option_is_blank():
    lesson = {"title": "t", "version_id": "v3", "comprehension": {"questions": [
        {"index": 1, "stem": "好題？", "answer": "A",
         "options": {"A": "甲", "B": "乙", "C": "丙", "D": "丁"}},
        {"index": 3, "stem": "哪一張圖？", "answer": "D", "options_are_images": True,
         "options": {"A": "藍鯨骨骼標本", "B": "鯊魚", "C": "藍鯨", "D": ""}},
    ]}}
    items = comprehension.generate_items("L9999", lesson)
    assert [i.source_index for i in items] == ["1"]


def test_comprehension_real_l0052_keeps_its_valid_questions():
    lesson = load_lesson("L0052")
    items = comprehension.generate_items("L0052", lesson)
    idx = {i.source_index for i in items}
    assert "3" not in idx           # the blank-answer image question
    assert len(items) >= 3          # the lesson's other questions survive


def _raising_adapter(lesson_uid, lesson, rng=None):
    if lesson_uid == "BAD":
        raise ValueError("QuizItem.correct_key 'D' is not one of its own option keys (fake/BAD)")
    return comprehension.generate_items(lesson_uid, lesson, rng)


def _good_lesson():
    return {"title": "t", "version_id": "v3", "comprehension": {"questions": [
        {"index": n, "stem": f"題{n}", "answer": "A", "options": {"A": "甲", "B": "乙"}}
        for n in range(1, 4)
    ]}}


def test_pool_skips_a_lesson_whose_adapter_raises(monkeypatch):
    monkeypatch.setitem(SOURCE_ADAPTERS, "comprehension", _raising_adapter)
    lessons = [{"lesson_uid": "BAD", "lesson": _good_lesson()},
               {"lesson_uid": "GOOD", "lesson": _good_lesson()}]
    rounds, _ = choice.generate_rounds(lessons, {"source_modules": ["comprehension"]}, random.Random(1))
    assert len(rounds) == 3
    assert {r["payload"]["lesson_uid"] for r in rounds} == {"GOOD"}


def test_skip_is_logged_once_per_item_not_per_request(monkeypatch, caplog):
    monkeypatch.setitem(SOURCE_ADAPTERS, "comprehension", _raising_adapter)
    monkeypatch.setattr(base, "_WARNED", set())
    lessons = [{"lesson_uid": "BAD", "lesson": _good_lesson()}]
    with caplog.at_level(logging.WARNING):
        for _ in range(3):
            choice.generate_rounds(lessons, {"source_modules": ["comprehension"]}, random.Random(1))
    hits = [r for r in caplog.records if "BAD" in r.getMessage()]
    assert len(hits) == 1
    assert hits[0].levelno == logging.WARNING


def test_invalid_item_inside_adapter_is_skipped_and_logged_once(monkeypatch, caplog):
    monkeypatch.setattr(base, "_WARNED", set())
    with caplog.at_level(logging.WARNING):
        for _ in range(2):
            item = base.build_item(
                source_module="comprehension", lesson_uid="LX", lesson_title="t",
                stem="s", options=[base.QuizOption("A", "甲"), base.QuizOption("B", "乙")],
                correct_key="D", source_index="7",
            )
            assert item is None
    assert len([r for r in caplog.records if "LX" in r.getMessage()]) == 1


def test_pk_grade_6_pool_builds_from_real_data():
    lessons = engine._load_lessons_for_scope("grade_pool", "6")
    rounds = build_pk_rounds(lessons, random.Random(3610))
    assert len(rounds) == ROUNDS_PER_MATCH


def test_pk_fails_closed_in_chinese_when_too_few_valid_items():
    lessons = [{"lesson_uid": "L9999", "lesson": {"title": "t", "comprehension": {"questions": [
        {"index": 1, "stem": "哪一張圖？", "answer": "D",
         "options": {"A": "甲", "B": "乙", "C": "丙", "D": ""}},
    ]}}}]
    with pytest.raises(HTTPException) as ei:
        build_pk_rounds(lessons, random.Random(1))
    assert ei.value.status_code == 400
    _assert_chinese(ei.value.detail)


# --------------------------------------------------------------------------- N2


@pytest.mark.parametrize("grade,expected", [("1", "4"), ("3", "4"), ("10", "9"), ("12", "9"), ("6", "6")])
def test_grade_without_pool_falls_back_to_nearest_higher_first(grade, expected):
    assert engine.resolve_pool_grade(grade) == expected
    lessons = engine._load_lessons_for_scope("grade_pool", grade)
    got = {str(e["lesson"].get("grade") or "") for e in lessons}
    expected_uids = {e["lesson_uid"] for e in search_lessons(grade=expected)}
    assert {e["lesson_uid"] for e in lessons} == expected_uids, got


def test_validate_scope_accepts_a_classroom_grade_with_no_pool():
    engine.validate_scope("grade_pool", "3")  # must not raise


@pytest.mark.parametrize("scope_type,scope_ref", [
    ("grade_pool", "abc"), ("grade_pool", "0"), ("lesson", "L-NOPE"), ("nope", "x"),
])
def test_scope_errors_are_chinese(scope_type, scope_ref):
    for fn in (engine.validate_scope, engine._load_lessons_for_scope):
        with pytest.raises(HTTPException) as ei:
            fn(scope_type, scope_ref)
        assert ei.value.status_code == 400
        _assert_chinese(ei.value.detail)


# ------------------------------------------------------------- class prevention


def _all_lessons_as_served():
    out = []
    for entry in search_lessons():
        uid = entry.get("lesson_uid")
        lesson = load_lesson(uid) if uid else None
        if lesson is not None:
            out.append((uid, lesson))
    return out


def test_every_lesson_every_source_produces_only_valid_items(monkeypatch):
    """Calls each adapter directly with the dict the games actually use
    (``load_lesson``) — an item that fails ``QuizItem`` validation must
    never come out of an adapter (it would either crash a pool or, now, be
    silently dropped; both mean the adapter's own filter is wrong)."""
    dropped: list[str] = []
    real_build = base.build_item

    def _spy(**kw):
        item = real_build(**kw)
        if item is None:
            dropped.append(f"{kw.get('source_module')}/{kw.get('lesson_uid')}#{kw.get('source_index')}")
        return item

    monkeypatch.setattr(base, "build_item", _spy)
    lessons = _all_lessons_as_served()
    assert len(lessons) >= 150, "positive control: the loader must actually see the library"
    per_module = {m: 0 for m in SOURCE_ADAPTERS}
    for uid, lesson in lessons:
        for module, adapter in SOURCE_ADAPTERS.items():
            items = adapter(uid, lesson, random.Random(uid))
            for it in items:
                assert isinstance(it, QuizItem)
                assert it.correct_key in {o.key for o in it.options}
                assert all(str(o.text).strip() for o in it.options), f"blank option in {it.item_id}"
            per_module[module] += len(items)
    assert dropped == [], f"adapter produced items that fail validation: {dropped[:10]}"
    for module, n in per_module.items():
        assert n > 0, f"positive control: {module} produced 0 items across the whole library"


@pytest.mark.parametrize("grade", [str(g) for g in range(1, 13)])
def test_every_classroom_grade_builds_a_pk_match(grade):
    lessons = engine._load_lessons_for_scope("grade_pool", grade)
    rounds = build_pk_rounds(lessons, random.Random(int(grade)))
    assert len(rounds) == ROUNDS_PER_MATCH


@pytest.mark.parametrize("grade", [str(g) for g in get_available_grades()])
def test_every_grade_pool_builds_a_live_quiz_game(grade):
    lessons = [{"lesson_uid": e["lesson_uid"], "lesson": load_lesson(e["lesson_uid"])}
               for e in search_lessons(grade=grade) if e.get("lesson_uid")]
    lessons = [x for x in lessons if x["lesson"] is not None]
    rounds, _ = choice.generate_rounds(lessons, {"source_modules": list(SOURCE_ADAPTERS)}, random.Random(1))
    assert len(rounds) > 0
