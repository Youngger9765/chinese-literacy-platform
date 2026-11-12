"""Tests for the ``choice`` round type: round generation, scoring formula,
the answer-safe player view, and the per-game display-position shuffle
(external review #1a — the stored ``correct_key`` must not just mirror the
source material's own answer letter)."""
import random

from app.services.live_quiz import reading_pace
from app.services.live_quiz.round_types import choice


def _lessons_fixture(explanation=None):
    question = {"index": 1, "stem": "第一題？", "answer": "A",
                "options": {"A": "甲", "B": "乙", "C": "丙", "D": "丁"}}
    if explanation is not None:
        question["explanation"] = explanation
    lesson = {
        "title": "測試課文",
        "version_id": "v3",
        "comprehension": {"questions": [question]},
    }
    return [{"lesson_uid": "L0001", "lesson": lesson}]


def _long_stem_lessons_fixture():
    """A second, much longer stem than ``_lessons_fixture`` — used to prove
    reading_seconds is now computed PER ITEM from its own length, not one
    fixed value for the whole game (issue #3631 P0 #1)."""
    lesson = {
        "title": "測試課文",
        "version_id": "v3",
        "comprehension": {"questions": [
            {"index": 1, "stem": "短", "answer": "A", "options": {"A": "甲", "B": "乙"}},
            {"index": 2,
             "stem": "這是一句明顯長很多的題目敘述文字，用來確認比較長的題目會拿到比較長的讀題時間。",
             "answer": "A", "options": {"A": "甲", "B": "乙"}},
        ]},
    }
    return [{"lesson_uid": "L0001", "lesson": lesson}]


