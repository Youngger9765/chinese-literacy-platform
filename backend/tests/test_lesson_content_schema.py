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
    "keypoints_table",
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


# ── (Gap 1) multi_select guided step ─────────────────────────────────────────
def _guided_lesson(steps: list[dict], *, needs_review: bool = False,
                   answer=None) -> dict:
    """Build a minimal lesson with a single guided_steps exercise."""
    return {
        "id": "g", "lesson_code": "G-1",
        "blocks": [
            {"id": "p1", "type": "paragraph", "text": "passage"},
            {
                "id": "ex1", "type": "exercise",
                "question": {
                    "kind": "guided_steps", "strategy_name": "s",
                    "instruction": "i", "steps": steps,
                },
                "answer_space": "free_text",
                "answer": answer if answer is not None else [0],
                "grader": "rubric_ai",
                "needs_review": needs_review,
                "anchors": [{"block_id": "p1"}],
            },
        ],
    }


def test_multi_select_step_accepts_index_list() -> None:
    d = _guided_lesson([
        {"prompt": "p", "type": "multi_select", "options": ["a", "b", "c"], "answer": [0, 2]},
        {"prompt": "q", "type": "free_text"},
    ], answer=[[0, 2], None])
    lesson = Lesson.model_validate(d)
    ex = lesson.blocks[1]
    assert isinstance(ex, ExerciseBlock)
    assert ex.question.steps[0].answer == [0, 2]


def test_reject_multi_select_out_of_range() -> None:
    d = _guided_lesson([
        {"prompt": "p", "type": "multi_select", "options": ["a", "b"], "answer": [0, 9]},
    ])
    with pytest.raises(ValidationError, match="out of range"):
        Lesson.model_validate(d)


def test_reject_multi_select_duplicate() -> None:
    d = _guided_lesson([
        {"prompt": "p", "type": "multi_select", "options": ["a", "b", "c"], "answer": [1, 1]},
    ])
    with pytest.raises(ValidationError, match="duplicate"):
        Lesson.model_validate(d)


def test_reject_select_step_list_answer() -> None:
    d = _guided_lesson([
        {"prompt": "p", "type": "select", "options": ["a", "b"], "answer": [0, 1]},
    ])
    with pytest.raises(ValidationError, match="single index"):
        Lesson.model_validate(d)


def test_reject_free_text_step_with_answer() -> None:
    d = _guided_lesson([
        {"prompt": "p", "type": "free_text", "answer": 0},
    ])
    with pytest.raises(ValidationError, match="must be None"):
        Lesson.model_validate(d)


def test_reject_select_bool_answer() -> None:
    """bool is an int subclass; YAML `answer: true` must not masquerade as index 1."""
    d = _guided_lesson([
        {"prompt": "p", "type": "select", "options": ["a", "b"], "answer": True},
    ])
    with pytest.raises(ValidationError, match="bool"):
        Lesson.model_validate(d)


# ── (Gap 2) merged-cell grid + keypoints_table ───────────────────────────────
def _lesson_with_table(grid) -> dict:
    return {
        "id": "t", "lesson_code": "T-1",
        "blocks": [
            {
                "id": "tbl", "type": "table",
                "headers": ["a", "b", "c"], "grid": grid,
            },
            {"id": "p1", "type": "paragraph", "text": "x"},
        ],
    }


def test_table_grid_overlay_accepts() -> None:
    d = _lesson_with_table([
        [{"text": "section", "colspan": 3, "is_section_label": True}],
        [{"text": "a"}, {"text": "b"}, {"text": "c"}],
    ])
    lesson = Lesson.model_validate(d)
    tbl = lesson.blocks[0]
    assert tbl.grid is not None and tbl.grid[0][0].colspan == 3


def test_reject_grid_width_mismatch() -> None:
    d = _lesson_with_table([[{"text": "x", "colspan": 2}]])  # sum 2 != headers 3
    with pytest.raises(ValidationError, match="colspan sum"):
        Lesson.model_validate(d)


def _lesson_with_keypoints(rows, blanks, answer) -> dict:
    return {
        "id": "k", "lesson_code": "K-1",
        "blocks": [
            {"id": "p1", "type": "paragraph", "text": "x"},
            {
                "id": "ex1", "type": "exercise",
                "question": {
                    "kind": "keypoints_table", "structure": "nested",
                    "rows": rows, "blanks": blanks,
                },
                "answer_space": "text", "answer": answer, "grader": "exact",
                "anchors": [{"block_id": "p1"}],
            },
        ],
    }


