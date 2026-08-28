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


# ── 具名清單漂移（#2925 收尾補）──────────────────────────────────────────
#
# 另一種「門在但沒跑」：具名清單裡列了一個**不存在的檔**。
#
#   pytest  → 報錯，會被看到
#   vitest  → **靜默跳過**，只印它有對到的檔然後 exit 0
#
# frontend-checks.yml 自己的註解就寫著這件事。所以清單裡一旦打錯路徑
# （改名、搬檔、手滑），那條鎖就從此不跑，而檢查是綠的。

def _named_paths(text, prefix):
    return sorted({m for m in re.findall(prefix + r'[A-Za-z0-9_@./-]+\.(?:py|tsx?|ts)', text)})


def test_every_backend_test_named_in_ci_exists():
    wf = (_REPO / ".github" / "workflows" / "pytest.yml").read_text(encoding="utf-8")
    named = [p for p in _named_paths(wf, r"tests/") if "*" not in p]
    missing = [p for p in named if not (_REPO / "backend" / p).exists()]
    assert named, "pytest.yml 裡一個具名測試都沒抓到 —— 解析壞了"
    assert len(named) >= 40, f"只抓到 {len(named)} 支，解析可能壞了"
    assert not missing, (
        f"pytest.yml 具名清單列了不存在的檔: {missing}\n"
        "pytest 會報錯所以看得到，但清單本身應該保持乾淨。")


def test_every_frontend_test_named_in_ci_exists():
    """⭐ 這條比上面那條重要 —— vitest 對不存在的路徑是**靜默跳過**。"""
    wf = (_REPO / ".github" / "workflows" / "frontend-checks.yml").read_text(encoding="utf-8")
    named = [p for p in _named_paths(wf, r"src/") if "*" not in p]
    missing = [p for p in named if not (_REPO / "frontend" / p).exists()]
    assert len(named) >= 40, f"只抓到 {len(named)} 支，解析可能壞了"
    assert not missing, (
        f"frontend-checks.yml 具名清單列了不存在的檔: {missing}\n"
        "vitest 不會報錯，它只會跑它對得到的、然後 exit 0 —— "
        "那條鎖從此不跑，而檢查是綠的。")

