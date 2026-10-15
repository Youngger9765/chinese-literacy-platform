"""閱讀理解 (comprehension) question source — PRD §3 第一期題庫.

888 questions across ~150 lessons, already shaped as single-answer A-D
multiple choice — "原題照用" per the PRD. The one thing this adapter filters
is CTO review item #5: a handful of comprehension answers carry a teacher's
handwritten correction (e.g. "A/C", "A（見下）") instead of a single A-D
letter — "轉接層只收「正解是單一 A–D」的題目".
"""
from __future__ import annotations

from .base import QuizItem, QuizOption

_VALID_KEYS = ("A", "B", "C", "D")


def generate_items(lesson_uid: str, lesson: dict, rng=None) -> list[QuizItem]:
    # rng unused: comprehension options are already fixed A-D, nothing to
    # shuffle or sample. Accepted only so the source-adapter registry can
    # call every adapter with the same signature.
    del rng
    comp = lesson.get("comprehension")
    if not isinstance(comp, dict):
        return []
    questions = comp.get("questions")
    if not isinstance(questions, list):
        return []
    lesson_title = lesson.get("title") or lesson_uid
    version_id = lesson.get("version_id") or ""

    items: list[QuizItem] = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        stem = q.get("stem")
        options = q.get("options")
        answer = q.get("answer")
        if not stem or not isinstance(options, dict):
            continue
        # Single A-D answer only (CTO review #5) — skip multi-answer /
        # handwritten-correction rows such as "A/C" or "見下".
        if not isinstance(answer, str) or answer not in _VALID_KEYS:
            continue
        if answer not in options:
            continue
        quiz_options = [
            QuizOption(key=k, text=str(options[k]))
            for k in _VALID_KEYS
            if k in options and options[k]
        ]
        if len(quiz_options) < 2:
            continue
        items.append(
            QuizItem(
                source_module="comprehension",
                lesson_uid=lesson_uid,
                lesson_title=lesson_title,
                version_id=version_id,
                source_index=str(q.get("index", "")),
                stem=stem,
                options=quiz_options,
                correct_key=answer,
            )
        )
    return items
