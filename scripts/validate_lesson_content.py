#!/usr/bin/env python3
"""validate_lesson_content.py — validate block-based Lesson YAML against the contract.

Part of the 閱讀聚光燈 refactor (SPOTLIGHT_REFACTOR_PLAN.md), Phase 0 + Phase 1.

Eats one or more lesson YAML files, validates each against the pydantic contract
(backend/app/schemas/lesson_content.py), and prints a violation list. It SPECIALLY
surfaces the answer-verifiability failures (plan §2.2) — exercises whose answer is not
machine-comparable — because that is the whole point of the contract: a lesson can look
fine yet be un-gradable.

Usage:
    python3 scripts/validate_lesson_content.py <lesson.yml> [<lesson.yml> ...]
    python3 scripts/validate_lesson_content.py --fixtures      # validate all bundled fixtures
    python3 scripts/validate_lesson_content.py --dir DIR       # validate every *.lesson.yml in DIR

Exit code 0 = all valid; 1 = at least one lesson failed validation.

NOTE: run with the backend venv interpreter (it has pydantic + pyyaml), e.g.
    backend/.venv/bin/python scripts/validate_lesson_content.py --fixtures
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "backend"))

from pydantic import ValidationError  # noqa: E402

from app.schemas.lesson_content import Grader, Lesson  # noqa: E402

FIXTURE_DIR = _REPO_ROOT / "backend" / "tests" / "fixtures" / "lesson_content"


# ── camelCase → snake_case is NOT needed: fixtures are authored snake_case, matching
#    the pydantic field names + the repo's YAML convention. ──────────────────────


def validate_file(path: Path) -> tuple[bool, list[str], Lesson | None]:
    """Return (ok, violations, lesson_or_None)."""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:  # pragma: no cover - corrupt yaml is its own problem
        return False, [f"YAML parse error: {e}"], None
    if not isinstance(raw, dict):
        return False, ["top-level YAML is not a mapping"], None

    try:
        lesson = Lesson.model_validate(raw)
    except ValidationError as e:
        violations = []
        for err in e.errors():
            loc = ".".join(str(p) for p in err["loc"])
            violations.append(f"[schema] {loc}: {err['msg']}")
        return False, violations, None

    # ── Extra soft lint: surface answer-verifiability risks that pass the schema
    #    but a human should still eyeball (plan §2.2 / §3.4). These do NOT fail
    #    validation, but they ARE reported prominently.
    return True, _answer_verifiability_warnings(lesson), lesson


def _answer_verifiability_warnings(lesson: Lesson) -> list[str]:
    warnings: list[str] = []
    for b in lesson.blocks:
        if b.type != "exercise":
            continue
        if b.needs_review:
            warnings.append(
                f"[review-queue] exercise '{b.id}' ({b.question.kind}) flagged "
                f"needs_review — NOT auto-verifiable, requires human check"
            )
        if b.grader in (Grader.RUBRIC_AI, Grader.MANUAL):
            warnings.append(
                f"[soft-grade] exercise '{b.id}' ({b.question.kind}) uses "
                f"grader='{b.grader.value}' — answer present but graded by "
                f"rubric/human, not exact machine compare"
            )
    return warnings


def _coverage_line(lesson: Lesson) -> str:
    exercises = [b for b in lesson.blocks if b.type == "exercise"]
    kinds = sorted({b.question.kind for b in exercises})
    anchored = sum(1 for b in exercises if b.anchors)
    review = sum(1 for b in exercises if b.needs_review)
    return (
        f"blocks={len(lesson.blocks)} exercises={len(exercises)} "
        f"anchored={anchored}/{len(exercises)} needs_review={review} "
        f"types=[{', '.join(kinds)}]"
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="*", help="lesson YAML files")
    ap.add_argument("--fixtures", action="store_true", help="validate bundled fixtures")
    ap.add_argument("--dir", help="validate every *.lesson.yml in this directory")
    args = ap.parse_args()

    targets: list[Path] = [Path(p) for p in args.paths]
    if args.fixtures:
        targets += sorted(FIXTURE_DIR.glob("*.lesson.yml"))
    if args.dir:
        targets += sorted(Path(args.dir).glob("*.lesson.yml"))
    if not targets:
        ap.error("no lesson files given (pass paths, --fixtures, or --dir)")

    any_fail = False
    print(f"Validating {len(targets)} lesson file(s) against the content contract\n")
    for path in targets:
        ok, msgs, lesson = validate_file(path)
        status = "PASS" if ok else "FAIL"
        print(f"{status}  {path.name}")
        if lesson is not None:
            print(f"      {_coverage_line(lesson)}")
        for m in msgs:
            marker = "      · " if ok else "      ✗ "
            print(f"{marker}{m}")
        if not ok:
            any_fail = True
        print()

    print("=" * 60)
    if any_fail:
        print("RESULT: FAIL — at least one lesson violated the contract")
        return 1
    print("RESULT: PASS — all lessons satisfy the content contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
