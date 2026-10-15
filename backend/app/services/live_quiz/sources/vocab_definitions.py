"""語詞我最棒 (vocab_definitions) question source — PRD §3.

"看解釋選詞語，誘答取同課詞庫" — stem is the printed definition, the
correct option is the word it defines, distractors come from the same
lesson's ``vocabulary_bank`` (its own glossary, never another lesson's).
"""
from __future__ import annotations

import random

from .base import QuizItem, QuizOption

_KEYS = ("A", "B", "C", "D")


def generate_items(lesson_uid: str, lesson: dict, rng: random.Random | None = None) -> list[QuizItem]:
    rng = rng or random.Random(0)
    vd = lesson.get("vocab_definitions")
    if not isinstance(vd, dict):
        return []
    bank = vd.get("vocabulary_bank")
    items_raw = vd.get("items")
    if not isinstance(bank, list) or not isinstance(items_raw, list):
        return []
    # De-duplicate while keeping stable candidate order for distractor pools.
    bank_unique = list(dict.fromkeys(w for w in bank if isinstance(w, str) and w.strip()))
    if len(bank_unique) < 2:
        return []
    lesson_title = lesson.get("title") or lesson_uid
    version_id = lesson.get("version_id") or ""

    items: list[QuizItem] = []
    for entry in items_raw:
        if not isinstance(entry, dict):
            continue
        word = entry.get("word")
        definition = entry.get("definition")
        if not word or not definition or word not in bank_unique:
            continue
        candidates = [w for w in bank_unique if w != word]
        if not candidates:
            continue
        n_distractors = min(3, len(candidates))
        distractors = rng.sample(candidates, n_distractors)
        words = [word] + distractors
        rng.shuffle(words)
        quiz_options = [QuizOption(key=_KEYS[i], text=w) for i, w in enumerate(words)]
        correct_key = _KEYS[words.index(word)]
        items.append(
            QuizItem(
                source_module="vocab_definitions",
                lesson_uid=lesson_uid,
                lesson_title=lesson_title,
                version_id=version_id,
                source_index=str(entry.get("index", "")),
                stem=str(definition),
                options=quiz_options,
                correct_key=correct_key,
            )
        )
    return items
