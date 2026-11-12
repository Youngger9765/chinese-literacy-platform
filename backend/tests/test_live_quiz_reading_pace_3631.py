"""issue #3631 P0 #1: "選項出現時間依題目長度" — reading_seconds is computed
per-question from its own stem length and a teacher-picked pace preset
(慢/標準/快), instead of one fixed value for every round in a game.

This file tests the pure function in isolation. `test_live_quiz_round_choice.py`
covers how `generate_rounds` wires it into a round's frozen payload (including
the explicit-override escape hatch PK's `reading_seconds=0` needs).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.services.live_quiz import reading_pace
from app.services.live_quiz.sources import SOURCE_ADAPTERS
from app.services.lesson_uid_loader import available_uids, load_lesson


class TestComputeReadingSeconds:
    def test_very_short_stem_gets_the_minimum(self):
        assert reading_pace.compute_reading_seconds("誰？", "standard") == reading_pace.MIN_READING_SECONDS

    def test_longer_stem_gets_more_time_than_a_shorter_one(self):
        short = reading_pace.compute_reading_seconds("這是誰？", "standard")
        long_ = reading_pace.compute_reading_seconds("這是一句長很多的題目敘述，字數明顯比前面那句多很多。", "standard")
        assert long_ > short

    @pytest.mark.parametrize(
        "stem",
        [
            "這是一句中等長度、用來比較三種速度的題目敘述文字。",
            "短題",
        ],
    )
    def test_pace_presets_are_ordered_slow_to_fast(self, stem):
        slow = reading_pace.compute_reading_seconds(stem, "slow")
        standard = reading_pace.compute_reading_seconds(stem, "standard")
        fast = reading_pace.compute_reading_seconds(stem, "fast")
        assert slow >= standard >= fast

    def test_result_never_exceeds_the_max_even_for_a_very_long_stem(self):
        very_long = "字" * 500
        for pace in reading_pace.VALID_PACES:
            assert reading_pace.compute_reading_seconds(very_long, pace) <= reading_pace.MAX_READING_SECONDS

    def test_result_never_goes_below_the_min_even_for_an_empty_stem(self):
        for pace in reading_pace.VALID_PACES:
            assert reading_pace.compute_reading_seconds("", pace) >= reading_pace.MIN_READING_SECONDS

    def test_unknown_pace_falls_back_to_standard_without_crashing(self):
        stem = "這是一句題目敘述文字。"
        assert reading_pace.compute_reading_seconds(stem, "unknown-pace") == reading_pace.compute_reading_seconds(
            stem, reading_pace.DEFAULT_PACE
        )

    def test_same_stem_and_pace_always_returns_the_same_value(self):
        """Pure function — a frozen rounds_snapshot payload must stay
        deterministic and replayable, same as every other live-quiz
        computation (external review #2's recomputability requirement)."""
        stem = "這是一句用來驗證決定性的題目敘述文字。"
        values = {reading_pace.compute_reading_seconds(stem, "standard") for _ in range(5)}
        assert len(values) == 1


class TestClassLevelSweepAcrossRealLessons:
    """Canon TDD class-level sweep: every question in every lesson's pool,
    across all four source modules and all three paces, must stay within
    [MIN_READING_SECONDS, MAX_READING_SECONDS]. A positive control
    (checked > 0) guards against this silently checking nothing — see
    rules/overclaim-bias.md "否定斷言必配正向對照"."""

    def test_every_real_question_in_every_lesson_stays_within_bounds(self):
        import random

        uids = available_uids()
        assert len(uids) > 100, "sanity: lesson corpus should be ~179 lessons, something is wrong with the fixture"
        checked = 0
        for uid in uids:
            lesson = load_lesson(uid)
            if lesson is None:
                continue
            for module, adapter in SOURCE_ADAPTERS.items():
                rng = random.Random(0)
                try:
                    items = adapter(uid, lesson, rng)
                except Exception:  # noqa: BLE001 — a malformed row is this module's problem, not ours
                    continue
                for item in items:
                    for pace in reading_pace.VALID_PACES:
                        seconds = reading_pace.compute_reading_seconds(item.stem, pace)
                        assert reading_pace.MIN_READING_SECONDS <= seconds <= reading_pace.MAX_READING_SECONDS, (
                            f"{module}:{uid} stem={item.stem!r} pace={pace} -> {seconds}s out of bounds"
                        )
                        checked += 1
        # Positive control: this sweep must actually have checked a
        # meaningful number of real questions, not silently iterated zero.
        assert checked > 1000, f"only checked {checked} items — the sweep itself is probably broken"
