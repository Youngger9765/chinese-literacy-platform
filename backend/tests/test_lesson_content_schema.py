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
    TableBlock,
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


@pytest.mark.parametrize("bad", [-1, -2])
def test_reject_select_negative_index(bad: int) -> None:
    """A negative select index is out of range — 0-based option index has no negative
    slot. The zod mirror rejects it via a field-level `.min(0)`; the pydantic select
    branch must reject it too or the two contracts drift on the SAME lesson (e.g. a
    parser off-by-one / -1 sentinel would pass backend but fail frontend)."""
    d = _guided_lesson([
        {"prompt": "p", "type": "select", "options": ["a", "b"], "answer": bad},
    ], needs_review=True, answer=[bad])
    with pytest.raises(ValidationError, match="out of range"):
        Lesson.model_validate(d)


def test_reject_graphic_text_integration_select_negative_index() -> None:
    """graphic_text_integration reuses GuidedStep, so the same negative-index guard
    must apply (this type is the one the drift report specifically flagged)."""
    d = {
        "id": "g", "lesson_code": "G-1",
        "blocks": [
            {"id": "p1", "type": "paragraph", "text": "passage"},
            {
                "id": "ex1", "type": "exercise",
                "question": {
                    "kind": "graphic_text_integration", "strategy_name": "s",
                    "instruction": "i",
                    "steps": [
                        {"prompt": "p", "type": "select", "options": ["a", "b"],
                         "answer": -1},
                    ],
                },
                "answer_space": "free_text", "answer": [-1], "grader": "rubric_ai",
                "needs_review": True, "anchors": [{"block_id": "p1"}],
            },
        ],
    }
    with pytest.raises(ValidationError, match="out of range"):
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
    with pytest.raises(ValidationError, match="width 2 != expected 3"):
        Lesson.model_validate(d)


# ── (Gap 2a) vmerged section-label COLUMN — the real-corpus topology ──────────
def _lesson_with_full_table(table: dict) -> dict:
    return {
        "id": "t", "lesson_code": "T-1",
        "blocks": [table, {"id": "p1", "type": "paragraph", "text": "x"}],
    }


def test_vmerged_section_label_column_grid_accepts() -> None:
    """The DEFINING real-corpus shape (G7-L30 表一): a vmerged 異同 section-label COLUMN,
    NOT a horizontal band. The origin row of each section carries the section cell with
    rowspan=N; the N-1 rows it spans carry ONE FEWER physical cell. The old validator
    summed only colspan and rejected this — the rowspan-aware validator must accept it."""
    headers = ["異同", "比較項目", "白尾八哥", "臺灣冠八哥"]
    grid = [
        [{"text": "相同處", "rowspan": 5, "is_section_label": True},
         {"text": "外形"}, {"text": "黑"}, {"text": "黑"}],
        [{"text": "體型"}, {"text": "接近"}, {"text": "接近"}],
        [{"text": "行動與食物"}, {"text": "覓食"}, {"text": "覓食"}],
        [{"text": "棲息地"}, {"text": "平地"}, {"text": "平地"}],
        [{"text": "生物分類"}, {"text": "留鳥"}, {"text": "留鳥"}],
        [{"text": "相異處", "rowspan": 9, "is_section_label": True},
         {"text": "嘴喙顏色"}, {"text": "黃"}, {"text": "象牙白"}],
        [{"text": "尾羽顏色"}, {"text": "末白"}, {"text": "部分白"}],
        [{"text": "冠羽"}, {"text": "不明顯"}, {"text": "明顯"}],
        [{"text": "來源"}, {"text": "外來種"}, {"text": "原生種"}],
        [{"text": "族群數量"}, {"text": "較多"}, {"text": "較少"}],
        [{"text": "習性"}, {"text": "較不怕人"}, {"text": "較怕人"}],
        [{"text": "築巢地點"}, {"text": "常利用人造"}, {"text": "較少利用"}],
        [{"text": "適應都市環境"}, {"text": "較強"}, {"text": "較弱"}],
        [{"text": "保育身分"}, {"text": "非保育類"}, {"text": "保育類"}],
    ]
    d = _lesson_with_full_table(
        {"id": "table-1", "type": "table", "headers": headers, "grid": grid}
    )
    lesson = Lesson.model_validate(d)
    tbl = lesson.blocks[0]
    assert isinstance(tbl, TableBlock)
    assert tbl.grid is not None and tbl.grid[0][0].rowspan == 5
    assert len(tbl.grid) == 14


def test_row_sections_column_fast_path_accepts() -> None:
    """The non-grid representation: `rows` are the data cells aligned to `headers`, and
    `row_sections` + `section_label_col` layer the vmerged section column on top so the
    `異同` column and the 比較項目/白尾/臺灣冠 columns stay aligned across sections."""
    d = _lesson_with_full_table({
        "id": "table-1", "type": "table",
        "headers": ["比較項目", "白尾八哥", "臺灣冠八哥"],
        "section_label_col": "異同",
        "row_sections": ["相同處", "相同處", "相異處"],
        "rows": [["外形", "黑", "黑"], ["體型", "接近", "接近"], ["嘴喙", "黃", "白"]],
    })
    tbl = Lesson.model_validate(d).blocks[0]
    assert isinstance(tbl, TableBlock)
    assert tbl.section_label_col == "異同"
    assert tbl.row_sections == ["相同處", "相同處", "相異處"]


def test_reject_row_sections_without_section_label_col() -> None:
    d = _lesson_with_full_table({
        "id": "t1", "type": "table", "headers": ["a", "b"],
        "row_sections": ["x"], "rows": [["1", "2"]],
    })
    with pytest.raises(ValidationError, match="no section_label_col"):
        Lesson.model_validate(d)


def test_reject_row_sections_length_mismatch() -> None:
    d = _lesson_with_full_table({
        "id": "t1", "type": "table", "headers": ["a", "b"],
        "section_label_col": "s", "row_sections": ["x"],
        "rows": [["1", "2"], ["3", "4"]],
    })
    with pytest.raises(ValidationError, match="row_sections length"):
        Lesson.model_validate(d)


def test_horizontal_band_grid_still_accepts() -> None:
    """Backward compat: the earlier horizontal-band grid (full-width colspan section band,
    no rowspan) must keep validating under the rowspan-aware check."""
    d = _lesson_with_full_table({
        "id": "t1", "type": "table",
        "headers": ["比較項目", "白尾八哥", "臺灣冠八哥"],
        "grid": [
            [{"text": "相同處", "colspan": 3, "is_section_label": True}],
            [{"text": "外形"}, {"text": "全身大致為黑色", "colspan": 2}],
            [{"text": "相異處", "colspan": 3, "is_section_label": True}],
            [{"text": "嘴喙顏色"}, {"text": "黃色"}, {"text": "象牙白色"}],
        ],
    })
    tbl = Lesson.model_validate(d).blocks[0]
    assert isinstance(tbl, TableBlock)


def test_reject_grid_undersupply_after_span_expires() -> None:
    """A row that supplies too few cells once a vmerge from above still occupies a column
    must be rejected (the span accounting is not a free pass to drop arbitrary cells)."""
    d = _lesson_with_full_table({
        "id": "t1", "type": "table", "headers": ["a", "b", "c"],
        "grid": [
            [{"text": "S", "rowspan": 2, "is_section_label": True},
             {"text": "x"}, {"text": "y"}],
            [{"text": "z"}],  # col a still spanned → expects 2 cells, supplies 1
        ],
    })
    with pytest.raises(ValidationError, match="width 1 != expected 2"):
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
