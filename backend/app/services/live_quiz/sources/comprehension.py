"""閱讀理解 (comprehension) question source — PRD §3 第一期題庫.

888 questions across ~150 lessons, already shaped as single-answer A-D
multiple choice — "原題照用" per the PRD. The one thing this adapter filters
is CTO review item #5: a handful of comprehension answers carry a teacher's
handwritten correction (e.g. "A/C", "A（見下）") instead of a single A-D
letter — "轉接層只收「正解是單一 A–D」的題目".
"""
from __future__ import annotations

from . import base
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
        # #3621: some comprehension options are a DRAWING, not text
        # (「下列哪一張圖…」questions) — `option_images` carries the asset
        # filename per letter, built the same way `lesson_indexes._mcq_from`
        # does for the student-facing API so the two never disagree on
        # which questions are servable.
        img_map = q.get("option_images")
        img_map = img_map if isinstance(img_map, dict) else {}

        def _image_url(key: str, _img_map: dict = img_map) -> str | None:
            fname = _img_map.get(key)
            return f"/assets/lesson/{lesson_uid}/{fname}" if fname else None

        # #3610 + #3621: the correct option's text can be blank when the
        # real content is a picture. Withhold the question only when the
        # answer has NEITHER text NOR an image — same rule the lesson API
        # already applies (lesson_indexes.py, "正解那一格是空的 → 這一題
        # 答不出來"), now extended to also check for an image.
        if not str(options.get(answer) or "").strip() and not _image_url(answer):
            continue
        quiz_options = [
            QuizOption(key=k, text=str(options[k] or ""), image=_image_url(k))
            for k in _VALID_KEYS
            if k in options and (str(options[k] or "").strip() or _image_url(k))
        ]
        if len(quiz_options) < 2:
            continue
        # issue #3631 P0 #2: 50/180 comprehension yml files carry an
        # `explanation` key per question (the source worksheet's printed
        # answer rationale) — carried through as-is, no other adapter has
        # this field. A non-string/blank value is treated the same as
        # absent so `QuizItem.explanation` stays `str | None`, never "".
        explanation = q.get("explanation")
        explanation = str(explanation).strip() or None if explanation else None

        # #3610: build_item drops (and logs once) a row that fails
        # QuizItem validation instead of failing the whole pool.
        item = base.build_item(
            source_module="comprehension",
            lesson_uid=lesson_uid,
            lesson_title=lesson_title,
            version_id=version_id,
            source_index=str(q.get("index", "")),
            stem=stem,
            options=quiz_options,
            correct_key=answer,
            explanation=explanation,
        )
        if item is not None:
            items.append(item)
    return items
