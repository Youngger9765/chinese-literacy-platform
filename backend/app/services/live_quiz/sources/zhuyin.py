"""注音挑戰 (zhuyin) question source — thin adapter over the independent
``zhuyin_challenge`` module (its own PR, #3551, merged into staging as
commit 14a821116).

This file owns NOTHING about how a zhuyin question is generated — it only
reshapes ``ZhuyinQuestion`` into the ``QuizItem`` shape every other source
adapter already produces, per PRD independence rule #2 ("要加新題型，只
新增一支 adapter、在清單登記，不改引擎").

UI/UX review 2026-10-15 #10: the stem is zhuyin_challenge's own
``sentence`` field, which is verified PLAIN TEXT (no embedded zhuyin
annotation — confirmed by calling the real function against real lesson
data, not just reading its docstring). ``target_index`` goes into
``QuizItem.extra`` so the frontend can bold/underline that one character
without the backend ever rendering zhuyin into the stem itself. Options
may be 2-3 zhuyin strings (not always 4) — the host layout adapts
(1x2/1x3) per §12; this adapter does not pad to 4.
"""
from __future__ import annotations

import random

from ...zhuyin_challenge import generate_zhuyin_questions
from . import base
from .base import QuizItem, QuizOption

_KEYS = ("A", "B", "C", "D")


def generate_items(lesson_uid: str, lesson: dict, rng: random.Random | None = None) -> list[QuizItem]:
    rng = rng or random.Random(0)
    # zhuyin_challenge is deterministic per (lesson_uid, seed) and loads its
    # OWN data (zhuyin.json / font_readings.json) — it never reads `lesson`.
    # The seed is derived from this game's rng so a game's zhuyin rounds are
    # reproducible from its own seed, same as every other source.
    seed = rng.randint(0, 2**31 - 1)
    questions = generate_zhuyin_questions(lesson_uid, seed=seed)

    lesson_title = lesson.get("title") or lesson_uid
    version_id = lesson.get("version_id") or ""

    items: list[QuizItem] = []
    for q in questions:
        if not (2 <= len(q.options) <= 4):
            continue
        if not (0 <= q.answer_index < len(q.options)):
            continue
        keys = _KEYS[: len(q.options)]
        quiz_options = [QuizOption(key=k, text=reading) for k, reading in zip(keys, q.options)]
        correct_key = keys[q.answer_index]
        # #3610: build_item drops (and logs once) a row that fails
        # QuizItem validation instead of failing the whole pool.
        item = base.build_item(
            source_module="zhuyin",
            lesson_uid=lesson_uid,
            lesson_title=lesson_title,
            version_id=version_id,
            source_index=q.id,
            stem=q.sentence,
            options=quiz_options,
            correct_key=correct_key,
            extra={"target_index": q.target_index},
        )
        if item is not None:
            items.append(item)
    return items
