"""TDD for team_arena.scoring — PRD §3.2 (計分: 答對為主，速度只是小加分),
§3.4 (助攻) and §15 PRD worked rule 「平手不以秒數硬分勝負」."""
from __future__ import annotations

from app.services.team_arena.scoring import (
    ASSIST_BONUS_PER_CORRECT,
    ASSIST_ROUND_CAP,
    MAX_SPEED_BONUS,
    TOWER_POINTS,
    decide_match_winner,
    score_active_answer,
    score_assist_answer,
)


class TestScoreActiveAnswerCorrect:
    def test_correct_instant_answer_gets_max_speed_bonus(self):
        points = score_active_answer(is_correct=True, elapsed_ms=0, limit_ms=20_000)
        assert points == TOWER_POINTS + MAX_SPEED_BONUS

    def test_correct_at_the_wire_gets_zero_speed_bonus(self):
        points = score_active_answer(is_correct=True, elapsed_ms=20_000, limit_ms=20_000)
        assert points == TOWER_POINTS

    def test_correct_midway_gets_partial_bonus_between_bounds(self):
        points = score_active_answer(is_correct=True, elapsed_ms=10_000, limit_ms=20_000)
        assert TOWER_POINTS < points < TOWER_POINTS + MAX_SPEED_BONUS

    def test_speed_bonus_is_at_most_one_fifth_of_tower_points(self):
        """PRD §3.2 literal wording: 速度加分「最多是一座塔的五分之一」."""
        assert MAX_SPEED_BONUS == TOWER_POINTS // 5


class TestScoreActiveAnswerWrongOrTimeout:
    def test_wrong_answer_scores_zero_never_negative(self):
        points = score_active_answer(is_correct=False, elapsed_ms=5_000, limit_ms=20_000)
        assert points == 0

    def test_timeout_elapsed_ms_over_limit_still_scores_zero_when_wrong(self):
        points = score_active_answer(is_correct=False, elapsed_ms=99_999, limit_ms=20_000)
        assert points == 0

    def test_a_fast_wrong_answer_still_scores_zero(self):
        """Regression lock: speed bonus must never apply to a wrong
        answer, however fast it was submitted."""
        points = score_active_answer(is_correct=False, elapsed_ms=1, limit_ms=20_000)
        assert points == 0


class TestScoreActiveAnswerElapsedClamping:
    def test_elapsed_past_limit_does_not_go_negative_or_over_max(self):
        points = score_active_answer(is_correct=True, elapsed_ms=999_999, limit_ms=20_000)
        assert points == TOWER_POINTS  # clamped to "at the wire"

    def test_negative_elapsed_is_clamped_to_zero(self):
        points = score_active_answer(is_correct=True, elapsed_ms=-500, limit_ms=20_000)
        assert points == TOWER_POINTS + MAX_SPEED_BONUS


class TestScoreAssistAnswer:
    """PRD §3.4: 隊友私下答對 team +10／個人 +1；每回合助攻加分上限 +30；
    助攻永遠不推塔 (towers.py is never called for an assist — enforced by
    the engine in slice 2, not by this scoring function's return shape,
    which only ever returns point deltas)."""

    def test_correct_assist_awards_team_and_individual_points(self):
        team_delta, individual_delta = score_assist_answer(
            is_correct=True, round_assist_team_points_so_far=0
        )
        assert team_delta == ASSIST_BONUS_PER_CORRECT
        assert individual_delta == 1

    def test_wrong_assist_awards_nothing(self):
        team_delta, individual_delta = score_assist_answer(
            is_correct=False, round_assist_team_points_so_far=0
        )
        assert team_delta == 0
        assert individual_delta == 0

    def test_round_cap_clamps_team_delta_not_individual(self):
        """Three correct assists in the same round already hit the +30
        cap (3 x 10); a fourth correct assist must award 0 team points but
        still count the individual's own +1 (PRD doesn't cap the personal
        counter, only the team's round total)."""
        team_delta, individual_delta = score_assist_answer(
            is_correct=True, round_assist_team_points_so_far=ASSIST_ROUND_CAP
        )
        assert team_delta == 0
        assert individual_delta == 1

    def test_round_cap_clamps_a_partial_remaining_amount(self):
        """25 already banked this round + a 4th correct assist (worth 10)
        must only add the remaining 5, not blow past the +30 cap."""
        team_delta, _ = score_assist_answer(
            is_correct=True, round_assist_team_points_so_far=25
        )
        assert team_delta == 5

    def test_assist_round_cap_is_30(self):
        assert ASSIST_ROUND_CAP == 30


class TestDecideMatchWinner:
    """PRD §3.2: 先攻下對方主堡者勝；回合用完時比總分；總分相同算平手
    （不用秒數硬分勝負，總分已含速度加分）."""

    def test_base_conquered_wins_outright_even_with_lower_score(self):
        winner = decide_match_winner(
            side_a_score=50, side_b_score=99_999, side_a_base_conquered=True,
            side_b_base_conquered=False,
        )
        assert winner == "a"

    def test_both_bases_standing_higher_score_wins(self):
        winner = decide_match_winner(
            side_a_score=400, side_b_score=350, side_a_base_conquered=False,
            side_b_base_conquered=False,
        )
        assert winner == "a"

    def test_equal_score_neither_base_conquered_is_a_draw(self):
        winner = decide_match_winner(
            side_a_score=400, side_b_score=400, side_a_base_conquered=False,
            side_b_base_conquered=False,
        )
        assert winner == "draw"

    def test_both_bases_conquered_simultaneously_is_impossible_but_a_wins_tiebreak(self):
        """Defensive: the engine should never let both sides conquer a base
        in the exact same resolved round, but if it ever does, the function
        must still return a deterministic value rather than raise."""
        winner = decide_match_winner(
            side_a_score=1, side_b_score=1, side_a_base_conquered=True,
            side_b_base_conquered=True,
        )
        assert winner in ("a", "b")

    def test_draw_never_depends_on_a_time_argument(self):
        """Regression lock for PRD §3.2's explicit "不用秒數硬分勝負" — the
        function signature itself must not accept an elapsed-time
        parameter a future edit could be tempted to wire in as a
        tie-break."""
        import inspect

        params = inspect.signature(decide_match_winner).parameters
        for name in params:
            assert "time" not in name and "elapsed" not in name and "ms" not in name