class TestGenerateRounds:
    def test_builds_one_round_per_item(self):
        settings = {"source_modules": ["comprehension"], "seconds": 30, "question_count_mode": "all"}
        rounds, _fallback = choice.generate_rounds(_lessons_fixture(), settings, random.Random(1))
        assert len(rounds) == 1
        r = rounds[0]
        assert r["round_type"] == "choice"
        assert r["round_index"] == 0
        assert r["payload"]["seconds"] == 30
        assert r["payload"]["lesson_uid"] == "L0001"
        assert "item_id" in r["payload"]
        assert r["payload"]["scoring_version"] == choice.SCORING_RULE_VERSION

    def test_question_count_mode_caps_pool(self):
        lesson = {
            "title": "t", "version_id": "v3",
            "comprehension": {"questions": [
                {"index": i, "stem": f"題{i}", "answer": "A", "options": {"A": "a", "B": "b"}}
                for i in range(1, 6)
            ]},
        }
        settings = {"source_modules": ["comprehension"], "seconds": 30, "question_count_mode": 3}
        rounds, fallback = choice.generate_rounds([{"lesson_uid": "L1", "lesson": lesson}], settings, random.Random(1))
        assert len(rounds) == 3
        assert fallback is False

    def test_fallback_flag_when_pool_smaller_than_requested(self):
        """UI/UX review 2026-10-15 #8: fewer available items than requested
        -> use all available + report the shortfall via the fallback flag."""
        lesson = {
            "title": "t", "version_id": "v3",
            "comprehension": {"questions": [
                {"index": i, "stem": f"題{i}", "answer": "A", "options": {"A": "a", "B": "b"}}
                for i in range(1, 3)  # only 2 questions available
            ]},
        }
        settings = {"source_modules": ["comprehension"], "seconds": 30, "question_count_mode": 15}
        rounds, fallback = choice.generate_rounds([{"lesson_uid": "L1", "lesson": lesson}], settings, random.Random(1))
        assert len(rounds) == 2  # used everything available, did not error
        assert fallback is True

    def test_reading_seconds_defaults_to_standard_pace_computed_from_stem(self):
        """issue #3631 P0 #1: no explicit override -> computed from the
        item's own stem length at the default ("standard") pace, not the
        old fixed ``DEFAULT_READING_SECONDS`` constant."""
        settings = {"source_modules": ["comprehension"], "seconds": 30, "question_count_mode": "all"}
        rounds, _fallback = choice.generate_rounds(_lessons_fixture(), settings, random.Random(1))
        stem = rounds[0]["payload"]["stem"]
        assert rounds[0]["payload"]["reading_seconds"] == reading_pace.compute_reading_seconds(
            stem, reading_pace.DEFAULT_PACE
        )

    def test_explicit_reading_seconds_override_still_works_for_every_item(self):
        """PK reuses this function directly with an explicit
        ``reading_seconds=0`` (no reading phase at all) — that escape hatch
        must keep working unchanged after #3631 (see
        ``app/services/pk/rounds.py``'s own docstring)."""
        settings = {"source_modules": ["comprehension"], "seconds": 30,
                    "question_count_mode": "all", "reading_seconds": 0}
        rounds, _fallback = choice.generate_rounds(_long_stem_lessons_fixture(), settings, random.Random(1))
        assert all(r["payload"]["reading_seconds"] == 0 for r in rounds)

    def test_longer_stem_gets_more_reading_time_than_a_shorter_one_in_the_same_game(self):
        settings = {"source_modules": ["comprehension"], "seconds": 30, "question_count_mode": "all"}
        rounds, _fallback = choice.generate_rounds(_long_stem_lessons_fixture(), settings, random.Random(1))
        by_stem = {r["payload"]["stem"]: r["payload"]["reading_seconds"] for r in rounds}
        assert by_stem["短"] < by_stem["這是一句明顯長很多的題目敘述文字，用來確認比較長的題目會拿到比較長的讀題時間。"]

    def test_explicit_reading_seconds_wins_when_both_are_given(self):
        """Critic review note (2026-10-19): if a caller somehow sends both
        keys, the explicit numeric override must win — the pace preset is
        only a fallback for "no explicit value given", never a tie-break."""
        settings = {"source_modules": ["comprehension"], "seconds": 30,
                    "question_count_mode": "all", "reading_seconds": 7, "reading_pace": "fast"}
        rounds, _fallback = choice.generate_rounds(_long_stem_lessons_fixture(), settings, random.Random(1))
        assert all(r["payload"]["reading_seconds"] == 7 for r in rounds)

    def test_reading_pace_setting_selects_the_preset(self):
        settings_slow = {"source_modules": ["comprehension"], "seconds": 30,
                          "question_count_mode": "all", "reading_pace": "slow"}
        settings_fast = dict(settings_slow, reading_pace="fast")
        rounds_slow, _ = choice.generate_rounds(_long_stem_lessons_fixture(), settings_slow, random.Random(1))
        rounds_fast, _ = choice.generate_rounds(_long_stem_lessons_fixture(), settings_fast, random.Random(1))
        slow_seconds = next(r["payload"]["reading_seconds"] for r in rounds_slow if r["payload"]["stem"] == "短")
        fast_seconds = next(r["payload"]["reading_seconds"] for r in rounds_fast if r["payload"]["stem"] == "短")
        assert slow_seconds >= fast_seconds

    def test_explanation_lands_in_payload_when_present(self):
        settings = {"source_modules": ["comprehension"], "seconds": 30, "question_count_mode": "all"}
        rounds, _fallback = choice.generate_rounds(
            _lessons_fixture(explanation="甲才是正確答案。"), settings, random.Random(1)
        )
        assert rounds[0]["payload"]["explanation"] == "甲才是正確答案。"

    def test_explanation_key_absent_when_source_has_none(self):
        settings = {"source_modules": ["comprehension"], "seconds": 30, "question_count_mode": "all"}
        rounds, _fallback = choice.generate_rounds(_lessons_fixture(), settings, random.Random(1))
        assert "explanation" not in rounds[0]["payload"]

    def test_display_position_shuffle_breaks_source_letter_correlation(self):
        """Over many seeds, the round's correct_key should NOT always equal
        the source material's own answer letter ("A" in this fixture) —
        otherwise a public endpoint leaking the source answer would also
        leak the live-quiz answer (external review #1a)."""
        seen_keys = set()
        for seed in range(30):
            rounds, _fallback = choice.generate_rounds(
                _lessons_fixture(),
                {"source_modules": ["comprehension"], "seconds": 30, "question_count_mode": "all"},
                random.Random(seed),
            )
            seen_keys.add(rounds[0]["payload"]["correct_key"])
        assert len(seen_keys) > 1, "correct_key never varies across seeds — shuffle is not happening"

    def test_shuffle_preserves_the_correct_text_under_its_new_key(self):
        rounds, _fallback = choice.generate_rounds(
            _lessons_fixture(),
            {"source_modules": ["comprehension"], "seconds": 30, "question_count_mode": "all"},
            random.Random(5),
        )
        payload = rounds[0]["payload"]
        correct_option = next(o for o in payload["options"] if o["key"] == payload["correct_key"])
        assert correct_option["text"] == "甲"  # the text of the option that was actually correct


