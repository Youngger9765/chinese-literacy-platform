"""test_lesson_content_schema.py — EDD gate for the block-based Lesson contract.

Part of the 閱讀聚光燈 refactor (SPOTLIGHT_REFACTOR_PLAN.md), Phase 0 + Phase 1.

Wraps the eval harness (scripts/eval_lesson_content.py) into pytest so the contract
is enforced in the repo's normal test run:

  1. every fixture parses against the pydantic contract           (schema validation)
  2. every exercise's stored answer re-grades itself              (answer round-trip)
  3. the contract can express all 7 registered question types     (anti-overfit coverage)
  4. the invariant actually rejects bad lessons                   (negative tests)
  5. approved fixtures match their frozen golden snapshots        (regression / golden-master)

Run:  cd backend && python -m pytest tests/test_lesson_content_schema.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

from pydantic import ValidationError  # noqa: E402

from app.schemas.lesson_content import (  # noqa: E402
    AnswerSpace,
    ExerciseBlock,
    Grader,
    Lesson,
)
from eval_lesson_content import (  # noqa: E402
    FIXTURE_DIR,
    answer_round_trip,
    check_golden,
    grade,
    lesson_coverage,
    load_lesson,
)

FIXTURES = sorted(FIXTURE_DIR.glob("*.lesson.yml"))
FIXTURE_IDS = [p.stem for p in FIXTURES]

REGISTERED_KINDS = {
    "multiple_choice",
    "fill_in_blank",
    "ordering",
    "trait_inference",
    "guided_steps",
    "graphic_text_integration",
    "custom",
}


def test_fixtures_exist() -> None:
    # 4 layered fixtures: narrative / graphic-text / 文言文 / multi-type (plan §3.4).
    assert len(FIXTURES) >= 4, "expected >= 4 layered hard-case fixtures"


# ── (1) schema validation ────────────────────────────────────────────────────
@pytest.mark.parametrize("path", FIXTURES, ids=FIXTURE_IDS)
def test_fixture_validates(path: Path) -> None:
    lesson = load_lesson(path)
    assert isinstance(lesson, Lesson)
    assert lesson.blocks, "lesson must have >= 1 block"


# ── (2) answer round-trip ────────────────────────────────────────────────────
@pytest.mark.parametrize("path", FIXTURES, ids=FIXTURE_IDS)
def test_answer_round_trip(path: Path) -> None:
    """Every machine-graded exercise must re-grade its own stored answer as correct;
    rubric/manual exercises are allowed to be 'soft' (present but human-graded).
    NONE may be 'fail' — that would mean a stored answer the grader rejects."""
    lesson = load_lesson(path)
    for b in lesson.blocks:
        if isinstance(b, ExerciseBlock):
            assert answer_round_trip(b) != "fail", (
                f"{path.name}: exercise '{b.id}' cannot re-grade its own answer"
            )


# ── (3) anti-overfit: contract expresses all 7 registered types ──────────────
def test_all_question_types_covered() -> None:
    seen: set[str] = set()
    for path in FIXTURES:
        seen |= lesson_coverage(load_lesson(path))["kinds"]
    missing = REGISTERED_KINDS - seen
    assert not missing, f"fixtures do not exercise these registered types: {missing}"


@pytest.mark.parametrize("path", FIXTURES, ids=FIXTURE_IDS)
def test_all_exercises_anchored(path: Path) -> None:
    lesson = load_lesson(path)
    for b in lesson.blocks:
        if isinstance(b, ExerciseBlock):
            assert b.anchors, f"{path.name}: exercise '{b.id}' has no spotlight anchor"


# ── (4) negative tests: the invariant must REJECT bad lessons ────────────────
def _base_lesson_dict() -> dict:
    return {
        "id": "neg",
        "lesson_code": "NEG-1",
        "blocks": [
            {"id": "p1", "type": "paragraph", "text": "some passage"},
            {
                "id": "ex1",
                "type": "exercise",
                "question": {
                    "kind": "multiple_choice",
                    "question": "q?",
                    "options": ["a", "b"],
                },
                "answer_space": "choice",
                "answer": 0,
                "grader": "exact",
                "anchors": [{"block_id": "p1"}],
            },
        ],
    }


def test_reject_null_answer_without_review() -> None:
    d = _base_lesson_dict()
    d["blocks"][1]["answer"] = None
    with pytest.raises(ValidationError, match="machine-comparable answer"):
        Lesson.model_validate(d)


def test_reject_custom_without_needs_review() -> None:
    d = _base_lesson_dict()
    d["blocks"][1]["question"] = {"kind": "custom", "prompt": "do the thing"}
    d["blocks"][1]["answer_space"] = "text"
    d["blocks"][1]["answer"] = "42"
    d["blocks"][1]["grader"] = "exact"
    # needs_review left False → must be rejected
    with pytest.raises(ValidationError, match="needs_review"):
        Lesson.model_validate(d)


def test_reject_incoherent_space_grader() -> None:
    d = _base_lesson_dict()
    d["blocks"][1]["answer_space"] = "free_text"  # rubric/manual only
    d["blocks"][1]["grader"] = "exact"  # not allowed for free_text
    with pytest.raises(ValidationError, match="not valid for answer_space"):
        Lesson.model_validate(d)


def test_reject_anchor_to_missing_block() -> None:
    d = _base_lesson_dict()
    d["blocks"][1]["anchors"] = [{"block_id": "does-not-exist"}]
    with pytest.raises(ValidationError, match="anchors unknown block"):
        Lesson.model_validate(d)


def test_reject_duplicate_block_ids() -> None:
    d = _base_lesson_dict()
    d["blocks"].append(dict(d["blocks"][0]))  # duplicate p1
    with pytest.raises(ValidationError, match="duplicate block ids"):
        Lesson.model_validate(d)


def test_custom_with_review_is_accepted() -> None:
    """The escape hatch is allowed — as long as it carries an answer + review flag."""
    d = _base_lesson_dict()
    d["blocks"][1]["question"] = {"kind": "custom", "prompt": "do the thing"}
    d["blocks"][1]["answer_space"] = "text"
    d["blocks"][1]["answer"] = "42"
    d["blocks"][1]["grader"] = "exact"
    d["blocks"][1]["needs_review"] = True
    lesson = Lesson.model_validate(d)
    ex = lesson.blocks[1]
    assert isinstance(ex, ExerciseBlock) and ex.needs_review


def test_grade_helper_semantics() -> None:
    """Sanity-check the grader used for round-trip: set is unordered, ordered is not."""
    d = _base_lesson_dict()
    d["blocks"][1]["question"] = {
        "kind": "multiple_choice",
        "question": "pick all",
        "options": ["a", "b", "c"],
    }
    d["blocks"][1]["answer_space"] = "multi_choice"
    d["blocks"][1]["answer"] = [0, 2]
    d["blocks"][1]["grader"] = "set"
    ex = Lesson.model_validate(d).blocks[1]
    assert isinstance(ex, ExerciseBlock)
    assert grade(ex, [2, 0]) is True   # set: order-insensitive
    assert grade(ex, [0, 1]) is False


# ── (5) golden-master regression ─────────────────────────────────────────────
@pytest.mark.parametrize("path", FIXTURES, ids=FIXTURE_IDS)
def test_golden_snapshot(path: Path) -> None:
    """An approved fixture whose normalized content changed trips this — the plan's
    'don't silently mutate approved lessons' guard (§3.2). If a change is intentional,
    re-approve via: eval_lesson_content.py --fixtures --freeze-golden."""
    lesson = load_lesson(path)
    ok, msg = check_golden(path, lesson)
    assert ok, msg
