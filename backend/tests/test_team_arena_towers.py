"""TDD for team_arena.towers v2 — PRD §0 v2 改版 L,
docs/prd/2026-10-18-team-arena-prd.md."""
from __future__ import annotations

from app.services.team_arena import towers as svc


class TestComputeDamage:
    def test_instant_correct_answer_deals_max_damage(self):
        assert svc.compute_damage(elapsed_ms=0, limit_ms=30_000, weapon_used=False) == (
            svc.BASE_DAMAGE + svc.MAX_SPEED_BONUS
        )

    def test_last_instant_correct_answer_deals_base_damage_only(self):
        assert svc.compute_damage(elapsed_ms=30_000, limit_ms=30_000, weapon_used=False) == svc.BASE_DAMAGE

    def test_overtime_elapsed_clamped_to_base_damage(self):
        assert svc.compute_damage(elapsed_ms=99_999, limit_ms=30_000, weapon_used=False) == svc.BASE_DAMAGE

    def test_weapon_used_halves_final_damage(self):
        full = svc.compute_damage(elapsed_ms=0, limit_ms=30_000, weapon_used=False)
        halved = svc.compute_damage(elapsed_ms=0, limit_ms=30_000, weapon_used=True)
        assert halved == full // 2

    def test_weapon_used_never_drops_below_half_base_damage(self):
        # Slowest possible answer + weapon used: must still be BASE_DAMAGE // 2,
        # never 0 or negative.
        damage = svc.compute_damage(elapsed_ms=30_000, limit_ms=30_000, weapon_used=True)
        assert damage == svc.BASE_DAMAGE // svc.WEAPON_DAMAGE_DIVISOR

    def test_midpoint_elapsed_deals_midpoint_bonus(self):
        damage = svc.compute_damage(elapsed_ms=15_000, limit_ms=30_000, weapon_used=False)
        assert damage == svc.BASE_DAMAGE + round(svc.MAX_SPEED_BONUS * 0.5)


class TestApplyDamageTowerProgression:
    def test_partial_damage_does_not_fell_the_tower(self):
        state = svc.new_path_state()
        new_state, event = svc.apply_damage(state, 10)
        assert event == "damage"
        assert new_state.towers_destroyed == 0
        assert new_state.current_hp == svc.STRUCTURE_HP - 10

    def test_exact_lethal_damage_fells_first_tower(self):
        state = svc.new_path_state()
        new_state, event = svc.apply_damage(state, svc.STRUCTURE_HP)
        assert event == "tower_fallen"
        assert new_state.towers_destroyed == 1
        assert new_state.current_hp == svc.STRUCTURE_HP  # fresh tower
        assert not new_state.base_destroyed

    def test_overkill_damage_still_only_fells_one_tower(self):
        state = svc.new_path_state()
        new_state, event = svc.apply_damage(state, svc.STRUCTURE_HP + 999)
        assert event == "tower_fallen"
        assert new_state.towers_destroyed == 1
        assert new_state.current_hp == svc.STRUCTURE_HP  # overflow does not carry

    def test_felling_the_last_tower_starts_attacking_the_base(self):
        state = svc.PathState(towers_destroyed=svc.TOWER_COUNT - 1, current_hp=svc.STRUCTURE_HP)
        new_state, event = svc.apply_damage(state, svc.STRUCTURE_HP)
        assert event == "tower_fallen_to_base"
        assert new_state.towers_destroyed == svc.TOWER_COUNT
        assert new_state.current_hp == svc.STRUCTURE_HP
        assert not new_state.base_destroyed
        assert new_state.is_attacking_base()

    def test_destroying_the_base_ends_it_during_showdown(self):
        """PRD v2 rule P: the base can only truly fall during 決戰時刻 (or
        see TestShowdownBaseFloor below for the pre-showdown floor)."""
        state = svc.PathState(towers_destroyed=svc.TOWER_COUNT, current_hp=svc.STRUCTURE_HP)
        new_state, event = svc.apply_damage(state, svc.STRUCTURE_HP, showdown=True)
        assert event == "base_destroyed"
        assert new_state.base_destroyed is True

    def test_damage_after_base_destroyed_is_a_defensive_noop(self):
        state = svc.PathState(towers_destroyed=svc.TOWER_COUNT, current_hp=0, base_destroyed=True)
        new_state, event = svc.apply_damage(state, 50)
        assert event == "already_won"
        assert new_state == state

    def test_full_sweep_from_fresh_to_base_destroyed_during_showdown(self):
        state = svc.new_path_state()
        events = []
        for _ in range(svc.TOWER_COUNT + 1):
            state, event = svc.apply_damage(state, svc.STRUCTURE_HP, showdown=True)
            events.append(event)
        assert events == ["tower_fallen", "tower_fallen", "tower_fallen_to_base", "base_destroyed"]
        assert state.base_destroyed is True


