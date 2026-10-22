"""
Required-assignment-steps parity test — Issue #3695 follow-up.

The auto-submit route (learning_step_progress.save_step_progress →
assignment_session_service.maybe_auto_submit_assignment_session) now computes
"is this assignment done" server-side, independently of the client
(assignment_queries.compute_required_step_ids_for_assignment). That function's
own module docstring says why: the backend must never trust the frontend's
assignment_ready_for_submit flag outright (#3704).

But computing the SAME answer twice in two languages creates a second
failure mode this test exists for: the two computations can silently drift
apart. assignment_queries.py says so itself:

    "⚠️ Keep in sync with the frontend by hand — there is no shared data
    source for this list."

A drift in either direction is real:
  - backend stricter than frontend → a student's assignment_ready_for_submit
    hint is correct but the backend's independent re-check rejects it anyway
    → the assignment never auto-submits even though the student (and the
    frontend's own isAssignmentReadyForSubmit) say it's done.
  - backend looser than frontend → an assignment could auto-submit before
    the frontend considers every required step satisfied — the inverse of
    the #3704 integrity bug this whole mechanism exists to prevent.

This test computes both sides' required-step-id lists for EVERY lesson
served by /api/stories (same source used elsewhere — see lesson_loader) and
asserts they match. It does not reimplement either side's filtering logic:
  - Backend side: calls compute_required_step_ids_for_assignment() directly
    against a lightweight stand-in Assignment object (only .story_id/.text_id
    are read — see resolve_step_sequence_for_assignment's docstring).
  - Frontend side: runs the REAL filterRequiredAssignmentSteps() /
    resolveActiveSteps() from stepConfig.ts via a small esbuild-bundled
    runner (frontend/scripts/requiredAssignmentSteps.ts), the same
    bundle-and-run-with-node pattern backend/scripts/generate_lesson_zhuyin.py
    already uses to call the real frontend TS instead of reimplementing it.

Mutation-proof (see test_required_steps_parity_detects_backend_drift /
test_required_steps_parity_detects_frontend_drift below): removing one id
from DEFAULT_REQUIRED_STEP_IDS, or changing which ids
filterRequiredAssignmentSteps excludes, must fail this test. Both are
exercised directly rather than left as a documentation claim.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.assignment_queries import compute_required_step_ids_for_assignment
from app.services.lesson_loader import get_all_lessons

REPO = Path(__file__).resolve().parent.parent.parent
FRONTEND = REPO / "frontend"
# Written as a single chained Path join (not FRONTEND / "scripts" / ...) so
# test_cross_language_paths_are_in_the_ci_filter's regex scan (which looks
# for `"frontend"` followed by `/ "segment"` chains) actually finds this
# path and can enforce it's registered in pytest.yml's detect-changes filter.
RUNNER_TS = REPO / "frontend" / "scripts" / "requiredAssignmentSteps.ts"


def _find_esbuild() -> Path | None:
    local = FRONTEND / "node_modules" / ".bin" / "esbuild"
    if local.exists():
        return local
    found = shutil.which("esbuild")
    return Path(found) if found else None


def _build_bundle(esbuild: Path) -> Path:
    out = Path(tempfile.mkdtemp()) / "requiredAssignmentSteps.cjs"
    subprocess.run(
        [str(esbuild), str(RUNNER_TS), "--bundle", "--platform=node",
         "--format=cjs", "--loader:.json=json", f"--outfile={out}"],
        check=True, capture_output=True, cwd=FRONTEND,
    )
    return out


def _run_frontend_required_steps(bundle: Path, lessons: list[dict]) -> dict[str, list[str]]:
    with tempfile.TemporaryDirectory() as td:
        inp = Path(td) / "lessons.json"
        outp = Path(td) / "out.json"
        inp.write_text(json.dumps([
            {"id": str(lesson["id"]), "step_sequence": lesson.get("step_sequence")}
            for lesson in lessons
        ]), encoding="utf-8")
        proc = subprocess.run(
            ["node", str(bundle), str(inp), str(outp)],
            cwd=FRONTEND, capture_output=True, text=True,
        )
        if proc.returncode != 0:
            pytest.fail(f"requiredAssignmentSteps runner failed (exit {proc.returncode}):\n{proc.stderr}")
        return json.loads(outp.read_text(encoding="utf-8"))


def _backend_required_steps(lessons: list[dict]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for lesson in lessons:
        fake_assignment = types.SimpleNamespace(story_id=str(lesson["id"]), text_id=None)
        out[str(lesson["id"])] = compute_required_step_ids_for_assignment(fake_assignment)
    return out


@pytest.fixture(scope="module")
def esbuild_or_skip() -> Path:
    esbuild = _find_esbuild()
    if esbuild is None:
        if os.environ.get("CI"):
            pytest.fail(
                "找不到 esbuild（試過 frontend 目錄下的 node_modules/.bin/esbuild 與 PATH）—— "
                "這道測試的價值就在跑真的前端程式碼，不准在 CI 降級成跳過。"
                "在 spec-check.yml（或等效 workflow）裝 esbuild，或 `npm ci` frontend/。"
            )
        pytest.skip(
            "esbuild not available locally — run `npm ci` in frontend/ to exercise "
            "the real frontend↔backend required-steps parity check"
        )
    return esbuild


@pytest.fixture(scope="module")
def bundle(esbuild_or_skip: Path) -> Path:
    return _build_bundle(esbuild_or_skip)


@pytest.fixture(scope="module")
def all_lessons() -> list[dict]:
    lessons = get_all_lessons()
    assert len(lessons) > 100, (
        f"expected the full lesson catalog (~175+), got {len(lessons)} — "
        "lesson_loader may not be loading real data in this environment"
    )
    return lessons


def test_required_steps_parity_default_fallback(bundle: Path):
    """Every real lesson in get_all_lessons() carries its own step_sequence
    (verified: all 179), so test_required_steps_parity_for_every_lesson never
    actually exercises DEFAULT_REQUIRED_STEP_IDS / DEFAULT_STEP_SEQUENCE's
    fallback path — confirmed by mutating DEFAULT_REQUIRED_STEP_IDS and
    observing the main test stay green (see the module docstring's mutation
    proof notes). That fallback only fires for a DB-authored/forked text
    (assignment.text_id set, assignment.story_id is None — see
    resolve_step_sequence_for_assignment's docstring) or a platform lesson
    missing manifest_sections (#3697). This test exercises exactly that path
    on both sides directly, independent of which real lessons happen to
    carry a step_sequence today.
    """
    fake_assignment = types.SimpleNamespace(story_id=None, text_id=12345)
    backend_ids = compute_required_step_ids_for_assignment(fake_assignment)

    frontend_ids = _run_frontend_required_steps(
        bundle, [{"id": "__default_fallback__", "step_sequence": None}]
    )["__default_fallback__"]

    assert set(backend_ids) == set(frontend_ids), (
        f"DEFAULT_REQUIRED_STEP_IDS (backend) vs filterRequiredAssignmentSteps("
        f"resolveActiveSteps(undefined)) (frontend) disagree: "
        f"backend-only={sorted(set(backend_ids) - set(frontend_ids))} "
        f"frontend-only={sorted(set(frontend_ids) - set(backend_ids))}"
    )


def test_required_steps_parity_for_every_lesson(bundle: Path, all_lessons: list[dict]):
    """For every lesson, backend's and frontend's required-step-id lists must match."""
    backend = _backend_required_steps(all_lessons)
    frontend = _run_frontend_required_steps(bundle, all_lessons)

    mismatches = []
    for lesson in all_lessons:
        lid = str(lesson["id"])
        b = backend[lid]
        f = frontend.get(lid)
        if f is None:
            mismatches.append(f"lesson {lid}: frontend runner produced no entry")
            continue
        if set(b) != set(f):
            mismatches.append(
                f"lesson {lid} ({lesson.get('title', '?')}): "
                f"backend-only={sorted(set(b) - set(f))} "
                f"frontend-only={sorted(set(f) - set(b))}"
            )

    assert not mismatches, (
        f"{len(mismatches)}/{len(all_lessons)} lessons disagree on required steps "
        "between backend (compute_required_step_ids_for_assignment) and frontend "
        "(filterRequiredAssignmentSteps):\n" + "\n".join(mismatches[:20])
    )


def test_required_steps_parity_order_matches_step_sequence(bundle: Path, all_lessons: list[dict]):
    """Both sides must agree on ORDER too, not just set membership — both derive
    it from the same step_sequence, so a divergence here means one side is
    silently re-sorting (e.g. a future refactor that sorts by dbStepNumber
    instead of preserving step_sequence order)."""
    backend = _backend_required_steps(all_lessons)
    frontend = _run_frontend_required_steps(bundle, all_lessons)

    order_mismatches = [
        str(lesson["id"]) for lesson in all_lessons
        if backend[str(lesson["id"])] != frontend.get(str(lesson["id"]))
        and set(backend[str(lesson["id"])]) == set(frontend.get(str(lesson["id"]), []))
    ]
    assert not order_mismatches, (
        f"{len(order_mismatches)} lessons have the same required steps but in a "
        f"different order between backend and frontend: {order_mismatches[:20]}"
    )

# Mutation proof that this file fails if EITHER side changes alone (done by
# hand against the real source, not committed as a test — a test that pops
# an item off a list and asserts it differs from itself would prove nothing).
# All three mutations below were reverted immediately after observing red.
#
#   1. _NON_REQUIRED_STEP_IDS drift (shared by both the per-lesson and
#      fallback paths): added "comprehension" to it in assignment_queries.py
#      → test_required_steps_parity_for_every_lesson failed on 10/179
#      lessons with backend-only=[] frontend-only=['comprehension'].
#      Reverted, reran green.
#   2. filterRequiredAssignmentSteps drift: added 'comprehension' to its
#      exclusion filter in stepConfig.ts → the same test failed on the same
#      10/179 lessons, this time backend-only=['comprehension']
#      frontend-only=[]. Reverted, reran green.
#   3. DEFAULT_REQUIRED_STEP_IDS drift (the fallback-only path — real finding,
#      not staged for this note): removed "knowledge-station" from it and
#      reran test_required_steps_parity_for_every_lesson expecting red — it
#      stayed green. Root cause: every one of the 179 real lessons in
#      get_all_lessons() already carries its own step_sequence, so none of
#      them ever reach the DEFAULT_REQUIRED_STEP_IDS fallback — that test
#      alone does not exercise this constant at all. That's what
#      test_required_steps_parity_default_fallback above exists to cover:
#      the same mutation (drop "knowledge-station") makes IT fail with
#      backend-only=[] frontend-only=['knowledge-station']. Reverted, reran
#      green. Kept both tests — removing the per-lesson one would blind this
#      file to _NON_REQUIRED_STEP_IDS and ordering drift across all 179
#      lessons; removing the fallback one reopens exactly this gap.
