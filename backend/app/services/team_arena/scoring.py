"""五人對抗賽：計分與勝負判定 — PRD §3.2/§3.4.

Pure functions only — mirrors the `live_quiz`/`pk` pattern of a
scoring.py with no DB and no knowledge of a "game"/"match" object, just
numbers in, numbers out, so it is trivially recomputable from stored data
alone (same recomputability goal `round_types/choice.py::score_submission`
documents for live_quiz).
"""
from __future__ import annotations

# PRD §3.2: "上場者答對...隊伍 +100".
TOWER_POINTS = 100
# PRD §3.2 literal wording: "速度加分 0–20...最多是一座塔的五分之一".
MAX_SPEED_BONUS = TOWER_POINTS // 5
# PRD §3.2: "隊友私下答對（助攻）：隊伍 +10、個人助攻 +1".
ASSIST_BONUS_PER_CORRECT = 10
# PRD §3.2: "每回合助攻加分上限 +30".
ASSIST_ROUND_CAP = 30


def score_active_answer(*, is_correct: bool, elapsed_ms: int, limit_ms: int) -> int:
    """Team point delta for the player who was actually on stage this
    round. PRD §3.2: 答錯／逾時一律 0（不扣分、不倒退 — towers.py already
    has no "wrong answer" transition, so 0 points here is the only state
    change that can happen for a wrong answer).

    Speed bonus is linear in how much of the answer window was unused,
    clamped to [0, MAX_SPEED_BONUS] — same clamp-then-scale shape
    `round_types/choice.py::score_submission` uses for live_quiz's speed
    bonus, scaled to this mode's much smaller ceiling.
    """
    if not is_correct:
        return 0
    limit_ms = max(1, int(limit_ms))
    elapsed_clamped = max(0, min(int(elapsed_ms), limit_ms))
    speed_bonus = round(MAX_SPEED_BONUS * (1 - elapsed_clamped / limit_ms))
    return TOWER_POINTS + speed_bonus


def score_assist_answer(
    *, is_correct: bool, round_assist_team_points_so_far: int
) -> tuple[int, int]:
    """Returns (team_delta, individual_delta) for ONE assist submission.

    `round_assist_team_points_so_far` is the team's assist bonus ALREADY
    banked this round (across every teammate's assist answers, not just
    this one player) — the caller (engine, slice 2) is responsible for
    accumulating and persisting this per round; this function only ever
    computes the next increment, it never reads or writes state.
    """
    if not is_correct:
        return 0, 0
    individual_delta = 1
    remaining_room = max(0, ASSIST_ROUND_CAP - round_assist_team_points_so_far)
    team_delta = min(ASSIST_BONUS_PER_CORRECT, remaining_room)
    return team_delta, individual_delta


def decide_match_winner(
    *,
    side_a_score: int,
    side_b_score: int,
    side_a_base_conquered: bool,
    side_b_base_conquered: bool,
) -> str:
    """Returns "a" | "b" | "draw". PRD §3.2: 先攻下對方主堡者勝（提前結束）；
    回合用完時比總分；總分相同算平手 — deliberately NO time/elapsed
    parameter (see test_draw_never_depends_on_a_time_argument): the PRD's
    own words are "不用秒數硬分勝負，總分已含速度加分", i.e. the tie-break
    PK/live_quiz use (fastest wins) is explicitly rejected for this mode.
    """
    if side_a_base_conquered and not side_b_base_conquered:
        return "a"
    if side_b_base_conquered and not side_a_base_conquered:
        return "b"
    # Both conquered (should never happen — the engine must stop a match
    # the instant either base falls) or neither did: fall back to score.
    if side_a_score != side_b_score:
        return "a" if side_a_score > side_b_score else "b"
    if side_a_base_conquered and side_b_base_conquered:
        # Tied score AND both somehow conquered — no time tie-break is
        # available (PRD forbids it), so pick deterministically rather
        # than raise. This branch is defensive only (see docstring).
        return "a"
    return "draw"
