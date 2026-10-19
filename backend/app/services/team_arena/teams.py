"""五人對抗賽：分隊、配對、路線分配與輪替表 — PRD §3.1/§3.3/§4.

Pure functions only (no DB, no FastAPI) — this module is the thing
`backend/tests/test_team_arena_teams.py` exercises directly, and the thing
`services/team_arena/engine.py` (slice 2, not built yet) will call when a
teacher clicks "自動分隊".
"""
from __future__ import annotations

import random

# PRD §3.1 table order — this IS the rotation's canonical order (§3.3:
# "隊員依『路線順序』排成輪替表：注音 → 詞義 → 應用 → 閱讀 → 支援").
PRIMARY_LANES: tuple[str, ...] = (
    "zhuyin",
    "vocab_definitions",
    "vocab_application",
    "comprehension",
)
SUPPORT_LANE = "support"
LANES: tuple[str, ...] = PRIMARY_LANES + (SUPPORT_LANE,)

MIN_TEAM_SIZE = 3
MAX_TEAM_SIZE = 7
# The size the teacher-facing "一鍵分隊" algorithm is biased toward — PRD
# title: 《五人對抗賽》, §4: "選讓平均人數最接近 5 的那個".
TARGET_TEAM_SIZE = 5
# PRD §4: "少於 4 人到場：不開場，提示老師改用課堂搶答".
MIN_PLAYERS_TO_START = 4
# PRD §4: "4–7 人到場：只開一場 2 對 2 到 3 對 4".
SMALL_ROSTER_MAX = 7


class TooFewPlayersError(ValueError):
    """Raised when fewer than MIN_PLAYERS_TO_START joined — PRD §4 says the
    caller should fall back to 課堂搶答, not try to force a match."""


def _split_sizes(total: int, team_count: int) -> list[int]:
    """Split `total` into `team_count` parts, each either floor or ceil of
    total/team_count, the `remainder` largest parts first — so pairing
    first-half-vs-second-half (see `build_matches`) always pairs a ceil
    team against a floor team instead of stacking all the big ones
    together."""
    base, remainder = divmod(total, team_count)
    return [base + 1] * remainder + [base] * (team_count - remainder)


def _valid_team_count(total: int, team_count: int) -> bool:
    if team_count <= 0 or team_count > total:
        return False
    sizes = _split_sizes(total, team_count)
    return min(sizes) >= MIN_TEAM_SIZE and max(sizes) <= MAX_TEAM_SIZE


def _choose_team_count(total: int) -> int:
    """PRD §4: pick the EVEN team count whose average size is closest to 5,
    subject to every team landing in [3,7]. Ties prefer fewer (bigger)
    teams — not specified by the PRD's worked examples (none of them tie),
    but documented here as the implementation's own tie-break so a future
    case that does tie is deterministic, not accidental."""
    candidates = [t for t in range(2, total + 1, 2) if _valid_team_count(total, t)]
    if not candidates:
        # total < 8 never reaches here (see form_teams' branch), but stay
        # defensive: fall back to 2 teams rather than raising from a
        # "private" helper.
        return 2
    return min(candidates, key=lambda t: (abs(total / t - TARGET_TEAM_SIZE), t))


def form_teams(student_ids: list[int], rng: random.Random) -> list[list[int]]:
    """PRD §4 一鍵分隊. Returns a list of teams (each a list of student
    ids); consecutive pairs are NOT implied to be a match — call
    `build_matches` for that.

    Raises `TooFewPlayersError` for < 4 students (PRD: 改用課堂搶答).
    """
    total = len(student_ids)
    if total < MIN_PLAYERS_TO_START:
        raise TooFewPlayersError(
            f"Only {total} students present; team_arena needs at least "
            f"{MIN_PLAYERS_TO_START} (PRD §4: fall back to 課堂搶答)"
        )

    roster = list(student_ids)
    rng.shuffle(roster)

    if total <= SMALL_ROSTER_MAX:
        team_count = 2
    else:
        team_count = _choose_team_count(total)

    sizes = _split_sizes(total, team_count)

    teams: list[list[int]] = []
    cursor = 0
    for size in sizes:
        teams.append(roster[cursor : cursor + size])
        cursor += size
    return teams


def build_matches(teams: list[list[int]]) -> list[tuple[int, int]]:
    """Pair team INDICES into matches. PRD §4: "同一場的兩隊人數相同或差1"
    — pairing the first half against the second half (rather than adjacent
    teams) spreads any ceil/floor size difference evenly across matches
    instead of concentrating it into one lopsided match.

    `teams` must have an even length (guaranteed by `form_teams`).
    """
    if len(teams) % 2 != 0:
        raise ValueError(f"build_matches needs an even team count, got {len(teams)}")
    half = len(teams) // 2
    return [(i, i + half) for i in range(half)]


def assign_lanes(members: list[int], rng: random.Random) -> dict[int, dict]:
    """PRD §3.1/§3.3/§4 "系統補位": assign each member a lane and lock a
    rotation_order. 3-4 person teams get a subset of the 4 primary lanes
    (no support — PRD §4: "沒有支援位"); 5-person teams get exactly one
    support; 6-7 person teams get the remaining 2-3 as support.

    Returns {member_id: {"lane": str, "rotation_order": int}}.

    Design choice (not specified by the PRD, documented here rather than
    silently assumed): for a 3-member team, the omitted lane is always the
    LAST one in canonical order (`comprehension`) — reading comprehension
    needs the most context, so it is the lane most defensible to leave
    unmanned when a team is short a player; PRD §4 already establishes that
    an unmanned lane just never advances ("沒人站的路線不推進"), it isn't a
    bug to have one.
    """
    shuffled = list(members)
    rng.shuffle(shuffled)
    size = len(shuffled)

    primary_slots = min(size, len(PRIMARY_LANES))
    lane_sequence = list(PRIMARY_LANES[:primary_slots])
    lane_sequence += [SUPPORT_LANE] * (size - primary_slots)

    assignment: dict[int, dict] = {}
    for order, (member_id, lane) in enumerate(zip(shuffled, lane_sequence)):
        assignment[member_id] = {"lane": lane, "rotation_order": order}
    return assignment
