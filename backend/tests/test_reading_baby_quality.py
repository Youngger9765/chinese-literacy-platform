"""TDD：閱讀寶貝 quality_passed 判定（#3780 第一階段）。

對應 docs/design/reading-babies/ability-indicators.md §3 的門檻表，以及
2026-10-31 工頭補充：first_try_accuracy 改用學習扶助科技化評量通過標準
分三段（四年級以下 80%／五六年級 72%／七年級以上 60%），不是單一 60%。
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import reading_baby_quality as quality


class TestFirstTryAccuracyThresholdBands:
    def test_grade_4_or_below_uses_80_percent(self):
        pct, label = quality.first_try_accuracy_threshold_pct(4)
        assert pct == 80
        assert label == "四年級以下"

    def test_grade_1_also_uses_80_percent(self):
        pct, _ = quality.first_try_accuracy_threshold_pct(1)
        assert pct == 80

    def test_grade_5_uses_72_percent(self):
        pct, label = quality.first_try_accuracy_threshold_pct(5)
        assert pct == 72
        assert label == "五、六年級"

    def test_grade_6_uses_72_percent(self):
        pct, _ = quality.first_try_accuracy_threshold_pct(6)
        assert pct == 72

    def test_grade_7_uses_60_percent(self):
        pct, label = quality.first_try_accuracy_threshold_pct(7)
        assert pct == 60
        assert label == "七年級以上"

    def test_grade_9_also_uses_60_percent(self):
        pct, _ = quality.first_try_accuracy_threshold_pct(9)
        assert pct == 60


class TestDetermineQualityCompletion:
    def test_completion_signal_is_never_passed(self):
        result = quality.determine_quality(
            signal_type="completion", effective_grade=5, step_payload={"anything": True}
        )
        assert result.quality_passed is False
        assert result.signal_type == "completion"


class TestDetermineQualityReadingFluency:
    def test_passes_when_cpm_and_accuracy_both_meet_default_threshold(self):
        result = quality.determine_quality(
            signal_type="reading_fluency",
            effective_grade=4,
            step_payload={"result": {"cpm": 125, "accuracy": 92}},
        )
        assert result.quality_passed is True
        assert result.cpm == 125
        assert result.accuracy == 92

    def test_fails_when_cpm_below_threshold(self):
        result = quality.determine_quality(
            signal_type="reading_fluency",
            effective_grade=4,
            step_payload={"result": {"cpm": 100, "accuracy": 95}},
        )
        assert result.quality_passed is False

    def test_fails_when_accuracy_below_threshold(self):
        result = quality.determine_quality(
            signal_type="reading_fluency",
            effective_grade=4,
            step_payload={"cpm": 130, "accuracy": 80},
        )
        assert result.quality_passed is False

    def test_teacher_target_cpm_overrides_default(self):
        # 老師設定目標速度較低時，用老師的值，不用預設 120
        result = quality.determine_quality(
            signal_type="reading_fluency",
            effective_grade=4,
            step_payload={"cpm": 100, "accuracy": 95},
            teacher_target_cpm=90,
        )
        assert result.quality_passed is True

    def test_missing_data_does_not_pass_and_does_not_raise(self):
        result = quality.determine_quality(
            signal_type="reading_fluency", effective_grade=4, step_payload={}
        )
        assert result.quality_passed is False


class TestDetermineQualityFirstTryAccuracy:
    def test_passes_with_first_try_results_shape_above_threshold(self):
        # grade 4 → 80% threshold; 4/5 = 80% exactly meets it
        result = quality.determine_quality(
            signal_type="first_try_accuracy",
            effective_grade=4,
            step_payload={"firstTryResults": {"score": 4, "total": 5}},
        )
        assert result.quality_passed is True
        assert result.items_total == 5
        assert result.items_first_try_correct == 4

    def test_fails_below_grade_band_threshold(self):
        # grade 4 needs 80%; 3/5 = 60% fails
        result = quality.determine_quality(
            signal_type="first_try_accuracy",
            effective_grade=4,
            step_payload={"firstTryResults": {"score": 3, "total": 5}},
        )
        assert result.quality_passed is False

    def test_same_ratio_passes_at_grade_7_threshold(self):
        # grade 7 only needs 60%; 3/5 = 60% passes
        result = quality.determine_quality(
            signal_type="first_try_accuracy",
            effective_grade=7,
            step_payload={"firstTryResults": {"score": 3, "total": 5}},
        )
        assert result.quality_passed is True

    def test_mc_answers_shape_with_first_try_correct_flags(self):
        result = quality.determine_quality(
            signal_type="first_try_accuracy",
            effective_grade=7,
            step_payload={
                "mcAnswers": [
                    {"firstTryCorrect": True},
                    {"firstTryCorrect": True},
                    {"firstTryCorrect": False},
                ]
            },
        )
        assert result.items_total == 3
        assert result.items_first_try_correct == 2

    def test_drag_drop_answers_shape(self):
        result = quality.determine_quality(
            signal_type="first_try_accuracy",
            effective_grade=7,
            step_payload={
                "dragDropAnswers": [
                    {"firstTryCorrect": True},
                    {"firstTryCorrect": True},
                ]
            },
        )
        assert result.items_total == 2
        assert result.items_first_try_correct == 2
        assert result.quality_passed is True

    def test_fewer_than_three_items_requires_all_correct(self):
        # 2 題，1 題對 = 50%，但題數 <3 要求全對 → 不過
        result = quality.determine_quality(
            signal_type="first_try_accuracy",
            effective_grade=7,
            step_payload={"firstTryResults": {"score": 1, "total": 2}},
        )
        assert result.quality_passed is False

    def test_fewer_than_three_items_all_correct_passes(self):
        result = quality.determine_quality(
            signal_type="first_try_accuracy",
            effective_grade=7,
            step_payload={"firstTryResults": {"score": 2, "total": 2}},
        )
        assert result.quality_passed is True

    def test_generic_items_total_fallback_shape(self):
        result = quality.determine_quality(
            signal_type="first_try_accuracy",
            effective_grade=7,
            step_payload={"items_total": 10, "items_first_try_correct": 7},
        )
        assert result.quality_passed is True  # 70% >= 60%
        assert result.items_total == 10

    def test_missing_data_does_not_pass_and_does_not_raise(self):
        result = quality.determine_quality(
            signal_type="first_try_accuracy", effective_grade=5, step_payload=None
        )
        assert result.quality_passed is False
        assert result.items_total is None


class TestDetermineQualityUnknownSignalFailsClosed:
    def test_unknown_signal_type_never_raises_and_never_passes(self):
        result = quality.determine_quality(
            signal_type="mystery", effective_grade=5, step_payload={"score": 100, "total": 100}
        )
        assert result.quality_passed is False
