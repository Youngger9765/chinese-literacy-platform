"""TDD for app.services.pk.ai_tiers — PRD §5.1/§5.2 seven AI opponent tiers."""
from __future__ import annotations

import random

import pytest

from app.services.pk import ai_tiers as svc

EXPECTED_NAMES = ["駱賓王", "孟浩然", "白居易", "李清照", "杜甫", "蘇軾", "李白"]
EXPECTED_ACCURACY = [0.50, 0.60, 0.70, 0.78, 0.85, 0.90, 0.95]
# PRD §5.2 table — ±1 tolerance for rounding.
EXPECTED_VIRTUAL_RATING = [1000, 1070, 1147, 1220, 1301, 1382, 1511]

_FAKE_PAYLOAD = {
    "options": [
        {"key": "A", "text": "甲"},
        {"key": "B", "text": "乙"},
        {"key": "C", "text": "丙"},
        {"key": "D", "text": "丁"},
    ],
    "correct_key": "B",
    "seconds": 20,
}


class TestTierTable:
    def test_exactly_seven_tiers(self):
        assert len(svc.TIERS) == 7

    def test_tier_numbers_are_1_to_7_in_order(self):
        assert [t.tier for t in svc.TIERS] == [1, 2, 3, 4, 5, 6, 7]

    def test_names_match_prd(self):
        assert [t.name for t in svc.TIERS] == EXPECTED_NAMES

    def test_accuracy_matches_prd(self):
        for t, expected in zip(svc.TIERS, EXPECTED_ACCURACY):
            assert t.accuracy == pytest.approx(expected)

    def test_virtual_rating_matches_prd_exactly(self):
        assert [t.virtual_rating for t in svc.TIERS] == EXPECTED_VIRTUAL_RATING

    def test_virtual_rating_formula_reproduces_the_table_within_rounding(self):
        """The hardcoded table is PRD §5.2 verbatim; this proves it isn't a
        hand-typed number that silently drifted from the formula it claims
        to implement."""
        for t in svc.TIERS:
            assert abs(svc.virtual_rating_formula(t.accuracy) - t.virtual_rating) <= 1

    def test_virtual_rating_is_monotonically_increasing(self):
        ratings = [t.virtual_rating for t in svc.TIERS]
        assert ratings == sorted(ratings)

    def test_get_tier_by_number(self):
        t = svc.get_tier(7)
        assert t.name == "李白"

    def test_get_tier_rejects_out_of_range(self):
        with pytest.raises(ValueError):
            svc.get_tier(8)
        with pytest.raises(ValueError):
            svc.get_tier(0)

    def test_recommend_tier_picks_closest_virtual_rating(self):
        # Student rating 1000 -> tier 1 (virtual rating exactly 1000).
        assert svc.recommend_tier(1000).tier == 1
        # Student rating way above the table -> tier 7 (closest, not an error).
        assert svc.recommend_tier(5000).tier == 7
        # Student rating below the table -> tier 1.
        assert svc.recommend_tier(100).tier == 1


class TestSampleAiAnswer:
    def test_elapsed_ms_always_within_bounds(self):
        rng = random.Random(42)
        for tier in svc.TIERS:
            for _ in range(200):
                ans = svc.sample_ai_answer(tier.tier, _FAKE_PAYLOAD, rng)
                assert 500 <= ans["elapsed_ms"] <= 20000

    def test_correct_answer_uses_the_actual_correct_key(self):
        rng = random.Random(1)
        # Tier 7 (95% accuracy) over many trials will produce plenty of
        # correct answers to inspect.
        correct_seen = False
        for _ in range(200):
            ans = svc.sample_ai_answer(7, _FAKE_PAYLOAD, rng)
            if ans["is_correct"]:
                correct_seen = True
                assert ans["choice_key"] == "B"
        assert correct_seen, "tier 7 should answer correctly most of the time"

    def test_incorrect_answer_never_uses_the_correct_key(self):
        rng = random.Random(2)
        # Tier 1 (50% accuracy) over many trials will produce plenty of
        # incorrect answers to inspect.
        incorrect_seen = False
        for _ in range(200):
            ans = svc.sample_ai_answer(1, _FAKE_PAYLOAD, rng)
            if not ans["is_correct"]:
                incorrect_seen = True
                assert ans["choice_key"] != "B"
                assert ans["choice_key"] in {"A", "C", "D"}
        assert incorrect_seen, "tier 1 should answer incorrectly a meaningful fraction of the time"

    def test_accuracy_roughly_matches_tier_over_large_sample(self):
        rng = random.Random(7)
        n = 2000
        tier = svc.get_tier(3)  # 白居易, 70%
        correct = sum(
            1 for _ in range(n) if svc.sample_ai_answer(3, _FAKE_PAYLOAD, rng)["is_correct"]
        )
        rate = correct / n
        # Loose statistical bound — not a precision test, just "not obviously wrong".
        assert abs(rate - tier.accuracy) < 0.06

    def test_deterministic_given_same_rng_seed(self):
        rng1 = random.Random(99)
        rng2 = random.Random(99)
        seq1 = [svc.sample_ai_answer(5, _FAKE_PAYLOAD, rng1) for _ in range(10)]
        seq2 = [svc.sample_ai_answer(5, _FAKE_PAYLOAD, rng2) for _ in range(10)]
        assert seq1 == seq2

    def test_speed_tier_ordering_on_average(self):
        # Tier 7 (李白, "非常快") should average a shorter elapsed_ms than
        # tier 1 (駱賓王, "慢") over a large sample.
        rng = random.Random(123)
        n = 500
        avg_fast = sum(svc.sample_ai_answer(7, _FAKE_PAYLOAD, rng)["elapsed_ms"] for _ in range(n)) / n
        avg_slow = sum(svc.sample_ai_answer(1, _FAKE_PAYLOAD, rng)["elapsed_ms"] for _ in range(n)) / n
        assert avg_fast < avg_slow

    def test_two_option_question_never_crashes(self):
        payload = {
            "options": [{"key": "A", "text": "甲"}, {"key": "B", "text": "乙"}],
            "correct_key": "A",
            "seconds": 20,
        }
        rng = random.Random(1)
        for _ in range(50):
            ans = svc.sample_ai_answer(1, payload, rng)
            assert ans["choice_key"] in {"A", "B"}