class TestShowdownBaseFloor:
    """PRD v2 rule P: 主堡血量在決戰時刻之前不會真的降到 0 以下（最低停在
    BASE_HP_FLOOR_BEFORE_SHOWDOWN）；towers are NEVER floored, only the
    base."""

    def test_lethal_hit_on_base_before_showdown_is_floored_not_destroyed(self):
        state = svc.PathState(towers_destroyed=svc.TOWER_COUNT, current_hp=svc.STRUCTURE_HP)
        new_state, event = svc.apply_damage(state, svc.STRUCTURE_HP, showdown=False)
        assert event == "base_floor_held"
        assert new_state.base_destroyed is False
        assert new_state.current_hp == svc.BASE_HP_FLOOR_BEFORE_SHOWDOWN

    def test_already_at_floor_stays_at_floor_pre_showdown(self):
        state = svc.PathState(
            towers_destroyed=svc.TOWER_COUNT, current_hp=svc.BASE_HP_FLOOR_BEFORE_SHOWDOWN
        )
        new_state, event = svc.apply_damage(state, 999, showdown=False)
        assert event == "base_floor_held"
        assert new_state.current_hp == svc.BASE_HP_FLOOR_BEFORE_SHOWDOWN
        assert new_state.base_destroyed is False

    def test_non_lethal_hit_on_base_before_showdown_still_lands_normally(self):
        state = svc.PathState(towers_destroyed=svc.TOWER_COUNT, current_hp=svc.STRUCTURE_HP)
        new_state, event = svc.apply_damage(state, 10, showdown=False)
        assert event == "damage"
        assert new_state.current_hp == svc.STRUCTURE_HP - 10

    def test_floor_never_applies_to_a_tower_pre_showdown(self):
        """Only the BASE is floored — a tower can fall at any point in the
        match, showdown or not."""
        state = svc.new_path_state()
        new_state, event = svc.apply_damage(state, svc.STRUCTURE_HP, showdown=False)
        assert event == "tower_fallen"
        assert new_state.towers_destroyed == 1

    def test_showdown_true_lets_the_base_actually_fall(self):
        state = svc.PathState(towers_destroyed=svc.TOWER_COUNT, current_hp=svc.STRUCTURE_HP)
        new_state, event = svc.apply_damage(state, svc.STRUCTURE_HP, showdown=True)
        assert event == "base_destroyed"
        assert new_state.base_destroyed is True


class TestIsShowdownTurn:
    def test_before_final_lap_is_not_showdown(self):
        # turns_per_player=3, team_size=2 -> total_turns=6, final lap = turns 4,5
        assert svc.is_showdown_turn(0, total_turns=6, team_size=2) is False
        assert svc.is_showdown_turn(3, total_turns=6, team_size=2) is False

    def test_final_lap_is_showdown(self):
        assert svc.is_showdown_turn(4, total_turns=6, team_size=2) is True
        assert svc.is_showdown_turn(5, total_turns=6, team_size=2) is True

    def test_single_lap_game_is_showdown_from_turn_zero(self):
        # turns_per_player=1 -> the only lap IS the final lap.
        assert svc.is_showdown_turn(0, total_turns=3, team_size=3) is True


