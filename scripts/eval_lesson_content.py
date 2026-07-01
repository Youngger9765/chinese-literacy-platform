#!/usr/bin/env python3
"""eval_lesson_content.py — EDD harness for the block-based Lesson contract.

Part of the 閱讀聚光燈 refactor (SPOTLIGHT_REFACTOR_PLAN.md), Phase 0 (§3.2 / §3.3).

This is the MINIMAL WORKING SKELETON of the eval harness the plan calls for. It does
three things over a batch of lesson-content YAML files:

  1. schema validation          — every lesson parses against the pydantic contract
  2. answer round-trip check    — every exercise's stored `answer` can be MECHANICALLY
                                   re-graded by its declared `grader` (proves answers are
                                   verifiable, not just present). §3.3 renderer contract's
                                   backend half.
  3. coverage report (紅綠燈)    — per lesson: which question types, has anchors?, is the
                                   answer machine-verifiable? Console or markdown table.

Plus a GOLDEN-SNAPSHOT primitive (§3.2): freeze each lesson's normalized JSON, and diff
against the frozen copy so an approved lesson that silently changes trips an error.

Usage:
    python3 scripts/eval_lesson_content.py --fixtures                 # console report
    python3 scripts/eval_lesson_content.py --fixtures --markdown      # markdown table
    python3 scripts/eval_lesson_content.py --fixtures --freeze-golden # (re)write goldens
    python3 scripts/eval_lesson_content.py --fixtures --check-golden  # diff vs goldens

Run with the backend venv interpreter (pydantic + pyyaml):
    backend/.venv/bin/python scripts/eval_lesson_content.py --fixtures
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import yaml

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "backend"))

from pydantic import ValidationError  # noqa: E402

from app.schemas.lesson_content import (  # noqa: E402
    ExerciseBlock,
    Grader,
    Lesson,
)

FIXTURE_DIR = _REPO_ROOT / "backend" / "tests" / "fixtures" / "lesson_content"
GOLDEN_DIR = FIXTURE_DIR / "_golden"


# ═══════════════════════════════════════════════════════════════════════════
#  Loading
# ═══════════════════════════════════════════════════════════════════════════


def load_lesson(path: Path) -> Lesson:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    return Lesson.model_validate(raw)


def discover(paths: list[Path] | None, use_fixtures: bool) -> list[Path]:
    out: list[Path] = list(paths or [])
    if use_fixtures:
        out += sorted(FIXTURE_DIR.glob("*.lesson.yml"))
    return out


# ═══════════════════════════════════════════════════════════════════════════
#  (2) Answer round-trip: can the stored answer be mechanically re-graded?
# ═══════════════════════════════════════════════════════════════════════════


def grade(ex: ExerciseBlock, response: Any) -> bool:
    """Grade a student `response` against the exercise's stored answer using its
    declared grader. This is the SAME function that proves round-trip: feeding the
    stored answer back in MUST return True (for machine graders)."""
    ans = ex.answer
    g = ex.grader
    # Gap 2/3: dict answers (keypoints_table {blank_id: fill} / slotted fill_in_blank).
    # Coarse whole-dict compare; per-slot grader refinement is future work.
    if isinstance(ans, dict):
        if not isinstance(response, dict) or response.keys() != ans.keys():
            return False
        return all(response[k] == ans[k] for k in ans)
    if g is Grader.EXACT:
        return response == ans
    if g is Grader.SET:
        try:
            return set(_as_list(response)) == set(_as_list(ans))
        except TypeError:
            return False
    if g is Grader.ORDERED:
        return _as_list(response) == _as_list(ans)
    # rubric_ai / manual are not machine-gradable — round-trip is vacuously "unknown".
    return False


def _as_list(v: Any) -> list:
    if isinstance(v, list):
        return v
    return [v]


def _step_verdict(step: Any, needs_review: bool) -> str:
    """Gap 4: per-step round-trip verdict for a guided_steps / graphic_text_integration
    step. Per-step grader is DERIVED from step.type (no schema enum):
    select→exact, multi_select→set, free_text→soft. Returns 'ok' | 'soft' | 'fail'."""
    if step.type == "free_text":
        return "soft"
    # select / multi_select — a machine step
    if step.answer is None:
        # a missing machine answer is only tolerable if the block is flagged for review
        return "soft" if needs_review else "fail"
    if step.type == "select":
        # in-range already guaranteed by GuidedStep validator; catch value/type loss
        return "ok" if (isinstance(step.answer, int) and not isinstance(step.answer, bool)) else "fail"
    # multi_select
    return "ok" if (isinstance(step.answer, list) and len(step.answer) > 0) else "fail"


def _block_answer_matches_steps(ex: ExerciseBlock) -> bool:
    """The block-level ``answer`` of a guided flow is the ORDERED list of per-step answers
    (select→int, multi_select→list[int], free_text→None). Re-grading each step's own answer
    (``_step_verdict``) does NOT catch the assembled block ``answer`` drifting from that
    list — a rendered/stored block answer of ``[0, 1, null, 1, 0, [1,2]]`` could silently
    disagree with the steps it claims to summarize. Verify the two agree.

    Only enforced when the block answer is a list aligned 1:1 to the steps (the documented
    shape). Other/legacy shapes are left to the per-step verdicts (returns True = no drift
    asserted), so this only ever turns a genuine mismatch into a 'fail', never a false one.
    """
    ans = ex.answer
    steps = ex.question.steps
    if not isinstance(ans, list) or len(ans) != len(steps):
        return True  # not the aligned per-step list shape → nothing to cross-check
    for stored, step in zip(ans, steps):
        expected = step.answer  # select→int | multi_select→list[int] | free_text→None
        if step.type == "multi_select":
            # set semantics: order-insensitive
            if stored is None and expected is None:
                continue
            if not isinstance(stored, list) or not isinstance(expected, list):
                return False
            if set(stored) != set(expected):
                return False
        else:
            if stored != expected:
                return False
    return True


def answer_round_trip(ex: ExerciseBlock) -> str:
    """Return one of: 'ok' | 'soft' | 'partial' | 'fail'.
    - ok:      machine grader re-grades the stored answer as correct
    - soft:    rubric/manual grader (answer present but not machine-verifiable)
    - partial: guided flow with >=1 machine-verified step AND >=1 soft (free_text) step
    - fail:    a machine grader / step could NOT re-grade its own answer (contract violation)

    Gap 4: for guided_steps / graphic_text_integration we re-grade EACH step by its
    derived per-step grader instead of hiding the whole block behind a blanket 'soft'.
    A broken select index (missing / wrong type) now surfaces as 'fail'. We ALSO cross-check
    the assembled block-level ``answer`` against the per-step answers so an assembled answer
    that drifts from the steps it summarizes is caught (previously undetected).
    """
    q = ex.question
    if q.kind in ("guided_steps", "graphic_text_integration"):
        verdicts = [_step_verdict(s, ex.needs_review) for s in q.steps]
        if "fail" in verdicts:
            return "fail"
        if not _block_answer_matches_steps(ex):
            return "fail"  # block `answer` drifted from its per-step answers
        if all(v == "soft" for v in verdicts):
            return "soft"
        return "partial"  # >=1 machine step verified + at least one soft step
    if ex.grader in (Grader.RUBRIC_AI, Grader.MANUAL):
        return "soft"
    return "ok" if grade(ex, ex.answer) else "fail"


# ═══════════════════════════════════════════════════════════════════════════
#  (3) Coverage report — per-lesson 紅綠燈
# ═══════════════════════════════════════════════════════════════════════════

_ALL_KINDS = [
    "multiple_choice",
    "fill_in_blank",
    "ordering",
    "trait_inference",
    "guided_steps",
    "graphic_text_integration",
    "keypoints_table",
    "custom",
]


def lesson_coverage(lesson: Lesson) -> dict[str, Any]:
    exercises = [b for b in lesson.blocks if isinstance(b, ExerciseBlock)]
    kinds = {b.question.kind for b in exercises}
    rt = [answer_round_trip(b) for b in exercises]
    return {
        "lesson_code": lesson.lesson_code,
        "n_blocks": len(lesson.blocks),
        "n_exercises": len(exercises),
        "kinds": kinds,
        "all_anchored": all(b.anchors for b in exercises) if exercises else True,
        "n_needs_review": sum(1 for b in exercises if b.needs_review),
        "round_trip_ok": sum(1 for r in rt if r == "ok"),
        "round_trip_soft": sum(1 for r in rt if r == "soft"),
        "round_trip_partial": sum(1 for r in rt if r == "partial"),
        "round_trip_fail": sum(1 for r in rt if r == "fail"),
    }


def _light(ok: bool) -> str:
    return "🟢" if ok else "🔴"


def print_console_report(covs: list[dict[str, Any]]) -> None:
    print("\nCOVERAGE REPORT (紅綠燈) — block-based Lesson contract\n")
    header = f"{'lesson':<10} {'blk':>3} {'ex':>3} {'anchors':>8} {'verifiable':>11} {'review':>7}  types"
    print(header)
    print("-" * len(header))
    for c in covs:
        verifiable = _light(c["round_trip_fail"] == 0)
        anchors = _light(c["all_anchored"])
        types = ",".join(sorted(c["kinds"]))
        print(
            f"{c['lesson_code']:<10} {c['n_blocks']:>3} {c['n_exercises']:>3} "
            f"{anchors:>7} {verifiable:>10} {c['n_needs_review']:>7}  {types}"
        )
    print("\nType coverage across corpus:")
    seen = set().union(*(c["kinds"] for c in covs)) if covs else set()
    for k in _ALL_KINDS:
        print(f"  {_light(k in seen)} {k}")


def markdown_report(covs: list[dict[str, Any]]) -> str:
    lines = [
        "| lesson | blocks | exercises | anchors | answer-verifiable | needs_review | types |",
        "|---|---|---|---|---|---|---|",
    ]
    for c in covs:
        lines.append(
            f"| {c['lesson_code']} | {c['n_blocks']} | {c['n_exercises']} | "
            f"{_light(c['all_anchored'])} | {_light(c['round_trip_fail'] == 0)} "
            f"({c['round_trip_ok']} exact / {c['round_trip_partial']} partial / "
            f"{c['round_trip_soft']} rubric) | "
            f"{c['n_needs_review']} | {', '.join(sorted(c['kinds']))} |"
        )
    seen = set().union(*(c["kinds"] for c in covs)) if covs else set()
    lines.append("")
    lines.append("**Question-type coverage:** " + " ".join(
        f"{_light(k in seen)}{k}" for k in _ALL_KINDS
    ))
    return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════
#  Golden snapshot (§3.2) — freeze normalized JSON, diff on change
# ═══════════════════════════════════════════════════════════════════════════


def normalized_json(lesson: Lesson) -> str:
    """Canonical JSON for snapshotting: model dump, enum values, sorted keys."""
    return json.dumps(
        lesson.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        indent=2,
    )


def golden_path(src: Path) -> Path:
    return GOLDEN_DIR / (src.stem + ".golden.json")


def freeze_golden(src: Path, lesson: Lesson) -> None:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    golden_path(src).write_text(normalized_json(lesson) + "\n", encoding="utf-8")


def check_golden(src: Path, lesson: Lesson) -> tuple[bool, str]:
    gp = golden_path(src)
    if not gp.exists():
        return False, f"no golden snapshot for {src.name} (run --freeze-golden)"
    current = normalized_json(lesson) + "\n"
    frozen = gp.read_text(encoding="utf-8")
    if current == frozen:
        return True, ""
    return False, (
        f"golden drift in {src.name}: normalized content changed vs approved snapshot "
        f"({gp.name}). Re-approve intentionally with --freeze-golden."
    )


# ═══════════════════════════════════════════════════════════════════════════
#  CLI
# ═══════════════════════════════════════════════════════════════════════════


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="*", help="lesson YAML files")
    ap.add_argument("--fixtures", action="store_true", help="use bundled fixtures")
    ap.add_argument("--markdown", action="store_true", help="emit markdown coverage table")
    ap.add_argument("--freeze-golden", action="store_true", help="(re)write golden snapshots")
    ap.add_argument("--check-golden", action="store_true", help="diff vs golden snapshots")
    args = ap.parse_args()

    targets = discover([Path(p) for p in args.paths], args.fixtures)
    if not targets:
        ap.error("no lesson files (pass paths or --fixtures)")

    covs: list[dict[str, Any]] = []
    any_fail = False

    for src in targets:
        try:
            lesson = load_lesson(src)
        except ValidationError as e:
            any_fail = True
            print(f"🔴 SCHEMA FAIL {src.name}: {e.error_count()} error(s)")
            continue

        # round-trip
        for b in lesson.blocks:
            if isinstance(b, ExerciseBlock) and answer_round_trip(b) == "fail":
                any_fail = True
                print(f"🔴 ROUND-TRIP FAIL {src.name}: exercise '{b.id}' cannot re-grade its own answer")

        if args.freeze_golden:
            freeze_golden(src, lesson)
            print(f"froze golden: {golden_path(src).name}")
        if args.check_golden:
            ok, msg = check_golden(src, lesson)
            if not ok:
                any_fail = True
                print(f"🔴 {msg}")

        covs.append(lesson_coverage(lesson))

    if args.markdown:
        print(markdown_report(covs))
    else:
        print_console_report(covs)

    print()
    if any_fail:
        print("RESULT: FAIL")
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
