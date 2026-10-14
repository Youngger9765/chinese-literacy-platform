"""Cross-cutting score modifiers — applied by the engine, never by a round type.

These three settings (double_points_last / streak_bonus / practice_mode) are
about the GAME, not about any particular question shape, so they live here
rather than inside ``round_types/choice.py`` — a future word-search round
type gets them for free.
"""
from __future__ import annotations

STREAK_BONUS_PER_STEP = 100
STREAK_BONUS_CAP = 300


def streak_bonus(new_streak: int) -> int:
    """+100 per consecutive correct answer beyond the first, capped at +300.

    new_streak=1 (first correct in a row) -> 0
    new_streak=2                          -> 100
    new_streak=3                          -> 200
    new_streak>=4                         -> 300 (cap)
    """
    if new_streak <= 1:
        return 0
    return min((new_streak - 1) * STREAK_BONUS_PER_STEP, STREAK_BONUS_CAP)


def apply_modifiers(
    *,
    base_points: int,
    is_correct: bool,
    is_last_round: bool,
    new_streak: int,
    settings: dict,
) -> int:
    """Final stored ``points`` for one answer.

    A wrong/unanswered submission always scores 0 — double-points and streak
    bonuses only ever multiply/add to an already-correct answer (PRD §4:
    "答錯／未答 0").
    """
    if not is_correct:
        return 0

    points = base_points
    if settings.get("double_points_last") and is_last_round:
        points *= 2
    if settings.get("streak_bonus"):
        points += streak_bonus(new_streak)
    return points
