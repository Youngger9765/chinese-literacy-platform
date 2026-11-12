"""TDD for app.services.pk.scoring — PRD §4 計分與決勝.

PRD §4: "答對固定 1000 分;答錯或未答 0 分" (NOT live_quiz's 500-1000 speed
scale — §6.1 explicitly says PK does not call `round_types.choice.
score_submission`). Tie-break is total elapsed time, lower wins.
"""
from __future__ import annotations

import pytest

from app.services.pk import scoring as svc

_PAYLOAD = {"correct_key": "B", "seconds": 20}


class TestScorePkAnswer:
    def test_correct_choice_scores_1000(self):
        is_correct, points = svc.score_pk_answer(_PAYLOAD, "B")
        assert is_correct is True
        assert points == 1000

    def test_wrong_choice_scores_0(self):
        is_correct, points = svc.score_pk_answer(_PAYLOAD, "A")
        assert is_correct is False
        assert points == 0

    def test_no_answer_scores_0(self):
        is_correct, points = svc.score_pk_answer(_PAYLOAD, None)
        assert is_correct is False
        assert points == 0

    def test_empty_string_choice_scores_0(self):
        is_correct, points = svc.score_pk_answer(_PAYLOAD, "")
        assert is_correct is False
        assert points == 0

    def test_speed_never_affects_points(self):
        """PRD §4: fast-but-guessed must never outscore slow-but-correct —
        this scoring function doesn't even take elapsed_ms as an argument,
        which is itself the regression lock: speed literally cannot reach
        the points calculation."""
        import inspect

        sig = inspect.signature(svc.score_pk_answer)
        assert "elapsed_ms" not in sig.parameters


class TestTotalTimeMs:
    def test_sums_elapsed_across_answered_rounds(self):
        answers = [
            {"round_index": 0, "elapsed_ms": 3000},
            {"round_index": 1, "elapsed_ms": 5000},
        ]
        total = svc.total_time_ms(answers, rounds_total=2, limit_ms=20000)
        assert total == 8000

    def test_missing_rounds_count_as_the_full_limit(self):
        # Only answered round 0; round 1 was never submitted (timed out).
        answers = [{"round_index": 0, "elapsed_ms": 3000}]
        total = svc.total_time_ms(answers, rounds_total=2, limit_ms=20000)
        assert total == 3000 + 20000

    def test_no_answers_at_all_is_the_full_budget(self):
        total = svc.total_time_ms([], rounds_total=5, limit_ms=20000)
        assert total == 5 * 20000


class TestDecideWinner:
    def test_higher_score_wins_outright(self):
        # PRD §16.1 QA case: A all-correct-slow (5000) beats B
        # mostly-wrong-fast (3000) regardless of speed.
        winner = svc.decide_winner(
            side_a_score=5000, side_b_score=3000, side_a_total_time_ms=90000, side_b_total_time_ms=20000
        )
        assert winner == "a"

    def test_lower_score_never_wins_on_speed_alone(self):
        winner = svc.decide_winner(
            side_a_score=3000, side_b_score=5000, side_a_total_time_ms=10000, side_b_total_time_ms=90000
        )
        assert winner == "b"

    def test_tied_score_breaks_on_faster_total_time(self):
        winner = svc.decide_winner(
            side_a_score=4000, side_b_score=4000, side_a_total_time_ms=50000, side_b_total_time_ms=60000
        )
        assert winner == "a"

    def test_tied_score_and_tied_time_is_a_draw(self):
        winner = svc.decide_winner(
            side_a_score=4000, side_b_score=4000, side_a_total_time_ms=50000, side_b_total_time_ms=50000
        )
        assert winner == "draw"

    def test_both_zero_is_a_draw_not_a_crash(self):
        winner = svc.decide_winner(
            side_a_score=0, side_b_score=0, side_a_total_time_ms=0, side_b_total_time_ms=0
        )
        assert winner == "draw"
