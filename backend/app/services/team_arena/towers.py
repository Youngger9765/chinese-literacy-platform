"""多人對抗賽 v2：單隊的推塔狀態機與傷害公式 — PRD §0 v2 改版 L/N,
docs/prd/2026-10-18-team-arena-prd.md.

v2 replaces v1's four-lane "注音路/詞義路/應用路/閱讀路" map (v1
`towers.py`, never shipped past staging) with ONE shared track per team:
3 towers then 1 base. There is no lane concept left here at all — every
correct answer (regardless of which question TYPE it was) damages
whichever structure is currently "up" for the opponent team.

One `PathState` tracks ONE team's progress. The engine (slice 2) owns
comparing the two sides of a match; this module only owns "what happens
to THIS team's structure when the OPPONENT scores a hit on it."

Wrong/timeout answers never call into this module at all — PRD §3.2
(unchanged by v2): 答錯／逾時不推進、不扣分、不倒退, i.e. a no-op, which is
exactly what NOT calling `apply_damage` already is.
"""
from __future__ import annotations

from dataclasses import dataclass

# PRD v2 rule L: "每隊 3 座塔＋1 座主堡".
TOWER_COUNT = 3
# Design choice (Claude 判斷, not specified by the PRD): each structure
# (tower or base) has 100 HP. Combined with BASE_DAMAGE/MAX_SPEED_BONUS
# below, the fastest possible correct answer (100 dmg) can one-shot a
# single structure, while the slowest still deals more than half
# (BASE_DAMAGE alone) — so a single team is never stuck grinding forever,
# but speed still visibly matters (PRD L: "答得快扣比較多").
STRUCTURE_HP = 100
# PRD v2 rule L: "答對扣『對方當前那座』的血（答得快扣比較多...）".
BASE_DAMAGE = 50
MAX_SPEED_BONUS = 50
# PRD v2 rule G: "用了武器的那題答對得分減半（避免每題都開）" — applied as
# integer floor division on the final damage number, not on the two
# components separately (a slow + weapon-used answer must still deal at
# least BASE_DAMAGE // 2, never zero).
WEAPON_DAMAGE_DIVISOR = 2


@dataclass(frozen=True)
class PathState:
    """Immutable — `apply_damage` returns a NEW state, it never mutates
    `self`. `towers_destroyed` is 0..TOWER_COUNT; once it reaches
    TOWER_COUNT, `current_hp` tracks the BASE's remaining health instead of
    a tower's."""

    towers_destroyed: int = 0
    current_hp: int = STRUCTURE_HP
    base_destroyed: bool = False

    def is_attacking_base(self) -> bool:
        return self.towers_destroyed >= TOWER_COUNT


def new_path_state() -> PathState:
    return PathState(towers_destroyed=0, current_hp=STRUCTURE_HP, base_destroyed=False)


def compute_damage(*, elapsed_ms: int, limit_ms: int, weapon_used: bool) -> int:
    """Pure function of (elapsed_ms, limit_ms, weapon_used) — same
    recomputability goal every other scoring helper in this codebase
    documents (round_types/choice.py::score_submission). Only ever called
    for a CORRECT active answer — wrong/timeout answers never reach here
    (see module docstring).

    PRD v2 rule L: faster answers deal more damage, linearly interpolated
    between BASE_DAMAGE (answered right at the time limit) and
    BASE_DAMAGE + MAX_SPEED_BONUS (answered instantly). Rule G: a weapon
    used this turn halves the FINAL number (floor division), never the
    speed component alone — so damage is always >= BASE_DAMAGE //
    WEAPON_DAMAGE_DIVISOR regardless of how slow the answer was.
    """
    limit_ms = max(1, int(limit_ms))
    elapsed_clamped = max(0, min(int(elapsed_ms), limit_ms))
    speed_bonus = round(MAX_SPEED_BONUS * (1 - elapsed_clamped / limit_ms))
    damage = BASE_DAMAGE + speed_bonus
    if weapon_used:
        damage //= WEAPON_DAMAGE_DIVISOR
    return damage


