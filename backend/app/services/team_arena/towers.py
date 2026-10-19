"""五人對抗賽：單一隊伍的塔與主堡狀態機 — PRD §3.1.

One `PathState` tracks ONE team's progress. A match has two (side 0 / side
1); the engine (slice 2) owns comparing them, this module only owns "what
happens to THIS team's map when its own lane answers correctly."

Wrong/timeout answers never call into this module at all — PRD §3.2: "答
錯／逾時：不推進、不扣分、不倒退", i.e. a no-op, which is exactly what NOT
calling `apply_correct_answer` already is. There is deliberately no
`apply_wrong_answer` function to avoid inventing a state transition the PRD
doesn't want.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .teams import PRIMARY_LANES

# PRD §3.1: "每條路 2 座塔（外塔→內塔）".
TOWERS_PER_LANE = 2
# PRD §3.1: "主堡 2 次命中即「攻下主堡」，比賽提前結束".
BASE_HITS_TO_WIN = 2


@dataclass(frozen=True)
class PathState:
    """Immutable — `apply_correct_answer` returns a NEW state, it never
    mutates `self`. `towers_down[lane]` is 0, 1 (outer down) or
    `TOWERS_PER_LANE` (lane cleared, further correct answers on it hit the
    base instead)."""

    towers_down: dict = field(default_factory=dict)
    base_hits: int = 0

    def is_base_conquered(self) -> bool:
        return self.base_hits >= BASE_HITS_TO_WIN


def new_path_state() -> PathState:
    return PathState(towers_down={lane: 0 for lane in PRIMARY_LANES}, base_hits=0)


def apply_correct_answer(state: PathState, lane: str) -> tuple[PathState, str]:
    """`lane` must already be resolved to one of PRIMARY_LANES — a
    'support' player's actual lane for THIS round is chosen by the engine
    (PRD §3.1: "系統替他挑本隊推進最少的那條路出題") before this is called.

    Returns (new_state, event) where event is one of:
      "tower_down"     — outer tower on `lane` knocked down
      "lane_cleared"   — inner tower on `lane` knocked down, lane now clear
      "base_hit"       — `lane` was already clear, this hit the main base
      "base_conquered" — that base_hit was the Nth and the match is over

    Defensive cap: calling this again after `is_base_conquered()` is already
    True still returns "base_conquered" without incrementing past
    BASE_HITS_TO_WIN — the engine is expected to stop advancing a finished
    match, but a stray extra call (e.g. a race between two polling requests)
    must not corrupt the stored score.
    """
    if lane not in PRIMARY_LANES:
        raise ValueError(
            f"apply_correct_answer needs a resolved primary lane, got {lane!r} "
            f"(one of {PRIMARY_LANES})"
        )

    # Defensive no-op past the win threshold, checked BEFORE looking at
    # `lane` at all (critic review, slice 1): the caller is expected to
    # stop advancing a finished match, but a stray extra call — e.g. a
    # double-submit race during the reveal window — must be a true no-op
    # regardless of WHICH lane it names, not just a repeat on the lane that
    # scored the winning hit. A call naming a different, still-uncleared
    # lane must not silently advance that lane's own tower count.
    if state.is_base_conquered():
        return state, "base_conquered"

    towers_down = dict(state.towers_down)
    current = towers_down[lane]

    if current < TOWERS_PER_LANE:
        towers_down[lane] = current + 1
        event = "lane_cleared" if towers_down[lane] == TOWERS_PER_LANE else "tower_down"
        return PathState(towers_down=towers_down, base_hits=state.base_hits), event

    # Lane already cleared -> this correct answer hits the main base.
    new_base_hits = state.base_hits + 1
    event = "base_conquered" if new_base_hits >= BASE_HITS_TO_WIN else "base_hit"
    return PathState(towers_down=towers_down, base_hits=new_base_hits), event
