"""Tests for #2038 OMO reference-led alignment (also #2089 item 2).

Two behaviours:

  Task A — media-artifact filter:
    video-caption parse artifacts (片長 / 建議觀看 regions mis-parsed as
    fill-in blanks) must NOT enter the reference question schema. Validated
    against meeting §2「占位空格被誤判為填空題」. Across the 57 lessons exactly
    two such entries exist (G7-L28 id=1, G7-L30 id=1) — real blanks (933 of
    them) must be untouched.

  依關卡順序 — step ordering:
    each question carries the UI step (step_sequence id) it belongs to, and
    graded results are ordered by the lesson's step_sequence rather than by
    question type (fb→mc→se).
"""
import glob
import os

import pytest
import yaml

from app.services.omo_question_schema import (
    _build_question_schema,
    _is_media_artifact,
    QUESTION_TYPE_TO_STEP,
)
from app.services.omo_grader import GradedAnswer, _order_by_step_sequence

LESSON_DIR = os.path.join(
    os.path.dirname(__file__), "..", "data", "lessons", "_parsed_2026-05-01"
)


def _load(code: str) -> dict:
    with open(os.path.join(LESSON_DIR, f"{code}.yml"), encoding="utf-8") as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Task A — media-artifact filter
# ---------------------------------------------------------------------------

class TestMediaArtifactFilter:
    def test_detects_video_caption_artifact(self):
        artifact = {
            "answer": "外來種",
            "context_before": "",
            "context_after": "你知道八哥有分本土和外來種嗎？｜ ・片長：(22:48) 建議觀看",
        }
        assert _is_media_artifact(artifact) is True

    def test_real_cloze_with_sentence_is_not_artifact(self):
        # Even if the surrounding text mentions a video, a real cloze sentence
        # means it is a genuine question.
        real = {
            "answer": "微生物",
            "sentence": "肉湯腐敗和空氣中的【微生物】有關。",
            "context_after": "・片長：(12:59)",
        }
        assert _is_media_artifact(real) is False

    def test_plain_blank_without_video_markers_is_not_artifact(self):
        assert _is_media_artifact(
            {"answer": "煮沸", "context_before": "只要把肉湯", "context_after": "並阻止微生物"}
        ) is False

    def test_g7l30_noise_blank_removed_from_schema(self):
        # G7-L30 has a single fill_in_blank that is a video-caption artifact.
        questions = _build_question_schema(_load("G7-L30"))
        assert not any(q.get("step") == "vocab-application" for q in questions), (
            "G7-L30's video-caption blank must not become a graded question"
        )

    def test_g7l28_drops_only_the_artifact_keeps_real_blanks(self):
        # G7-L28 id=1 ('LIS科學史' video region) is an artifact; id=2..15 are
        # real Pasteur-experiment cloze questions and must survive.
        questions = _build_question_schema(_load("G7-L28"))
        fb_ids = [q["id"] for q in questions if q.get("step") == "vocab-application"]
        assert "fb_1" not in fb_ids
        assert "fb_2" in fb_ids and "fb_15" in fb_ids
        assert len(fb_ids) == 14

    def test_artifact_does_not_corrupt_lettered_mode_detection(self):
        # #2038 review: a lettered lesson whose first fb entry is a video
        # artifact with a NON-letter answer ('外來種') must still be detected as
        # lettered — the artifact must be skipped before fb_lettered is computed,
        # otherwise every real fb gets scored as free_form.
        lesson = {
            "fill_in_blank": {
                "1": {"answer": "外來種", "context_before": "",
                      "context_after": "・片長：(3:00) 建議觀看"},
                "2": {"answer": "A", "sentence": "學生需填入【   】"},
                "3": {"answer": "B", "sentence": "另一格【   】"},
            },
            "vocabulary": [{"word": "規律"}, {"word": "秩序"}],
        }
        questions = _build_question_schema(lesson)
        real = [q for q in questions if q["id"] == "2"]
        assert real, "the real lettered blank must survive"
        assert real[0]["mode"] == "lettered", (
            "artifact's non-letter answer must not flip the lesson to free_form"
        )
        # The artifact itself must not appear as a question.
        assert not any(q["id"] == "1" for q in questions)

    def test_filter_does_not_drop_real_blanks_across_all_lessons(self):
        # Guardrail: only the two known artifacts may be filtered. Compare the
        # raw fill_in_blank count to the schema fill_blank count per lesson.
        total_dropped = 0
        for path in glob.glob(os.path.join(LESSON_DIR, "*.yml")):
            d = yaml.safe_load(open(path, encoding="utf-8")) or {}
            fb = d.get("fill_in_blank") or []
            raw_fb = len(fb) if isinstance(fb, (list, dict)) else 0
            if raw_fb == 0:
                continue
            schema_fb = sum(
                1 for q in _build_question_schema(d)
                if q.get("step") == "vocab-application"
            )
            total_dropped += raw_fb - schema_fb
        assert total_dropped == 2, (
            f"expected exactly 2 artifacts filtered across all lessons, got {total_dropped}"
        )


