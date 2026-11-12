"""TDD for app.services.pk.rating_service — PRD §7.3 Elo update + floor 800."""
from __future__ import annotations

import pytest

from app.services.pk import rating_service as svc


class TestExpectedScore:
    def test_equal_ratings_gives_half(self):
        assert svc.expected_score(1000, 1000) == pytest.approx(0.5)

    def test_higher_self_rating_gives_above_half(self):
        e = svc.expected_score(1200, 1000)
        assert e > 0.5

    def test_lower_self_rating_gives_below_half(self):
        e = svc.expected_score(800, 1000)
        assert e < 0.5

    def test_symmetric_around_half(self):
        e_up = svc.expected_score(1200, 1000)
        e_down = svc.expected_score(1000, 1200)
        assert e_up + e_down == pytest.approx(1.0)


class TestUpdateRating:
    def test_win_against_equal_increases_rating(self):
        new = svc.update_rating(1000, 1000, score=1.0, k=24)
        # K*(1 - 0.5) = 12
        assert new == 1012

    def test_loss_against_equal_decreases_rating(self):
        new = svc.update_rating(1000, 1000, score=0.0, k=24)
        assert new == 988

    def test_draw_against_equal_is_unchanged(self):
        new = svc.update_rating(1000, 1000, score=0.5, k=24)
        assert new == 1000

    def test_win_against_much_weaker_gives_small_gain(self):
        # Expected to win almost always -> tiny reward for actually winning.
        new = svc.update_rating(1400, 800, score=1.0, k=24)
        assert 1400 < new < 1405

    def test_loss_against_much_weaker_gives_big_penalty(self):
        new = svc.update_rating(1400, 800, score=0.0, k=24)
        assert new < 1400 - 20

    def test_floor_clamps_at_800(self):
        # Near-floor self rating losing to an EQUALLY rated opponent (E=0.5,
        # so the penalty is a real -12, not negligible) must never dip under 800.
        new = svc.update_rating(805, 805, score=0.0, k=24)
        assert new >= svc.RATING_FLOOR
        assert new == svc.RATING_FLOOR  # 805 - 12 = 793 unclamped; floor catches it

    def test_floor_does_not_affect_scores_already_above_it(self):
        new = svc.update_rating(1000, 1000, score=1.0, k=24)
        assert new > svc.RATING_FLOOR

    def test_rounds_to_nearest_int(self):
        new = svc.update_rating(1000, 1070, score=1.0, k=24)
        assert isinstance(new, int)


class TestMirroredUpdate:
    """PRD §16.3: "雙方 pk_ratings 的更新量互為鏡像（一方 +N、另一方 -N，±1 容許誤差)"."""

    def test_winner_and_loser_deltas_are_mirrored_within_one_point(self):
        r_a, r_b = 1000, 1000
        a_after = svc.update_rating(r_a, r_b, score=1.0, k=24)
        b_after = svc.update_rating(r_b, r_a, score=0.0, k=24)
        delta_a = a_after - r_a
        delta_b = b_after - r_b
        assert abs(delta_a + delta_b) <= 1

    def test_draw_is_mirrored_as_zero_both_sides(self):
        r_a, r_b = 1100, 1000
        a_after = svc.update_rating(r_a, r_b, score=0.5, k=24)
        b_after = svc.update_rating(r_b, r_a, score=0.5, k=24)
        # The higher-rated side loses a bit on a draw, the lower gains a bit.
        assert a_after < r_a
        assert b_after > r_b
        assert abs((a_after - r_a) + (b_after - r_b)) <= 1