def test_keypoints_table_dict_answer_round_trip() -> None:
    d = _lesson_with_keypoints(
        rows=[{"label": "L", "sub_label": "S", "blank_ids": ["b1", "b2"]}],
        blanks=[{"id": "b1", "answer": "x"}, {"id": "b2", "answer": "y"}],
        answer={"b1": "x", "b2": "y"},
    )
    ex = Lesson.model_validate(d).blocks[1]
    assert isinstance(ex, ExerciseBlock)
    assert answer_round_trip(ex) == "ok"  # dict branch of grade()


def test_reject_keypoints_row_unknown_blank_id() -> None:
    d = _lesson_with_keypoints(
        rows=[{"label": "L", "blank_ids": ["nope"]}],
        blanks=[{"id": "b1", "answer": "x"}],
        answer={"b1": "x"},
    )
    with pytest.raises(ValidationError, match="unknown blank id"):
        Lesson.model_validate(d)


def test_reject_keypoints_duplicate_blank_id() -> None:
    d = _lesson_with_keypoints(
        rows=[{"label": "L"}],
        blanks=[{"id": "b1", "answer": "x"}, {"id": "b1", "answer": "y"}],
        answer={"b1": "x"},
    )
    with pytest.raises(ValidationError, match="unique"):
        Lesson.model_validate(d)


# ── (Gap 3) fill_in_blank slots ──────────────────────────────────────────────
def _lesson_with_fib(question: dict, answer, grader: str = "exact") -> dict:
    return {
        "id": "f", "lesson_code": "F-1",
        "blocks": [
            {"id": "p1", "type": "paragraph", "text": "x"},
            {
                "id": "ex1", "type": "exercise",
                "question": question,
                "answer_space": "text", "answer": answer, "grader": grader,
                "anchors": [{"block_id": "p1"}],
            },
        ],
    }


def test_fill_in_blank_slots_accepts() -> None:
    d = _lesson_with_fib(
        {
            "kind": "fill_in_blank", "sentence": "a__b__",
            "slots": [
                {"id": "b1", "answer": "x", "grader": "exact"},
                {"id": "b2", "answer": ["a", "b"], "grader": "set"},
            ],
        },
        answer={"b1": "x", "b2": ["a", "b"]},
    )
    ex = Lesson.model_validate(d).blocks[1]
    assert isinstance(ex, ExerciseBlock)
    assert answer_round_trip(ex) == "ok"


def test_reject_duplicate_slot_id() -> None:
    d = _lesson_with_fib(
        {
            "kind": "fill_in_blank", "sentence": "a__b__",
            "slots": [
                {"id": "b1", "answer": "x"},
                {"id": "b1", "answer": "y"},
            ],
        },
        answer={"b1": "x"},
    )
    with pytest.raises(ValidationError, match="slot ids must be unique"):
        Lesson.model_validate(d)


def test_reject_set_slot_scalar_answer() -> None:
    d = _lesson_with_fib(
        {
            "kind": "fill_in_blank", "sentence": "a__",
            "slots": [{"id": "b1", "answer": "x", "grader": "set"}],
        },
        answer={"b1": "x"},
    )
    with pytest.raises(ValidationError, match="set slot answer must be a list"):
        Lesson.model_validate(d)


def test_fill_in_blank_without_slots_still_works() -> None:
    """Regression: the current implicit str / list[str] shapes still validate + round-trip."""
    single = _lesson_with_fib(
        {"kind": "fill_in_blank", "sentence": "a__"}, answer="x", grader="exact",
    )
    ex_single = Lesson.model_validate(single).blocks[1]
    assert isinstance(ex_single, ExerciseBlock)
    assert answer_round_trip(ex_single) == "ok"

    multi = _lesson_with_fib(
        {"kind": "fill_in_blank", "sentence": "a__b__"}, answer=["x", "y"], grader="set",
    )
    ex_multi = Lesson.model_validate(multi).blocks[1]
    assert isinstance(ex_multi, ExerciseBlock)
    assert answer_round_trip(ex_multi) == "ok"


