"""Spec: a CI gate must be able to run in CI (#2746).

`curriculum-drift-check.yml` ran on every PR touching `backend/data/lessons/**` and
weekly on cron. Its first step read `INGESTION_MANIFEST.yml` for a `source_dir` under
`private/curriculum-source/` — a gitignored symlink that is never in a runner — did not
find it, set `skip=true`, and the job reported ✅. Eight consecutive runs took that
branch. A gate whose precondition can never hold does not report "I could not check";
it reports success, which is the one answer it has no right to give.

This scans the workflows for that shape at authoring time: a job that depends on
something the repository does not contain cannot be a gate, whatever it prints.

The check is on the *workflow* files rather than on run history because history is only
available after the damage — and because the fix has to survive someone re-adding the
same idea later.
"""

import re
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_WORKFLOWS = _REPO / ".github" / "workflows"

if str(_REPO / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO / "backend"))

# Paths a runner never has: gitignored, or deleted with the first edition. A workflow
# step that reads one of these is deciding its own verdict from something absent.
ABSENT_IN_RUNNER = (
    "private/curriculum-source",
    "private/.env",
    "INGESTION_MANIFEST.yml",
    "check_curriculum_drift.py",
    "_parsed_2026-05-01",
    "_online-schema",
)

# `skip=true` written into GITHUB_OUTPUT, then guarded with `if: ... != 'true'`. The
# shape is not wrong by itself — skipping a deploy on a docs-only change is fine. It is
# wrong when what is skipped is the check the job exists to perform.
_SKIP_FLAG = re.compile(r"skip\s*=\s*true", re.IGNORECASE)


def _workflow_files():
    return sorted(_WORKFLOWS.glob("*.yml")) + sorted(_WORKFLOWS.glob("*.yaml"))


def _executable_text(path: Path) -> str:
    """The workflow with comment lines removed.

    Scanning the raw file flagged `keypoints-manifest-gate.yml` for the line
    「CI-safe — no private/curriculum-source required」 — a comment saying the opposite
    of what the rule is looking for. A check that fires on a correct file is a check
    people learn to ignore, so comments are dropped before matching.
    """
    return "\n".join(
        line for line in path.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("#")
    )


def test_the_workflow_directory_is_where_it_is_expected():
    """Positive control. Without it, every assertion below passes on an empty list —
    which is exactly how this class of gate goes quiet in the first place."""
    files = _workflow_files()
    assert len(files) >= 3, f"only {len(files)} workflow files found under {_WORKFLOWS}"


def test_no_gate_decides_its_verdict_from_something_the_runner_lacks():
    offenders = []
    for path in _workflow_files():
        text = _executable_text(path)
        hits = [needle for needle in ABSENT_IN_RUNNER if needle in text]
        if hits:
            offenders.append((path.name, hits))
    assert offenders == [], (
        "workflows reading paths a runner never has — they can only skip and report "
        f"success: {offenders}"
    )


def test_no_workflow_skips_itself_into_a_green_tick():
    """Narrower than the rule above and aimed at the same failure: a job that writes
    `skip=true` because a precondition is missing, then finishes successfully. If a
    precondition genuinely cannot hold, the honest exit is a failure or a removed
    workflow — not a tick that reads as "checked, and fine"."""
    offenders = []
    for path in _workflow_files():
        text = _executable_text(path)
        if not _SKIP_FLAG.search(text):
            continue
        if any(needle in text for needle in ABSENT_IN_RUNNER):
            offenders.append(path.name)
    assert offenders == [], f"workflows that skip on an absent precondition and pass: {offenders}"
