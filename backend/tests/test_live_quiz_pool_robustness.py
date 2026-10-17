"""#3616 (prod hotfix, backport of the live_quiz half of #3610/#3613) —
one malformed question must not take down a whole 課堂搶答 question pool.

L0052 comprehension Q3 is an image question whose correct option D has no
text in the source worksheet. The comprehension adapter dropped the blank
option but kept answer D, so ``QuizItem`` validation raised and every
live-quiz game including L0052 + comprehension returned 500 on production.

Deliberately imports nothing from ``app.services.pk`` — PK does not exist
on main.
"""
from __future__ import annotations

import logging
import random

from app.services.lesson_loader import get_available_grades, search_lessons
from app.services.lesson_uid_loader import load_lesson
from app.services.live_quiz.round_types import choice
from app.services.live_quiz.sources import SOURCE_ADAPTERS, base, comprehension
from app.services.live_quiz.sources.base import QuizItem


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
    """Every lesson x every live_quiz source adapter, through the loader the
    game uses — an item that fails ``QuizItem`` validation must never come
    out of an adapter. Positive control: each source yields > 0 items."""
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


def test_every_grade_pool_builds_a_live_quiz_game():
    grades = [str(g) for g in get_available_grades()]
    assert "6" in grades, "positive control: grade 6 (the prod 500) must be in the scan"
    for grade in grades:
        lessons = [{"lesson_uid": e["lesson_uid"], "lesson": load_lesson(e["lesson_uid"])}
                   for e in search_lessons(grade=grade) if e.get("lesson_uid")]
        lessons = [x for x in lessons if x["lesson"] is not None]
        assert lessons, f"positive control: grade {grade} has no lessons"
        for modules in (list(SOURCE_ADAPTERS), ["comprehension"]):
            rounds, _ = choice.generate_rounds(lessons, {"source_modules": modules}, random.Random(1))
            assert len(rounds) > 0, f"grade {grade} {modules}"
