"""PK scoring and tie-break — PRD §4.

PRD §6.1: PK does NOT call `round_types.choice.score_submission` (that
function implements `live_quiz`'s 500-1000 speed-scaled points, built for a
different teaching goal). PK's own rule is flat: correct -> 1000, else 0
(no `elapsed_ms` parameter at all — see
TestScorePkAnswer.test_speed_never_affects_points for why that is the
regression lock, not just a comment).

Decisive factor is score; speed is ONLY the tie-break (PRD §4 "決勝：總分高
者勝;同分時比總作答時間").
"""
from __future__ import annotations

POINTS_CORRECT = 1000
POINTS_WRONG = 0


def score_pk_answer(payload: dict, choice_key: str | None) -> tuple[bool, int]:
    correct_key = payload.get("correct_key")
    is_correct = bool(choice_key) and choice_key == correct_key
    return (True, POINTS_CORRECT) if is_correct else (False, POINTS_WRONG)


def total_time_ms(answers: list[dict], *, rounds_total: int, limit_ms: int) -> int:
    """Sum of elapsed_ms across every round. A round with no answer entry
    (timed out, never submitted) counts as the full window — PRD §16.3's
    tie-break test assumes a complete, comparable "how long did this side
    take" number regardless of whether every round was actually answered.
    """
    answered_by_round = {a["round_index"]: a for a in answers}
    total = 0
    for i in range(rounds_total):
        a = answered_by_round.get(i)
        total += int(a["elapsed_ms"]) if a is not None else limit_ms
    return total


def decide_winner(
    *, side_a_score: int, side_b_score: int, side_a_total_time_ms: int, side_b_total_time_ms: int
) -> str:
    """Returns "a" | "b" | "draw". PRD §4: higher score wins outright;
    equal score -> faster total time wins; both equal -> draw."""
    if side_a_score != side_b_score:
        return "a" if side_a_score > side_b_score else "b"
    if side_a_total_time_ms != side_b_total_time_ms:
        return "a" if side_a_total_time_ms < side_b_total_time_ms else "b"
    return "draw"