class TestScoreSubmission:
    def _payload(self, seconds=30):
        return {"correct_key": "A", "seconds": seconds}

    def test_correct_fast_answer_near_max_points(self):
        is_correct, points = choice.score_submission(self._payload(30), {"choice_key": "A"}, elapsed_ms=100)
        assert is_correct is True
        assert points >= 990

    def test_correct_slow_answer_near_min_points(self):
        is_correct, points = choice.score_submission(self._payload(30), {"choice_key": "A"}, elapsed_ms=30_000)
        assert is_correct is True
        assert points == 500

    def test_wrong_answer_zero(self):
        is_correct, points = choice.score_submission(self._payload(30), {"choice_key": "B"}, elapsed_ms=100)
        assert is_correct is False
        assert points == 0

    def test_missing_submission_zero(self):
        is_correct, points = choice.score_submission(self._payload(30), {}, elapsed_ms=100)
        assert is_correct is False
        assert points == 0

    def test_points_never_exceed_1000_or_drop_below_500_when_correct(self):
        for elapsed in (0, 1, 15_000, 29_999, 30_000, 40_000):
            is_correct, points = choice.score_submission(self._payload(30), {"choice_key": "A"}, elapsed_ms=elapsed)
            assert is_correct is True
            assert 500 <= points <= 1000


class TestPlayerView:
    def test_hides_correct_key_before_reveal(self):
        payload = {"source_module": "comprehension", "lesson_uid": "L1", "lesson_title": "t",
                   "stem": "s", "options": [{"key": "A", "text": "a"}], "correct_key": "A", "seconds": 30}
        view = choice.player_view(payload, revealed=False)
        assert "correct_key" not in view

    def test_shows_correct_key_after_reveal(self):
        payload = {"source_module": "comprehension", "lesson_uid": "L1", "lesson_title": "t",
                   "stem": "s", "options": [{"key": "A", "text": "a"}], "correct_key": "A", "seconds": 30}
        view = choice.player_view(payload, revealed=True)
        assert view["correct_key"] == "A"

    def test_reading_phase_hides_options_too(self):
        """UI/UX review #2: stem-alone phase — options withheld server-side,
        not just left for the client to not-render."""
        payload = {"source_module": "comprehension", "lesson_uid": "L1", "lesson_title": "t",
                   "stem": "s", "options": [{"key": "A", "text": "a"}], "correct_key": "A", "seconds": 30}
        view = choice.player_view(payload, revealed=False, show_options=False)
        assert "options" not in view
        assert view["stem"] == "s"

    def test_extra_payload_surfaces_in_every_phase(self):
        """e.g. zhuyin's target_index — not the answer, safe pre-reveal."""
        payload = {"source_module": "zhuyin", "lesson_uid": "L1", "lesson_title": "t",
                   "stem": "他還沒說完。", "options": [{"key": "A", "text": "ㄏㄞˊ"}],
                   "correct_key": "A", "seconds": 30, "extra": {"target_index": 1}}
        view = choice.player_view(payload, revealed=False, show_options=False)
        assert view["extra"] == {"target_index": 1}

    def test_explanation_hidden_before_reveal(self):
        """issue #3631 P0 #2: 看解析 only makes sense once the answer is
        already shown — same gate as correct_key, not a separate leak."""
        payload = {"source_module": "comprehension", "lesson_uid": "L1", "lesson_title": "t",
                   "stem": "s", "options": [{"key": "A", "text": "a"}], "correct_key": "A", "seconds": 30,
                   "explanation": "因為……"}
        view = choice.player_view(payload, revealed=False)
        assert "explanation" not in view

    def test_explanation_shown_after_reveal_when_present(self):
        payload = {"source_module": "comprehension", "lesson_uid": "L1", "lesson_title": "t",
                   "stem": "s", "options": [{"key": "A", "text": "a"}], "correct_key": "A", "seconds": 30,
                   "explanation": "因為……"}
        view = choice.player_view(payload, revealed=True)
        assert view["explanation"] == "因為……"

    def test_explanation_key_absent_after_reveal_when_not_present(self):
        """No explanation text for this question -> frontend must not render
        a 看解析 button pointing at nothing."""
        payload = {"source_module": "comprehension", "lesson_uid": "L1", "lesson_title": "t",
                   "stem": "s", "options": [{"key": "A", "text": "a"}], "correct_key": "A", "seconds": 30}
        view = choice.player_view(payload, revealed=True)
        assert "explanation" not in view