class TestComputeDamageSpeedCapAndShowdown:
    def test_speed_bonus_is_exactly_25_percent_of_base_not_an_independent_pool(self):
        """PRD v2 rule O: locks the RATIO itself — a future refactor that
        decouples MAX_SPEED_BONUS back into an arbitrary flat constant
        (v1-of-this-module's own original design) would fail this."""
        assert svc.MAX_SPEED_BONUS == round(svc.BASE_DAMAGE * 0.25)

    def test_instant_answer_caps_at_125_percent_of_base(self):
        damage = svc.compute_damage(elapsed_ms=0, limit_ms=30_000, weapon_used=False)
        assert damage == svc.BASE_DAMAGE + svc.MAX_SPEED_BONUS
        assert damage <= round(svc.BASE_DAMAGE * 1.25)

    def test_showdown_doubles_the_already_weapon_halved_total(self):
        """elapsed_ms=1500 (not 0) deliberately makes the pre-weapon total
        ODD (80 + round(20*0.95) = 99) — critic review: at elapsed_ms=0 the
        pre-weapon total is 100, and `(100 // 2) * 2` happens to equal
        `(100 * 2) // 2`, so that value could not tell a correct
        "halve-then-double" implementation apart from a buggy
        "double-then-halve" one. 99 can: halve-then-double gives
        `(99 // 2) * 2 = 98`; double-then-halve gives `(99 * 2) // 2 = 99`.
        """
        normal = svc.compute_damage(elapsed_ms=1500, limit_ms=30_000, weapon_used=True, showdown=False)
        showdown = svc.compute_damage(elapsed_ms=1500, limit_ms=30_000, weapon_used=True, showdown=True)
        assert normal == 49  # (80 + 19) // 2 -- ground truth, not just a relative comparison
        assert showdown == 98  # 49 * 2, NOT (80+19)*2//2 == 99 (the buggy order)

    def test_showdown_without_weapon_doubles_full_damage(self):
        normal = svc.compute_damage(elapsed_ms=0, limit_ms=30_000, weapon_used=False, showdown=False)
        showdown = svc.compute_damage(elapsed_ms=0, limit_ms=30_000, weapon_used=False, showdown=True)
        assert showdown == normal * 2


class TestDecideWinner:
    def test_opponent_base_destroyed_wins_for_me(self):
        me = svc.new_path_state()
        opponent = svc.PathState(towers_destroyed=svc.TOWER_COUNT, current_hp=0, base_destroyed=True)
        assert svc.decide_winner(me, opponent) == "a"
        assert svc.decide_winner(opponent, me) == "b"

    def test_fewer_own_towers_destroyed_wins_on_turns_exhausted(self):
        """Both arguments are DEFENSIVE states (how much damage THIS side
        has itself taken) — taking FEWER hits means this side is further
        ahead (PRD "比誰推得比較前面" read from the opponent's own damage)."""
        less_damaged = svc.PathState(towers_destroyed=1, current_hp=10)
        more_damaged = svc.PathState(towers_destroyed=2, current_hp=80)
        assert svc.decide_winner(less_damaged, more_damaged) == "a"
        assert svc.decide_winner(more_damaged, less_damaged) == "b"

    def test_same_towers_destroyed_higher_remaining_hp_wins(self):
        less_damaged = svc.PathState(towers_destroyed=1, current_hp=90)
        more_damaged = svc.PathState(towers_destroyed=1, current_hp=20)
        assert svc.decide_winner(less_damaged, more_damaged) == "a"
        assert svc.decide_winner(more_damaged, less_damaged) == "b"

    def test_exact_tie_is_a_draw(self):
        state = svc.PathState(towers_destroyed=1, current_hp=50)
        assert svc.decide_winner(state, state) == "draw"

    def test_draw_never_depends_on_a_time_argument(self):
        # Documents the PRD's own wording: "不用秒數硬分勝負" — this
        # function signature has no elapsed/time parameter at all.
        import inspect

        sig = inspect.signature(svc.decide_winner)
        assert "elapsed" not in sig.parameters
        assert "time" not in sig.parameters