# ── (Gap 4) guided_steps per-step round-trip + partial ───────────────────────
def test_guided_steps_partial_verdict() -> None:
    """A block with >=1 machine (select) step AND >=1 free_text step is 'partial',
    not the old blanket 'soft'."""
    d = _guided_lesson([
        {"prompt": "p", "type": "select", "options": ["a", "b"], "answer": 0},
        {"prompt": "q", "type": "free_text"},
    ], answer=[0, None])
    ex = Lesson.model_validate(d).blocks[1]
    assert isinstance(ex, ExerciseBlock)
    assert answer_round_trip(ex) == "partial"


def test_guided_steps_broken_select_fails() -> None:
    """A select step with a missing answer + block NOT flagged for review must FAIL —
    the broken index no longer hides behind a blanket soft."""
    d = _guided_lesson([
        {"prompt": "p", "type": "select", "options": ["a", "b"], "answer": None},
        {"prompt": "q", "type": "free_text"},
    ], needs_review=False, answer=[None, None])
    ex = Lesson.model_validate(d).blocks[1]
    assert isinstance(ex, ExerciseBlock)
    assert answer_round_trip(ex) == "fail"


def test_guided_steps_all_free_text_soft() -> None:
    d = _guided_lesson([
        {"prompt": "p", "type": "free_text"},
        {"prompt": "q", "type": "free_text"},
    ], needs_review=True, answer=[None, None])
    ex = Lesson.model_validate(d).blocks[1]
    assert isinstance(ex, ExerciseBlock)
    assert answer_round_trip(ex) == "soft"


def test_partial_bucket_does_not_break_coverage_report() -> None:
    """The new round_trip_partial bucket is present and print/markdown reports don't crash."""
    from eval_lesson_content import markdown_report, print_console_report

    covs = [lesson_coverage(load_lesson(p)) for p in FIXTURES]
    assert all("round_trip_partial" in c for c in covs)
    # both report renderers must run without error
    print_console_report(covs)
    md = markdown_report(covs)
    assert "partial" in md


# ── (Gap 5) parallel_passage block ───────────────────────────────────────────
def _lesson_with_parallel(rows, *, anchor_pp: bool = False) -> dict:
    blocks = [
        {
            "id": "pp", "type": "parallel_passage",
            "rows": rows,
        },
        {"id": "p1", "type": "paragraph", "text": "x"},
    ]
    if anchor_pp:
        blocks.append({
            "id": "ex1", "type": "exercise",
            "question": {"kind": "fill_in_blank", "sentence": "count? __"},
            "answer_space": "text", "answer": "148", "grader": "exact",
            "anchors": [{"block_id": "pp"}],
        })
    return {"id": "pp", "lesson_code": "PP-1", "blocks": blocks}


def test_parallel_passage_block_accepts() -> None:
    d = _lesson_with_parallel([{"left": "l", "right": "r"}])
    lesson = Lesson.model_validate(d)
    pp = lesson.blocks[0]
    assert pp.type == "parallel_passage" and pp.left_label == "白話"


def test_reject_parallel_passage_empty_rows() -> None:
    d = _lesson_with_parallel([])
    with pytest.raises(ValidationError):
        Lesson.model_validate(d)


def test_exercise_can_anchor_parallel_passage() -> None:
    d = _lesson_with_parallel([{"left": "l", "right": "r"}], anchor_pp=True)
    lesson = Lesson.model_validate(d)  # must not raise: parallel_passage is anchorable
    assert any(b.type == "exercise" for b in lesson.blocks)


def test_reject_anchor_to_exercise_block() -> None:
    """Anchors may only point at non-exercise blocks; an exercise anchor is rejected."""
    d = _base_lesson_dict()
    d["blocks"].append({
        "id": "ex2", "type": "exercise",
        "question": {"kind": "multiple_choice", "question": "q", "options": ["a", "b"]},
        "answer_space": "choice", "answer": 0, "grader": "exact",
        "anchors": [{"block_id": "ex1"}],  # points at another exercise
    })
    with pytest.raises(ValidationError, match="anchors unknown block"):
        Lesson.model_validate(d)


# ── (5) golden-master regression ─────────────────────────────────────────────
@pytest.mark.parametrize("path", FIXTURES, ids=FIXTURE_IDS)
def test_golden_snapshot(path: Path) -> None:
    """An approved fixture whose normalized content changed trips this — the plan's
    'don't silently mutate approved lessons' guard (§3.2). If a change is intentional,
    re-approve via: eval_lesson_content.py --fixtures --freeze-golden."""
    lesson = load_lesson(path)
    ok, msg = check_golden(path, lesson)
    assert ok, msg
