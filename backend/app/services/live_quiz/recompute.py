"""The single scoring path — called by engine.submit_answer (write) and by
test_live_quiz_recompute.py (an independent audit replay). External review
#2: "scoring must be recomputable from stored data alone (add a test that
recomputes and matches)".

There being exactly one function that turns (round, submission, elapsed_ms,
streak-so-far) into (is_correct, points) is what makes that test meaningful:
it is not just re-running the same call twice, it is the only place either
the write path or an audit tool is allowed to compute a score, so they
cannot drift apart from each other.
"""
from __future__ import annotations

from .round_types import ROUND_TYPES
from . import scoring


def compute_round_result(
    *,
    round_def: dict,
    settings: dict,
    submission: dict,
    elapsed_ms: int,
    new_streak: int,
    is_last_round: bool,
) -> tuple[bool, int]:
    """Pure function: everything it needs is an argument, nothing is read
    from the DB or from `datetime.now()`. Replayable forever from a frozen
    `rounds_snapshot` entry + a stored `live_quiz_answers` row + the game's
    (also frozen) `settings`.
    """
    round_type = ROUND_TYPES[round_def["round_type"]]
    is_correct, base_points = round_type.score_submission(
        round_def["payload"], submission, elapsed_ms
    )
    points = scoring.apply_modifiers(
        base_points=base_points,
        is_correct=is_correct,
        is_last_round=is_last_round,
        new_streak=new_streak,
        settings=settings,
    )
    return is_correct, points


def replay_player_streak(answers_in_round_order: list[dict]) -> list[int]:
    """Given one player's stored answers ORDERED BY round_index, return the
    new_streak value that would have applied to each in turn — reconstructed
    purely from each row's own `is_correct`, with no dependency on
    `LiveQuizPlayer.current_streak` (which only ever holds the CURRENT value,
    not history).

    ``answers_in_round_order``: list of {"is_correct": bool} in round order.
    """
    streak = 0
    out = []
    for a in answers_in_round_order:
        streak = (streak + 1) if a["is_correct"] else 0
        out.append(streak)
    return out
