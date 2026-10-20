"""多人對抗賽 v2：單隊的推塔狀態機與傷害公式 — PRD §0 v2 改版 L/O/P,
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
# (tower or base) has 100 HP.
STRUCTURE_HP = 100
# PRD v2 rule O: "答對一律先給固定基礎傷害，答得快最多再加 +25%" — a FIXED
# floor dealt on every correct answer, plus a SPEED BONUS capped as a
# FRACTION of that floor (not an independent flat pool the way an earlier
# draft of this module briefly had it — see git history if curious; a
# flat 1:1 bonus pool reads as "faster = proportionally more", exactly
# what rule O explicitly rules out).
BASE_DAMAGE = 80
MAX_SPEED_BONUS_RATIO = 0.25
MAX_SPEED_BONUS = round(BASE_DAMAGE * MAX_SPEED_BONUS_RATIO)
# PRD v2 rule G: "用了武器的那題答對得分減半（避免每題都開）" — applied as
# integer floor division on the TOTAL (base + speed bonus), never on the
# two components separately (a slow + weapon-used answer must still deal
# at least BASE_DAMAGE // 2, never zero). PRD rule O reaffirms this is a
# discount on the FINAL total, not on the base alone.
WEAPON_DAMAGE_DIVISOR = 2
# PRD v2 rule P: "決戰時刻...雙方傷害 ×2" — applied as the LAST multiplier,
# on top of whatever weapon halving already did.
SHOWDOWN_DAMAGE_MULTIPLIER = 2
# PRD v2 rule P: "決戰時刻開始之前，主堡血量不會真的降到 0 以下（最低停在
# 1 血）" — the base (never a tower) cannot drop below this floor outside
# of 決戰時刻.
BASE_HP_FLOOR_BEFORE_SHOWDOWN = 1


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


def compute_damage(*, elapsed_ms: int, limit_ms: int, weapon_used: bool, showdown: bool = False) -> int:
    """Pure function of (elapsed_ms, limit_ms, weapon_used, showdown) —
    same recomputability goal every other scoring helper in this codebase
    documents (round_types/choice.py::score_submission). Only ever called
    for a CORRECT active answer — wrong/timeout answers never reach here
    (see module docstring).

    Order of operations (PRD v2 rule O's own wording: 武器減半是對「加完速
    度分之後的總傷害」打折, and rule P layers 決戰時刻 ×2 on top of that):
      1. BASE_DAMAGE, always dealt.
      2. + a speed bonus linearly interpolated between 0 (answered right
         at the time limit) and MAX_SPEED_BONUS = BASE_DAMAGE *
         MAX_SPEED_BONUS_RATIO (answered instantly) — PRD rule O: capped
         at +25%, never "faster = proportionally more".
      3. // WEAPON_DAMAGE_DIVISOR if a weapon was used this turn (floor
         division on the TOTAL from step 2, not on BASE_DAMAGE alone).
      4. * SHOWDOWN_DAMAGE_MULTIPLIER if this turn is 決戰時刻 (applied
         AFTER the weapon halving, per rule O's explicit "總傷害" wording
         — a weapon-used showdown hit is (base+bonus)//2*2, not full).
    """
    limit_ms = max(1, int(limit_ms))
    elapsed_clamped = max(0, min(int(elapsed_ms), limit_ms))
    speed_bonus = round(MAX_SPEED_BONUS * (1 - elapsed_clamped / limit_ms))
    damage = BASE_DAMAGE + speed_bonus
    if weapon_used:
        damage //= WEAPON_DAMAGE_DIVISOR
    if showdown:
        damage *= SHOWDOWN_DAMAGE_MULTIPLIER
    return damage


def is_showdown_turn(turn_no: int, total_turns: int, team_size: int) -> bool:
    """PRD v2 rule P: "決戰時刻" is every player's FINAL turn — the last
    `team_size` turns out of `total_turns` (both sides share one global
    turn clock, so this is a single shared window, not computed
    per-side). `total_turns` is always `turns_per_player * team_size`
    (engine._start) so this window is always exactly one full lap wide.
    """
    if team_size <= 0 or total_turns <= 0:
        return False
    return turn_no >= total_turns - team_size


def apply_damage(state: PathState, damage: int, *, showdown: bool = False) -> tuple[PathState, str]:
    """Returns (new_state, event) where event is one of:
      "damage"              — hit landed, current structure still standing
      "base_floor_held"     — PRD rule P: this hit WOULD have destroyed
                               the base before 決戰時刻, but the base is
                               floored at BASE_HP_FLOOR_BEFORE_SHOWDOWN
                               instead — still standing, "one more hit"
                               away, but not actually fallen yet.
      "tower_fallen"        — a tower (not the last) was knocked down
      "tower_fallen_to_base" — the LAST tower fell; now attacking the base
      "base_destroyed"      — the base itself was knocked down, match over
      "already_won"         — defensive no-op; base was already destroyed

    PRD v2 rule P: the floor ONLY protects the BASE (`state.
    is_attacking_base()`), never a tower — towers can fall at any point in
    the match, showdown or not. `showdown=False` is the default because
    every OTHER caller of this function (towers.py's own test suite, any
    future non-turn-based use) should not need to think about the
    showdown window unless it actually applies; the engine is the only
    caller that computes and passes a real value.

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

    damage = max(0, int(damage))

    if state.is_attacking_base() and not showdown:
        floored_hp = max(BASE_HP_FLOOR_BEFORE_SHOWDOWN, state.current_hp - damage)
        would_have_fallen = state.current_hp - damage <= 0
        return PathState(
            towers_destroyed=state.towers_destroyed,
            current_hp=floored_hp,
            base_destroyed=False,
        ), ("base_floor_held" if would_have_fallen else "damage")

    new_hp = state.current_hp - damage
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
