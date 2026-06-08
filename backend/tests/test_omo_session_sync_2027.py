"""Tests for OMO → LearningSession step_progress sync (#2027 / #2089 item 3).

Covers the pure merge logic that writes paper-grading results into the same
step_progress store online answers use: lighting up the 關卡 dots
(steps_completed) and storing the paper作答對錯 (step_data[step]["omo"]),
without clobbering any online progress.
"""
from types import SimpleNamespace

from app.services.omo_session_sync import (
    build_step_progress_update,
    _step_for,
    _QID_PREFIX_TO_STEP,
)


def _g(qid, step="", student="", correct="", score=0.0, conf=0.9, context=""):
    return SimpleNamespace(
        question_id=qid, step=step, student_answer=student,
        correct_answer=correct, score=score, ai_confidence=conf, context=context,
    )


class TestStepResolution:
    def test_uses_explicit_step_when_present(self):
        assert _step_for(_g("fb_1", step="reading-strategy")) == "reading-strategy"

    def test_falls_back_to_qid_prefix(self):
        assert _step_for(_g("fb_1")) == "vocab-application"
        assert _step_for(_g("mc_2")) == "comprehension"
        assert _step_for(_g("se_3")) == "reading-strategy"

    def test_unknown_qid_with_no_step_returns_empty(self):
        assert _step_for(_g("weird_1")) == ""

    def test_prefix_map_matches_question_type_mapping(self):
        assert set(_QID_PREFIX_TO_STEP.values()) == {
            "vocab-application", "comprehension", "reading-strategy",
        }


class TestBuildStepProgressUpdate:
    def test_lights_up_covered_steps(self):
        graded = [
            _g("fb_1", "vocab-application", student="A", correct="A", score=1.0),
            _g("mc_1", "comprehension", student="B", correct="C", score=0.0),
        ]
        sp = build_step_progress_update(None, graded)
        assert set(sp["steps_completed"]) == {"vocab-application", "comprehension"}

    def test_stores_paper_answers_under_omo_key(self):
        graded = [_g("fb_1", "vocab-application", student="冬", correct="冬", score=1.0)]
        sp = build_step_progress_update(None, graded)
        omo = sp["step_data"]["vocab-application"]["omo"]
        assert omo["source"] == "omo"
        assert omo["answers"][0] == {
            "question_id": "fb_1", "student_answer": "冬", "correct_answer": "冬",
            "score": 1.0, "ai_confidence": 0.9, "context": "",
        }
        assert "graded_at" in omo

    def test_preserves_existing_online_step_data(self):
        existing = {
            "current_step": "comprehension",
            "steps_completed": ["intro", "comprehension"],
            "step_data": {
                "comprehension": {"online_answers": [1, 2, 3]},
                "intro": {"seen": True},
            },
            "version": 5,
        }
        graded = [_g("fb_1", "vocab-application", student="A", correct="A", score=1.0)]
        sp = build_step_progress_update(existing, graded)
        # online comprehension data untouched, omo added alongside
        assert sp["step_data"]["comprehension"]["online_answers"] == [1, 2, 3]
        assert sp["step_data"]["intro"] == {"seen": True}
        assert "omo" in sp["step_data"]["vocab-application"]
        # union of completed steps (no duplicates)
        assert sp["steps_completed"] == ["intro", "comprehension", "vocab-application"]
        # current_step navigation preserved
        assert sp["current_step"] == "comprehension"

    def test_does_not_duplicate_already_completed_step(self):
        existing = {"steps_completed": ["vocab-application"], "step_data": {}, "version": 1}
        graded = [_g("fb_1", "vocab-application", student="A", correct="A", score=1.0)]
        sp = build_step_progress_update(existing, graded)
        assert sp["steps_completed"] == ["vocab-application"]

    def test_bumps_version_for_optimistic_concurrency(self):
        existing = {"steps_completed": [], "step_data": {}, "version": 7}
        sp = build_step_progress_update(existing, [_g("fb_1", "vocab-application")])
        assert sp["version"] == 8

    def test_version_starts_at_one_for_fresh_session(self):
        sp = build_step_progress_update(None, [_g("fb_1", "vocab-application")])
        assert sp["version"] == 1

    def test_re_upload_overwrites_previous_omo_record(self):
        first = build_step_progress_update(
            None, [_g("fb_1", "vocab-application", student="wrong", correct="A", score=0.0)]
        )
        second = build_step_progress_update(
            first, [_g("fb_1", "vocab-application", student="A", correct="A", score=1.0)]
        )
        answers = second["step_data"]["vocab-application"]["omo"]["answers"]
        assert len(answers) == 1
        assert answers[0]["student_answer"] == "A"
        assert answers[0]["score"] == 1.0

    def test_returns_none_when_no_gradeable_steps(self):
        # answers with no resolvable step (no .step, unknown qid prefix)
        assert build_step_progress_update(None, [_g("weird_1")]) is None

    def test_groups_multiple_answers_per_step(self):
        graded = [
            _g("fb_1", "vocab-application", student="A", correct="A", score=1.0),
            _g("fb_2", "vocab-application", student="B", correct="C", score=0.0),
            _g("mc_1", "comprehension", student="D", correct="D", score=1.0),
        ]
        sp = build_step_progress_update(None, graded)
        assert len(sp["step_data"]["vocab-application"]["omo"]["answers"]) == 2
        assert len(sp["step_data"]["comprehension"]["omo"]["answers"]) == 1
