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


def _stratified_pick(per_module_pool: dict[str, list[dict]], n: int) -> list[dict]:
    """#3602 "also": staging QA found AI matches coming back nearly all
    注音 (zhuyin) — ``choice.generate_rounds`` samples uniformly over the
    COMBINED pool across all modules, and zhuyin's source adapter tends to
    produce far more raw items per lesson than the other three, so a
    uniform sample is proportionally dominated by it even though every
    module was "included".

    This does a round-robin draw across ``MODULE_DIFFICULTY_ORDER`` instead
    — one item per module per pass — so every module that has AT LEAST ONE
    item available is guaranteed to appear in the result (as long as there
    are enough modules-with-items to cover ``n``), rather than leaving it to
    chance weighted by how many items that module happened to generate.
    Each module's own list already came back independently seeded-shuffled
    from ``generate_rounds``, so "take the next unused item" is itself a
    random pick within that module, not always index 0."""
    cursors = {m: 0 for m in MODULE_DIFFICULTY_ORDER}
    picked: list[dict] = []
    while len(picked) < n:
        progressed = False
        for module in MODULE_DIFFICULTY_ORDER:
            if len(picked) >= n:
                break
            pool = per_module_pool.get(module, [])
            i = cursors[module]
            if i < len(pool):
                picked.append(pool[i])
                cursors[module] = i + 1
                progressed = True
        if not progressed:
            break  # every module's pool exhausted (caller already validated n <= total)
    return picked


def build_pk_rounds(
    lessons: list[dict], rng: random.Random, *, rounds_per_match: int = ROUNDS_PER_MATCH
) -> list[dict]:
    """``lessons``: same shape live_quiz.engine._load_lessons produces —
    ``[{"lesson_uid": ..., "lesson": <load_lesson() dict>}, ...]``.

    PRD §6.1: PK does not do its own "reading phase" (stem-alone delay) —
    `reading_seconds=0` always.

    Each module is queried independently (capped at ``rounds_per_match``
    items each — we never need more than that from any single module) and
    then combined via ``_stratified_pick`` so the final 5 rounds draw from
    every available module instead of whichever one happens to have the
    biggest raw pool (#3602 "also": question mix was almost all zhuyin).
    """
    per_module_pool: dict[str, list[dict]] = {}
    for module in MODULE_DIFFICULTY_ORDER:
        settings = {
            "seconds": ANSWER_SECONDS,
            "reading_seconds": 0,
            "question_count_mode": int(rounds_per_match),
            "source_modules": [module],
            "shuffle": False,  # we do our own difficulty-ordered sort below
        }
        module_rounds, _fallback_used = choice.generate_rounds(lessons, settings, rng)
        per_module_pool[module] = module_rounds

    total_available = sum(len(v) for v in per_module_pool.values())
    if total_available < rounds_per_match:
        raise HTTPException(
            status_code=400,
            detail=f"這個範圍的題目不夠，無法開始 PK 對戰（至少需要 {rounds_per_match} 題）",
        )
    selected = _stratified_pick(per_module_pool, rounds_per_match)
    return reorder_by_difficulty(selected)
