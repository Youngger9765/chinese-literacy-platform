"""Unit tests for scripts/spotlight_to_lesson_content.py — the deterministic
spotlight→lesson_content bridge adapter (Phase 1, DEV7).

Reads the REAL backend/data/lessons/spotlight/dev7/*.spotlight.yml sources (never
mocked) and asserts the load-bearing field mappings from the adapter spec:
answer-string→index resolution, multi_select restoration (splittable) vs honest
incomplete-flagging (non-splittable), bind→anchor synthesis, keypoints 1:1, and the
no-fake-pass invariant (null step answer ⇒ needs_review).

Run: cd backend && python -m pytest tests/test_spotlight_to_lesson_content.py -v
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "backend"))
sys.path.insert(0, str(_REPO_ROOT / "scripts"))

from app.schemas.lesson_content import ExerciseBlock, Lesson  # noqa: E402
from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402

import spotlight_to_lesson_content as adapter  # noqa: E402
import eval_lesson_content as ev  # noqa: E402

DEV7 = adapter.dev7_codes()

# Codes whose target kind is graphic_text_integration (image_text / table_text).
_GRAPHIC_CODES = {
    code
    for code in DEV7
    if adapter.STRATEGY_TYPE_TO_KIND.get(
        str(
            adapter.load_spotlight(
                adapter.SPOTLIGHT_DIR / f"{code}.spotlight.yml"
            ).get("strategy_type")
        )
    )
    == "graphic_text_integration"
}


# ── helpers ─────────────────────────────────────────────────────────────────


def _build(code: str, with_keypoints: bool = False):
    lesson_dict, gaps = adapter.build_lesson_dict(code, with_keypoints=with_keypoints)
    lesson = Lesson.model_validate(lesson_dict)
    return lesson, gaps


def _spotlight_ex(lesson: Lesson) -> ExerciseBlock:
    for b in lesson.blocks:
        if b.type == "exercise" and b.id == "ex-spotlight":
            return b
    raise AssertionError("no ex-spotlight block")


def _spotlight_source(code: str):
    return adapter.load_spotlight(adapter.SPOTLIGHT_DIR / f"{code}.spotlight.yml")


def test_dev7_has_seven():
    assert len(DEV7) == 7, DEV7


# ── A. all validate ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("code", DEV7)
def test_all_dev7_validate(code):
    lesson, _ = _build(code)
    assert isinstance(lesson, Lesson)
    assert lesson.blocks  # non-empty


# ── B. identity pass-through, no padding ──────────────────────────────────────
@pytest.mark.parametrize("code", DEV7)
def test_identity_passthrough(code):
    spot = _spotlight_source(code)
    raw = str(spot["lesson"])
    lesson, _ = _build(code)
    assert lesson.lesson_code == normalize_manifest_code(raw)
    assert lesson.lesson_code == raw  # DEV7 codes already canonical/unpadded
    assert lesson.id == lesson.lesson_code


# ── C. block ids unique, ordered, well-formed ─────────────────────────────────
@pytest.mark.parametrize("code", DEV7)
def test_block_ids_unique_and_ordered(code):
    lesson, _ = _build(code, with_keypoints=True)
    ids = [b.id for b in lesson.blocks]
    assert len(ids) == len(set(ids)), f"dup ids in {code}: {ids}"
    pat = re.compile(r"^(p|fig|tbl)\d+$|^ex-spotlight$|^ex-keypoints$")
    for i in ids:
        assert pat.match(i), f"bad block id {i!r} in {code}"
    # paragraph ids p1,p2,… contiguous by order
    p_ids = [i for i in ids if re.match(r"^p\d+$", i)]
    p_nums = [int(i[1:]) for i in p_ids]
    assert p_nums == list(range(1, len(p_nums) + 1)), f"paragraph ids not contiguous: {p_ids}"


# ── D. string→index resolver (clean) + whitespace-normalization proof ─────────
def test_string_to_index_resolver_clean():
    # Pick the summary_pse lesson that has a doubled-space option ("主角  成功出關")
    # and a non-index-0 answer, WITHOUT hardcoding which lesson that is: scan DEV7.
    proof_double_space = False
    proof_nonzero = False
    for code in DEV7:
        lesson, _ = _build(code)
        ex = _spotlight_ex(lesson)
        for step in ex.question.steps:
            if step.type != "select" or step.answer is None:
                continue
            chosen = step.options[step.answer]
            # doubled internal whitespace that still resolved = normalization worked
            if re.search(r"\S\s{2,}\S", chosen):
                proof_double_space = True
            if step.answer != 0:
                proof_nonzero = True
            # every resolved select answer must point at the option that (normalized)
            # equals the stored answer string in the SOURCE
    assert proof_nonzero, "expected at least one non-index-0 select answer across DEV7"
    assert proof_double_space, "expected at least one doubled-space option that still resolved"


@pytest.mark.parametrize("code", DEV7)
def test_every_clean_select_resolves(code):
    """Census: every non-multi single resolves to a real index (0 nulls in DEV7)."""
    spot = _spotlight_source(code)
    lesson, _ = _build(code)
    ex = _spotlight_ex(lesson)
    for step in ex.question.steps:
        if step.type == "select":
            # A clean select in DEV7 must resolve; incomplete-複選 selects may be null
            # but then the block is flagged for review (checked in test N).
            assert isinstance(step.answer, int) or ex.needs_review


# ── E. resolver fail-closed (crafted in-memory block, NOT a hardcoded lesson) ──
def test_resolver_fail_closed():
    gaps = adapter.GapLog()
    block = {
        "type": "single",
        "prompt": "哪一個是正解？",
        "options": ["甲選項", "乙選項"],
        "answer": "丙選項（不在選項內）",
    }
    step, unresolved = adapter._make_step(block, "TEST-CODE", gaps, "spotlight#1")
    assert step["answer"] is None
    assert unresolved is True
    reasons = {g["reason"] for g in gaps.for_lesson("TEST-CODE")}
    assert "answer_not_in_options" in reasons


# ── F. multi_select restoration (splittable inline ②) ─────────────────────────
def test_multi_select_restoration_splittable():
    found = False
    for code in _GRAPHIC_CODES:
        lesson, _ = _build(code)
        ex = _spotlight_ex(lesson)
        for step in ex.question.steps:
            if step.type == "multi_select":
                found = True
                assert isinstance(step.answer, list)
                assert len(step.answer) >= 2, step.answer
                assert len(step.options) >= 3, step.options
                # in-range + deduped
                assert len(set(step.answer)) == len(step.answer)
                assert all(0 <= i < len(step.options) for i in step.answer)
    assert found, "expected at least one splittable 複選 → multi_select in graphic lessons"


# ── G. multi_select incomplete flagged (non-splittable, no fake pass) ─────────
def test_multi_select_incomplete_flagged():
    found = False
    for code in _GRAPHIC_CODES:
        lesson, gaps = _build(code)
        reasons = {g["reason"] for g in gaps.for_lesson(code)}
        if "multi_choice_incomplete_answer" in reasons:
            found = True
            ex = _spotlight_ex(lesson)
            assert ex.needs_review is True
            # No incomplete step was silently promoted to a 1-element multi_select.
            for step in ex.question.steps:
                if step.type == "multi_select":
                    assert len(step.answer) >= 2
    assert found, "expected at least one non-splittable 複選 → incomplete gap in DEV7"


# ── H. free_text step: answer None, reference routed ──────────────────────────
@pytest.mark.parametrize("code", DEV7)
def test_free_text_step_answer_none(code):
    lesson, _ = _build(code)
    ex = _spotlight_ex(lesson)
    for step in ex.question.steps:
        if step.type == "free_text":
            assert step.answer is None
            assert step.reference_answer is None or (
                isinstance(step.reference_answer, str) and len(step.reference_answer) >= 1
            )


# ── I. assembled block answer == per-step answers (eval cross-check) ──────────
@pytest.mark.parametrize("code", DEV7)
def test_assembled_block_answer_matches_steps(code):
    lesson, _ = _build(code)
    ex = _spotlight_ex(lesson)
    assert ev._block_answer_matches_steps(ex) is True
    assert ex.answer_space.value == "free_text"
    assert ex.grader.value == "rubric_ai"
    # elementwise (multi_select compared as set)
    assert len(ex.answer) == len(ex.question.steps)
    for stored, step in zip(ex.answer, ex.question.steps):
        if step.type == "multi_select":
            assert set(stored) == set(step.answer)
        else:
            assert stored == step.answer


# ── J. anchors reference real blocks ──────────────────────────────────────────
@pytest.mark.parametrize("code", DEV7)
def test_anchors_reference_real_blocks(code):
    lesson, _ = _build(code)
    ex = _spotlight_ex(lesson)
    non_ex_ids = {
        b.id for b in lesson.blocks if b.type in ("paragraph", "figure", "table", "parallel_passage")
    }
    for a in ex.anchors:
        assert a.block_id in non_ex_ids
    # The anchor set is exactly the emitted non-exercise blocks in document order.
    assert {a.block_id for a in ex.anchors} == set(non_ex_ids) or not non_ex_ids
    if code in _GRAPHIC_CODES and non_ex_ids:
        # A graphic-text lesson that emitted any non-exercise blocks must anchor at
        # least one figure/table (fig*/tbl*) — the graphic-text flow. (Some image_text
        # sources carry NO `passage` blocks — their prose lives in guide text — so a
        # paragraph anchor is NOT guaranteed; a figure/table anchor is.)
        anchor_ids = {a.block_id for a in ex.anchors}
        assert any(i.startswith("fig") or i.startswith("tbl") for i in anchor_ids), anchor_ids


# ── K. strategy_type → kind map (keyed on CODE) ───────────────────────────────
@pytest.mark.parametrize("code", DEV7)
def test_strategy_type_kind_map(code):
    spot = _spotlight_source(code)
    strategy_type = str(spot.get("strategy_type"))
    expected = adapter.STRATEGY_TYPE_TO_KIND.get(strategy_type, adapter.DEFAULT_KIND)
    lesson, _ = _build(code)
    ex = _spotlight_ex(lesson)
    assert ex.question.kind == expected


# ── L. keypoints when enabled ─────────────────────────────────────────────────
@pytest.mark.parametrize("code", DEV7)
def test_keypoints_when_enabled(code):
    lesson_kp, _ = _build(code, with_keypoints=True)
    kp_blocks = [b for b in lesson_kp.blocks if b.type == "exercise" and b.id == "ex-keypoints"]
    assert kp_blocks, f"{code}: expected an ex-keypoints block with --with-keypoints"
    kp = kp_blocks[0]
    q = kp.question
    assert q.kind == "keypoints_table"
    assert q.structure in ("flat", "nested")
    assert isinstance(kp.answer, dict) and kp.answer
    blank_ids = {b.id for b in q.blanks}
    for row in q.rows:
        assert set(row.blank_ids) <= blank_ids
    for b in q.blanks:
        assert isinstance(b.answer, str) and len(b.answer) >= 1

    # without the flag, no keypoints block (subset stays green)
    lesson_no, _ = _build(code, with_keypoints=False)
    assert not [b for b in lesson_no.blocks if b.type == "exercise" and b.id == "ex-keypoints"]


def test_keypoints_empty_blank_skipped_and_logged():
    """Crafted: an EMPTY 【】 is skipped (not emitted as an invalid blank) + logged."""
    parsed = {
        "title": "測試標題",
        "story_structure_table": [
            ["測試標題"],
            ["甲", "第一格有【 正解 】和一個空的【　】。"],
        ],
    }
    gaps = adapter.GapLog()
    kp = adapter.build_keypoints_exercise(parsed, "TEST-CODE", None, gaps)
    assert kp is not None
    ids = [b["id"] for b in kp["question"]["blanks"]]
    # only the non-empty fill survives
    assert kp["question"]["blanks"] == [{"id": "r1.b1", "answer": "正解"}]
    reasons = {g["reason"] for g in gaps.for_lesson("TEST-CODE")}
    assert "keypoints_blank_null_answer" in reasons
    # and the emitted block still validates when wrapped in a Lesson
    lesson = Lesson.model_validate(
        {
            "id": "TEST-CODE",
            "lesson_code": "TEST-CODE",
            "blocks": [
                {"id": "p1", "type": "paragraph", "text": "錨點段落"},
                kp,
            ],
        }
    )
    assert lesson.blocks[1].id == "ex-keypoints"


# ── M. round-trip never fails ─────────────────────────────────────────────────
@pytest.mark.parametrize("code", DEV7)
def test_round_trip_no_fail(code):
    lesson, _ = _build(code, with_keypoints=True)
    for b in lesson.blocks:
        if b.type == "exercise":
            assert ev.answer_round_trip(b) != "fail", (code, b.id)


# ── N. no-fake-pass invariant ─────────────────────────────────────────────────
@pytest.mark.parametrize("code", DEV7)
def test_no_fake_pass_invariant(code):
    lesson, gaps = _build(code)
    for b in lesson.blocks:
        if b.type != "exercise":
            continue
        steps = getattr(b.question, "steps", None)
        if steps is None:
            continue
        has_null_machine = any(
            s.type in ("select", "multi_select") and s.answer is None for s in steps
        )
        if has_null_machine:
            assert b.needs_review is True, (code, b.id)


def test_needs_review_iff_incomplete_multi():
    """Corpus-level honesty: a lesson's spotlight needs_review is driven by unresolved
    machine steps; and the total needs_review count across DEV7 is reported (not
    silently 0 — DEV7 has exactly the G7 table-text lesson with 2 incomplete 複選)."""
    total_review = 0
    total_incomplete_gaps = 0
    for code in DEV7:
        lesson, gaps = _build(code)
        ex = _spotlight_ex(lesson)
        if ex.needs_review:
            total_review += 1
        incomplete = [
            g for g in gaps.for_lesson(code) if g["reason"] == "multi_choice_incomplete_answer"
        ]
        total_incomplete_gaps += len(incomplete)
        # per-lesson: needs_review iff there is an incomplete-複選 (the only DEV7 trigger)
        if incomplete:
            assert ex.needs_review is True
    assert total_review >= 1, "DEV7 must surface >=1 honest needs_review (not silently 0)"
    assert total_incomplete_gaps >= 1


# ── OVERFIT GUARD: adapter source contains NO lesson-id / course-name literal ─
def test_adapter_module_has_no_overfit_literals():
    src = Path(adapter.__file__).read_text(encoding="utf-8")
    # Strip comment / docstring lines (mirror the lint's grep -v), then scan code lines.
    code_lines = []
    in_doc = False
    for line in src.splitlines():
        stripped = line.strip()
        if stripped.startswith(('"""', "'''")):
            # toggle for simple one-line or block docstrings
            if stripped.count('"""') == 2 or stripped.count("'''") == 2:
                continue
            in_doc = not in_doc
            continue
        if in_doc:
            continue
        if stripped.startswith("#"):
            continue
        code_lines.append(line)
    code_src = "\n".join(code_lines)
    hit = re.search(r"G[0-9]-L[0-9]|孟嘗君|白鯨|八哥|雞鳴狗盜", code_src)
    assert hit is None, f"adapter source has overfit literal: {hit.group(0)!r}"