# ---------------------------------------------------------------------------
# 依關卡順序 — step assignment + ordering
# ---------------------------------------------------------------------------

class TestStepAssignment:
    def test_each_type_maps_to_its_ui_step(self):
        assert QUESTION_TYPE_TO_STEP["fill_blank"] == "vocab-application"
        assert QUESTION_TYPE_TO_STEP["multiple_choice"] == "comprehension"
        assert QUESTION_TYPE_TO_STEP["strategy_exercise"] == "reading-strategy"

    def test_schema_questions_carry_a_step(self):
        questions = _build_question_schema(_load("G6-L24"))
        assert questions, "G6-L24 should produce questions"
        assert all(q.get("step") for q in questions)
        steps = {q["step"] for q in questions}
        assert steps <= {"vocab-application", "comprehension", "reading-strategy"}


class TestStepOrdering:
    def _ans(self, qid: str, step: str) -> GradedAnswer:
        return GradedAnswer(
            question_id=qid, student_answer="", correct_answer="",
            score=0.0, ai_confidence=0.0, reasoning="", step=step,
        )

    def test_orders_by_step_sequence_not_question_type(self):
        # Lesson runs vocab-application → reading-strategy → comprehension, so
        # se (reading-strategy) must come BEFORE mc (comprehension) — the
        # reverse of the old fb→mc→se type order.
        lesson = {
            "step_sequence": [
                "intro", "vocab-application", "reading-strategy",
                "comprehension", "report",
            ]
        }
        questions = [
            {"id": "fb_1"}, {"id": "mc_1"}, {"id": "se_1"},
        ]
        # Results arrive in arbitrary (Gemini visual-scan) order.
        results = [
            self._ans("mc_1", "comprehension"),
            self._ans("se_1", "reading-strategy"),
            self._ans("fb_1", "vocab-application"),
        ]
        ordered = _order_by_step_sequence(results, lesson, questions)
        assert [g.question_id for g in ordered] == ["fb_1", "se_1", "mc_1"]

    def test_within_step_keeps_stable_yaml_order(self):
        lesson = {"step_sequence": ["vocab-application"]}
        questions = [{"id": "fb_1"}, {"id": "fb_2"}, {"id": "fb_3"}]
        results = [
            self._ans("fb_3", "vocab-application"),
            self._ans("fb_1", "vocab-application"),
            self._ans("fb_2", "vocab-application"),
        ]
        ordered = _order_by_step_sequence(results, lesson, questions)
        assert [g.question_id for g in ordered] == ["fb_1", "fb_2", "fb_3"]

    def test_unknown_step_sorts_last(self):
        # A question whose step is not in step_sequence goes to the end.
        lesson = {"step_sequence": ["comprehension"]}
        questions = [{"id": "mc_1"}, {"id": "fb_1"}]
        results = [
            self._ans("fb_1", "vocab-application"),  # step absent from sequence
            self._ans("mc_1", "comprehension"),
        ]
        ordered = _order_by_step_sequence(results, lesson, questions)
        assert [g.question_id for g in ordered] == ["mc_1", "fb_1"]

    def test_empty_step_sequence_falls_back_to_question_order(self):
        lesson = {}  # no step_sequence
        questions = [{"id": "fb_1"}, {"id": "mc_1"}]
        results = [
            self._ans("mc_1", "comprehension"),
            self._ans("fb_1", "vocab-application"),
        ]
        ordered = _order_by_step_sequence(results, lesson, questions)
        # All steps unknown → sort by qid_order (YAML order) → fb_1, mc_1.
        assert [g.question_id for g in ordered] == ["fb_1", "mc_1"]
