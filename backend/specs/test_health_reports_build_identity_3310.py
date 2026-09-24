"""#3310 — /api/health must say which commit it was built from.

Why this lock exists
--------------------
The only valid test of "is this deploy live?" is whether the revision serving
100% of traffic runs the image built from this commit.  Cloud Run makes that
easy to get wrong: a service that has ever been pinned with
`update-traffic --to-revisions=<rev>=100` silently stops moving traffic on
later deploys, and health 200 / Ready=True / the `services describe` image
field all keep looking correct while users get old code.

⚠️ CI already asserts this at deploy time (#3162, the "Assert serving <svc>
revision runs this build" steps).  What `sha` on the health payload adds is the
*later* check: what is live right now, days after the deploy, from anything
that can make an HTTP request.  That check previously needed gcloud, so it was
unavailable exactly when the token had expired — which happened on 2026-09-24
while verifying #3299.

Two things are locked here, because either one alone is useless:
  1. the endpoint actually reports it, and reports None rather than crashing
     when there is no build (local dev, tests)
  2. EVERY workflow that deploys the backend injects BUILD_SHA *on the
     backend's own deploy step* — a SHA that only reaches prod leaves staging
     and preview unverifiable, and a SHA that lands on the frontend's step
     reaches the wrong container
"""
from __future__ import annotations

import importlib
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO / ".github" / "workflows"
# Two accepted forms, and the difference is load-bearing.
#
# `push` events (prod, staging): `github.sha` IS the pushed commit, so
# `curl .sha` == `git rev-parse HEAD` works.
#
# `pull_request` events (preview): `github.sha` is the **merge commit** GitHub
# synthesises from head+base — verified on PR #3314, which reported
# "Merge <head> into <base>".  That SHA is not in anyone's local clone, and it
# changes whenever the base branch moves even though the branch did not.  Using
# it would make the check fail on a preview that is perfectly up to date — a
# false FAIL, which is every bit as harmful as a false PASS.  So preview must
# inject `github.event.pull_request.head.sha` instead.
#
# The lock accepts either, because what must hold is "a commit identity is
# injected", not "this exact string".  Pinning one literal would have forced
# the wrong expression onto preview.
INJECTION_RE = re.compile(
    r"BUILD_SHA=\$\{\{ github\.(?:sha|event\.pull_request\.head\.sha) \}\}"
)
ENV_FLAGS = ("set-env-vars", "update-env-vars")
BACKEND_DEPLOY = re.compile(r"run deploy \$\{\{ env\.BACKEND_SERVICE \}\}")
STEP_START = re.compile(r"^\s*- name:")


# ─────────────────────────── endpoint behaviour ───────────────────────────

def _reload_health(monkeypatch, value: str | None):
    """Re-import the module so the module-level constant re-reads the env.

    ⚠️ `importlib.reload` mutates the module's existing globals dict, so this
    is process-wide, not test-local: `app.main` imported the same module at
    startup and shares that dict.  The three tests below therefore reset to the
    unset state explicitly at the end rather than relying on whichever one
    happens to run last — an implicit reset breaks the day someone reorders
    them or runs with pytest-randomly.
    """
    if value is None:
        monkeypatch.delenv("BUILD_SHA", raising=False)
    else:
        monkeypatch.setenv("BUILD_SHA", value)
    import app.routes.health as health
    return importlib.reload(health)


def _reset_health(monkeypatch) -> None:
    monkeypatch.delenv("BUILD_SHA", raising=False)
    import app.routes.health as health
    importlib.reload(health)


# Deliberately NOT a 40-char hex string.  The endpoint does no format handling
# (`os.getenv(...) or None`), so a realistic SHA would prove nothing extra — and
# a 40-char hex literal trips the repo's secret scanner as an Azure/CircleCI/LINE
# token.  Removing the cause beats bypassing the scanner on every commit.
FAKE_SHA = "test-build-sha"


def test_health_reports_the_build_sha_when_deployed(monkeypatch) -> None:
    try:
        health = _reload_health(monkeypatch, FAKE_SHA)
        body = health.health_liveness()
        assert body["sha"] == FAKE_SHA, "the value must pass through verbatim"
        assert body["status"] == "ok"
    finally:
        _reset_health(monkeypatch)


def test_health_stays_ok_with_no_build_sha(monkeypatch) -> None:
    """Fail-open: no build identity must never turn liveness into a failure.

    Not a tautology — this asserts a *choice*.  Raising, or returning "unknown"
    as a string, or dropping the key would each break a caller that compares
    `sha` against a commit; None is the one value that reads as "don't know".
    """
    health = _reload_health(monkeypatch, None)
    body = health.health_liveness()
    assert body["status"] == "ok"
    assert "sha" in body, "the key must be present even when unknown"
    assert body["sha"] is None


