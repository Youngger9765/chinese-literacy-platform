"""語詞應用 (vocab_application) question source — PRD §3.

"選出填入空格的詞，選項取自選項庫" — stem is the fill-in-the-blank
sentence, the correct option is the lesson's own answer code resolved to its
word, distractors come from the same lesson's ``option_bank``.
"""
from __future__ import annotations

import random

from . import base
from .base import QuizItem, QuizOption

_KEYS = ("A", "B", "C", "D")


def generate_items(lesson_uid: str, lesson: dict, rng: random.Random | None = None) -> list[QuizItem]:
    rng = rng or random.Random(0)
    va = lesson.get("vocab_application")
    if not isinstance(va, dict):
        return []
    option_bank = va.get("option_bank")
    items_raw = va.get("items")
    if not isinstance(option_bank, dict) or not isinstance(items_raw, list):
        return []
    bank_codes = list(option_bank.keys())
    if len(bank_codes) < 2:
        return []
    lesson_title = lesson.get("title") or lesson_uid
    version_id = lesson.get("version_id") or ""

    items: list[QuizItem] = []
    for entry in items_raw:
        if not isinstance(entry, dict):
            continue
        stem = entry.get("stem")
        answer_code = entry.get("answer")
        if not stem or not answer_code or answer_code not in option_bank:
            continue
        correct_word = option_bank[answer_code]
        if not correct_word:
            continue
        candidate_codes = [c for c in bank_codes if c != answer_code and option_bank[c]]
        if not candidate_codes:
            continue
        n_distractors = min(3, len(candidate_codes))
        distractor_codes = rng.sample(candidate_codes, n_distractors)
        words = [correct_word] + [option_bank[c] for c in distractor_codes]
        rng.shuffle(words)
        quiz_options = [QuizOption(key=_KEYS[i], text=w) for i, w in enumerate(words)]
        correct_key = _KEYS[words.index(correct_word)]
        # #3610: build_item drops (and logs once) a row that fails
        # QuizItem validation instead of failing the whole pool.
        item = base.build_item(
            source_module="vocab_application",
            lesson_uid=lesson_uid,
            lesson_title=lesson_title,
            version_id=version_id,
            source_index=str(entry.get("index", "")),
            stem=str(stem),
            options=quiz_options,
            correct_key=correct_key,
        )
        if item is not None:
            items.append(item)
    return items