def apply_damage(state: PathState, damage: int) -> tuple[PathState, str]:
    """Returns (new_state, event) where event is one of:
      "damage"              — hit landed, current structure still standing
      "tower_fallen"        — a tower (not the last) was knocked down
      "tower_fallen_to_base" — the LAST tower fell; now attacking the base
      "base_destroyed"      — the base itself was knocked down, match over
      "already_won"         — defensive no-op; base was already destroyed

    Overflow damage (a hit bigger than the remaining HP) does not carry
    into the next structure — MVP simplification (documented, not a bug):
    the next structure in line always starts at a fresh STRUCTURE_HP/
    BASE's full health regardless of how much the finishing blow
    overshot by. PRD §15-style risk note: a future "overflow carries over"
    rule would need its own explicit design sign-off, not an accidental
    side effect of this function's arithmetic.
    """
    if state.base_destroyed:
        return state, "already_won"

    new_hp = state.current_hp - max(0, int(damage))
    if new_hp > 0:
        return PathState(
            towers_destroyed=state.towers_destroyed,
            current_hp=new_hp,
            base_destroyed=False,
        ), "damage"

    # Current structure falls.
    if state.towers_destroyed < TOWER_COUNT:
        towers_destroyed = state.towers_destroyed + 1
        if towers_destroyed >= TOWER_COUNT:
            return PathState(
                towers_destroyed=towers_destroyed,
                current_hp=STRUCTURE_HP,
                base_destroyed=False,
            ), "tower_fallen_to_base"
        return PathState(
            towers_destroyed=towers_destroyed,
            current_hp=STRUCTURE_HP,
            base_destroyed=False,
        ), "tower_fallen"

    # Was already attacking the base -> this hit destroys it.
    return PathState(
        towers_destroyed=TOWER_COUNT,
        current_hp=0,
        base_destroyed=True,
    ), "base_destroyed"


def decide_winner(state_a: PathState, state_b: PathState) -> str:
    """Returns "a" | "b" | "draw". PRD v2 rule L: 先打倒對方主堡的隊伍獲勝
    （提前結束）；所有人輪完設定的上場次數還沒分出勝負，比誰推得比較前面
    （倒塔數→剩餘血量）.

    Both arguments use the SAME "defensive" convention `apply_damage`
    already produces and the engine already stores: `state_a` is how much
    damage SIDE A ITSELF has taken (its own towers/base being knocked
    down by side B's correct answers), never how much side A has dealt.
    "比誰推得比較前面" (whoever has pushed further into the opponent) is
    therefore read off the OTHER side's defensive state — the side that
    has suffered LESS damage is the one that is further ahead.

    `base_destroyed` should normally only ever be true for the LOSING
    side's own state (your base fell -> the OTHER side won) — the engine
    is expected to end the match the instant either base falls, so both
    being true simultaneously is defensive-only (should never happen in
    practice, same posture as v1 scoring.py::decide_match_winner).
    """
    if state_a.base_destroyed and not state_b.base_destroyed:
        return "b"
    if state_b.base_destroyed and not state_a.base_destroyed:
        return "a"

    if state_a.towers_destroyed != state_b.towers_destroyed:
        # FEWER of my own towers destroyed = I have taken less damage = I
        # am further ahead.
        return "a" if state_a.towers_destroyed < state_b.towers_destroyed else "b"

    # Same towers_destroyed count: whoever has taken LESS damage to their
    # current structure (i.e. MORE remaining HP) is further ahead. An
    # exact tie here (including the defensive both-bases-destroyed case
    # above) is a genuine draw — PRD rejects a time-based tie-break here
    # just as explicitly as v1's scoring.py did.
    if state_a.current_hp != state_b.current_hp:
        return "a" if state_a.current_hp > state_b.current_hp else "b"
    return "draw"
