"""Unit tests for the cross-cutting score modifiers (double_points_last,
streak_bonus) — these apply regardless of round type, so they are tested
independently of the ``choice`` round type's own formula.
"""
from app.services.live_quiz import scoring


class TestStreakBonus:
    def test_first_correct_in_streak_has_no_bonus(self):
        assert scoring.streak_bonus(1) == 0

    def test_second_correct_gives_100(self):
        assert scoring.streak_bonus(2) == 100

    def test_third_correct_gives_200(self):
        assert scoring.streak_bonus(3) == 200

    def test_caps_at_300(self):
        assert scoring.streak_bonus(4) == 300
        assert scoring.streak_bonus(10) == 300

    def test_zero_or_negative_is_zero(self):
        assert scoring.streak_bonus(0) == 0


class TestApplyModifiers:
    def test_wrong_answer_always_zero_regardless_of_settings(self):
        points = scoring.apply_modifiers(
            base_points=900, is_correct=False, is_last_round=True, new_streak=5,
            settings={"double_points_last": True, "streak_bonus": True},
        )
        assert points == 0

    def test_no_modifiers_returns_base_points(self):
        points = scoring.apply_modifiers(
            base_points=700, is_correct=True, is_last_round=False, new_streak=1,
            settings={},
        )
        assert points == 700

    def test_double_points_last_doubles_only_on_last_round(self):
        settings = {"double_points_last": True}
        not_last = scoring.apply_modifiers(
            base_points=600, is_correct=True, is_last_round=False, new_streak=1, settings=settings,
        )
        last = scoring.apply_modifiers(
            base_points=600, is_correct=True, is_last_round=True, new_streak=1, settings=settings,
        )
        assert not_last == 600
        assert last == 1200

    def test_streak_bonus_added_when_enabled(self):
        points = scoring.apply_modifiers(
            base_points=500, is_correct=True, is_last_round=False, new_streak=3,
            settings={"streak_bonus": True},
        )
        assert points == 500 + 200

    def test_streak_bonus_not_added_when_disabled(self):
        points = scoring.apply_modifiers(
            base_points=500, is_correct=True, is_last_round=False, new_streak=3,
            settings={"streak_bonus": False},
        )
        assert points == 500

    def test_double_points_and_streak_bonus_compose(self):
        # double applies to base, THEN streak bonus is added on top — not
        # doubled itself (a flat "+100 per streak step" regardless of the
        # round's point value keeps the bonus legible to players).
        points = scoring.apply_modifiers(
            base_points=1000, is_correct=True, is_last_round=True, new_streak=3,
            settings={"double_points_last": True, "streak_bonus": True},
        )
        assert points == 1000 * 2 + 200
