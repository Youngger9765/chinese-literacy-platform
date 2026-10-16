"""PK round generation — PRD §4/§6/§6.1.

Reuses `live_quiz`'s `round_types.choice.generate_rounds` wholesale (PRD
§6.1: "直接呼叫 generate_rounds(lessons, settings, rng)...per-game seeded
shuffle 防正解外洩的機制也原樣沿用") — this module's only addition is
re-sorting the result into the easy-to-hard module order PRD §4 specifies,
which `generate_rounds` itself has no concept of.
"""
from __future__ import annotations

import random

from fastapi import HTTPException

from ..live_quiz.round_types import choice

ROUNDS_PER_MATCH = 5
ANSWER_SECONDS = 20

# PRD §4: "5 題依來源模組排序：語詞理解 → 語詞應用 → 注音挑戰 → 閱讀理解".
# 語詞理解 = vocab_definitions ("看解釋選詞語"), 語詞應用 = vocab_application
# ("選出填入空格的詞"), 注音挑戰 = zhuyin, 閱讀理解 = comprehension.
MODULE_DIFFICULTY_ORDER = ("vocab_definitions", "vocab_application", "zhuyin", "comprehension")
_MODULE_RANK = {m: i for i, m in enumerate(MODULE_DIFFICULTY_ORDER)}


def reorder_by_difficulty(rounds: list[dict]) -> list[dict]:
    """Stable sort by module rank, then reassign round_index 0..n-1.

    Stability is the whole point (PRD §4: "同模組內的題目順序維持原本的隨機
    排列") — Python's `sorted()` is guaranteed stable, so items already in
    (random) pool order only get grouped by module, never re-shuffled
    within a module.
    """
    ordered = sorted(rounds, key=lambda r: _MODULE_RANK.get(r["payload"]["source_module"], 999))
    return [{**r, "round_index": i} for i, r in enumerate(ordered)]


def build_pk_rounds(
    lessons: list[dict], rng: random.Random, *, rounds_per_match: int = ROUNDS_PER_MATCH
) -> list[dict]:
    """``lessons``: same shape live_quiz.engine._load_lessons produces —
    ``[{"lesson_uid": ..., "lesson": <load_lesson() dict>}, ...]``.

    PRD §6.1: PK does not do its own "reading phase" (stem-alone delay) —
    `reading_seconds=0` always.
    """
    settings = {
        "seconds": ANSWER_SECONDS,
        "reading_seconds": 0,
        "question_count_mode": int(rounds_per_match),
        "source_modules": list(MODULE_DIFFICULTY_ORDER),
        "shuffle": False,  # we do our own difficulty-ordered sort below
    }
    pool_rounds, _fallback_used = choice.generate_rounds(lessons, settings, rng)
    if len(pool_rounds) < rounds_per_match:
        raise HTTPException(
            status_code=400,
            detail=f"這個範圍的題目不夠，無法開始 PK 對戰（至少需要 {rounds_per_match} 題）",
        )
    return reorder_by_difficulty(pool_rounds)