def test_empty_build_sha_is_treated_as_unknown_not_empty_string(monkeypatch) -> None:
    """An empty env var is a misconfigured deploy, not a commit named "". """
    try:
        health = _reload_health(monkeypatch, "")
        assert health.health_liveness()["sha"] is None
    finally:
        _reset_health(monkeypatch)


# ──────────────────── every backend deploy injects it ────────────────────

def _workflows_deploying_backend() -> list[Path]:
    """Workflows that run a Cloud Run deploy for a backend service.

    Discovered from disk, not hardcoded: a new deploy workflow added later must
    be caught too.  Hardcoding the three known files would let a fourth ship
    without the SHA while this test stayed green.
    """
    out = []
    for p in sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml")):
        text = p.read_text(encoding="utf-8")
        if "run deploy" in text and re.search(r"lingoleap-backend", text):
            out.append(p)
    return out


def _backend_deploy_step_lines(text: str) -> list[str] | None:
    """The lines of the step that deploys the BACKEND service, or None.

    Scoped deliberately.  An earlier version of this lock checked the whole
    file, which was only safe by accident: the frontend deploy steps happen to
    carry no env-var flag today, so the single flag line in each file was
    necessarily the backend's.  The moment someone adds an env var to the
    frontend deploy, the SHA could sit on the FRONTEND's flag and both of the
    checks below would stay green while the backend container got nothing —
    the exact failure this file exists to prevent.  Found by adversarial
    review, not by me.
    """
    lines = text.splitlines()
    starts = [i for i, l in enumerate(lines) if STEP_START.match(l)]
    for idx, start in enumerate(starts):
        end = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
        block = lines[start:end]
        if any(BACKEND_DEPLOY.search(l) for l in block):
            return block
    return None


def test_every_backend_deploy_workflow_injects_build_sha() -> None:
    files = _workflows_deploying_backend()

    # Positive control: an empty discovery makes "no violations" meaningless.
    assert len(files) >= 3, (
        f"expected at least 3 backend deploy workflows (prod/staging/preview), "
        f"found {[p.name for p in files]} — discovery broken?"
    )

    missing = []
    for p in files:
        block = _backend_deploy_step_lines(p.read_text(encoding="utf-8"))
        if block is None:
            missing.append(f"{p.name} (no backend deploy step found — scoping broken?)")
        elif not any(INJECTION_RE.search(l) for l in block):
            missing.append(p.name)

    assert not missing, (
        f"{missing} deploy the backend without injecting BUILD_SHA from a github "
        f"commit expression on the backend's own deploy step.  A SHA that only "
        f"reaches prod leaves those environments unverifiable; one that lands on "
        f"the frontend step reaches the wrong container — see #3310."
    )


def test_injection_rides_on_the_env_var_flag_not_a_stray_comment() -> None:
    """The string must sit on an env-var flag *inside the backend deploy step*.

    Those deploys pass the whole env set at once, replacing whatever was there,
    so BUILD_SHA appearing elsewhere in the YAML (a comment, an unrelated `env:`
    block, another service's step) would not put it on the backend container.
    Checked per step for the same reason the #3299 lock checks per dict rather
    than per file.
    """
    for p in _workflows_deploying_backend():
        block = _backend_deploy_step_lines(p.read_text(encoding="utf-8"))
        assert block is not None, f"{p.name}: backend deploy step not found"
        on_a_flag = any(
            INJECTION_RE.search(line) and any(f in line for f in ENV_FLAGS)
            for line in block
        )
        assert on_a_flag, (
            f"{p.name}: the BUILD_SHA injection is not on an env-var flag within "
            f"the backend deploy step, so it never reaches the backend container"
        )

def test_preview_uses_the_head_sha_not_the_merge_commit() -> None:
    """Preview must report the branch head, not GitHub's synthetic merge commit.

    Verified on PR #3314: the preview reported
    `eca9ed363`, which `git log` resolves to
    "Merge bd74fdd96... into 9c2657c36..." — a commit that exists only in
    GitHub's refs.  Nobody can compare that against their local HEAD, and it
    moves when the base branch moves, so `github.sha` on a pull_request event
    turns the health check into a false-FAIL generator.

    Caught by actually curling the preview, not by reading the green check.
    """
    preview = WORKFLOWS / "preview-deploy.yml"
    block = _backend_deploy_step_lines(preview.read_text(encoding="utf-8"))
    assert block is not None, "preview backend deploy step not found"
    line = next((l for l in block if "BUILD_SHA=" in l), None)
    assert line is not None, "preview does not inject BUILD_SHA at all"
    assert "github.event.pull_request.head.sha" in line, (
        "preview-deploy.yml must inject github.event.pull_request.head.sha; "
        "github.sha on a pull_request event is the merge commit, which no one "
        "can verify locally — see #3310"
    )
    assert "BUILD_SHA=${{ github.sha }}" not in line
