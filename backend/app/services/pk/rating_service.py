"""PK Elo rating — PRD §7.3.

Pure functions only (no DB) so they're independently testable and
recomputable: given the two ratings and an outcome, the result is
deterministic. The DB-touching "apply this to a PkRating row" caller lives
in engine.py, which calls these and then clamps/persists.
"""
from __future__ import annotations

RATING_FLOOR = 800
# PRD §7.3: "K = 24（比標準西洋棋常見的 32 低一點...給穩定的進步感而不是雲霄
# 飛車）".
DEFAULT_K = 24


def expected_score(r_self: int, r_opp: int) -> float:
    """Standard Elo expected score: E = 1 / (1 + 10^((R_opp - R_self) / 400))."""
    return 1.0 / (1.0 + 10 ** ((r_opp - r_self) / 400.0))


def update_rating(r_self: int, r_opp: int, *, score: float, k: int = DEFAULT_K) -> int:
    """R' = R + K * (S - E), clamped to the floor (PRD §7.3).

    ``score``: 1.0 win / 0.5 draw / 0.0 loss (PRD §4: "平手對積分的影響：不
    調整積分" is enforced by the CALLER never invoking this for a draw, not
    by this function — this function still supports score=0.5 for callers
    that want the textbook Elo draw behaviour, e.g. a future mode).
    """
    e = expected_score(r_self, r_opp)
    raw = r_self + k * (score - e)
    return max(RATING_FLOOR, round(raw))
