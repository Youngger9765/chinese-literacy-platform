"""PR gate "學生走得完嗎（multi-text journey on preview）" must actually run
against the PR's own preview, behind IAP, and must not report a broken
environment as "the PR broke the student journey".

Two real causes, both seen in CI logs:

  A. Since IAP went on for every preview (#3733, 2026-11-16) the job's `if:`
     had `needs.deploy-preview.outputs.iap_enabled != 'true'`, so it was
     SKIPPED on every PR (e.g. run 44098736089) -- the gate silently vanished.

  B. Every red it ever showed in the week before was a Dependabot PR
     (15/15 failures 2026-11-12..14, 0 failures on human PRs): Dependabot
     runs get no Actions secrets ("Secret source: Dependabot", and the
     Dependabot secret store is empty), so the preview frontend is built with
     empty VITE_DEMO_STUDENT_* and the one-click login never leaves /login
     (multiTextJourney.spec.ts:129 waitForURL timeout, run 43243744665).
     That is an INVALID environment, not a FAIL.

Fix follows #4097/#4098 (e2e-tests.yml) exactly: the CI SA signs a
self-signed IAP JWT for "<frontend>/*" on the host via scripts/lib/
iap-token.sh, and npm ci + Playwright run inside the digest-pinned official
Playwright image that receives only the variables it needs -- never the
GitHub OIDC request variables or the workspace root (gha-creds-*.json).

Same harness style as test_e2e_iap_wiring_4097.py: each step's `run:` is
rendered and EXECUTED with fake gcloud/curl/docker on PATH.
"""
from __future__ import annotations

import json
import re
import stat
import subprocess
import tempfile
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]
PREVIEW_WF = REPO / ".github" / "workflows" / "preview-deploy.yml"
E2E_WF = REPO / ".github" / "workflows" / "e2e-tests.yml"
LOCKFILE = REPO / "frontend" / "package-lock.json"

FE = "https://lingoleap-frontend-issue-9999-958347263320.asia-east1.run.app"
BE = "https://lingoleap-backend-issue-9999-958347263320.asia-east1.run.app"
CI_SA = "github-actions@lingoleap-dev.iam.gserviceaccount.com"
FAKE_JWT = "eyFAKE.header.sig"
JOB = "e2e-preview-check"


def _job() -> dict:
    return yaml.safe_load(PREVIEW_WF.read_text(encoding="utf-8"))["jobs"][JOB]


def _step(name_part: str) -> dict:
    hits = [s for s in _job()["steps"] if name_part in str(s.get("name", ""))]
    assert len(hits) == 1, f"expected 1 step named ~{name_part!r}, got {len(hits)}"
    return hits[0]


def _run_step() -> dict:
    hits = [s for s in _job()["steps"] if "docker run" in str(s.get("run", ""))]
    assert len(hits) == 1, f"expected exactly 1 docker-run step in {JOB}, got {len(hits)}"
    return hits[0]


_EXPR = re.compile(r"\$\{\{\s*(.*?)\s*\}\}")


def _render(script: str, ctx: dict[str, str]) -> str:
    return _EXPR.sub(lambda m: ctx.get(m.group(1), ""), script)


def _ctx(iap: bool = True) -> dict[str, str]:
    return {
        "needs.deploy-preview.outputs.frontend_url": FE,
        "needs.deploy-preview.outputs.backend_url": BE,
        "needs.deploy-preview.outputs.iap_enabled": "true" if iap else "false",
        "github.event.pull_request.head.sha": "abc123",
        "secrets.DEMO_STUDENT_EMAIL": "student@example.com",
        "secrets.DEMO_STUDENT_PW": "demo1234",
    }


_FAKE_GCLOUD = r"""#!/bin/bash
echo "gcloud $*" >> "$CALLS"
case "$*" in
  *sign-jwt*)
    [ -n "${FAKE_SIGN_FAIL:-}" ] && exit 1
    cp "$4" "$CALLS.claims"
    printf '%s' "$FAKE_JWT" > "$5" ;;
esac
exit 0
"""

_FAKE_LOGGER = r"""#!/bin/bash
printf '%s' "$(basename "$0")" >> "$CALLS"
for a in "$@"; do printf ' %s' "$a" >> "$CALLS"; done
echo >> "$CALLS"
case "$(basename "$0")" in
  curl)
    case "$*" in
      *Proxy-Authorization*) echo 200 ;;
      *) echo 302 ;;
    esac ;;
  docker)
    prev=""
    for a in "$@"; do
      if [ "$prev" = "-e" ] || [ "$prev" = "--env" ]; then
        name="${a%%=*}"
        echo "ENV $name=${!name:-}" >> "$CALLS"
      fi
      prev="$a"
    done ;;
esac
exit 0
"""

_FAKE_PYTHON = "#!/bin/bash\nexit 1\n"  # runners have no google-auth -> gcloud path


def _run(step: dict, ctx: dict[str, str],
         extra_env: dict[str, str] | None = None) -> tuple[int, list[str], str, str, str]:
    script = _render(str(step["run"]), ctx)
    with tempfile.TemporaryDirectory() as tmp:
        bindir = Path(tmp) / "bin"
        bindir.mkdir()
        for name, body in (("gcloud", _FAKE_GCLOUD), ("curl", _FAKE_LOGGER),
                           ("docker", _FAKE_LOGGER), ("sleep", _FAKE_LOGGER),
                           ("python3", _FAKE_PYTHON)):
            p = bindir / name
            p.write_text(body)
            p.chmod(p.stat().st_mode | stat.S_IEXEC)
        calls = Path(tmp) / "calls.txt"
        calls.write_text("")
        gh_out = Path(tmp) / "gh_out"
        gh_out.write_text("")
        env = {
            "PATH": f"{bindir}:/usr/bin:/bin",
            "CALLS": str(calls),
            "HOME": tmp,
            "FAKE_JWT": FAKE_JWT,
            "GITHUB_WORKSPACE": str(REPO),
            "GITHUB_OUTPUT": str(gh_out),
            "GITHUB_STEP_SUMMARY": str(Path(tmp) / "summary"),
            "ACTIONS_ID_TOKEN_REQUEST_URL": "https://oidc.example/req",
            "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "oidc-request-secret",
            "GOOGLE_APPLICATION_CREDENTIALS": str(REPO / "gha-creds-x.json"),
        }
        for k, v in (step.get("env") or {}).items():
            env[k] = _render(str(v), ctx)
        env.update(extra_env or {})
        proc = subprocess.run(
            ["bash", "-e", "-o", "pipefail", "-c", script],
            cwd=REPO / str(step.get("working-directory", ".")),
            env=env, capture_output=True, text=True, timeout=60,
        )
        recorded = [line for line in calls.read_text().splitlines() if line]
        claims_file = Path(str(calls) + ".claims")
        claims = claims_file.read_text() if claims_file.exists() else ""
        return proc.returncode, recorded, claims, proc.stdout + proc.stderr, gh_out.read_text()


def _docker_call(calls: list[str]) -> str:
    runs = [c for c in calls if c.startswith("docker run ")]
    assert len(runs) == 1, calls
    return runs[0]


def _passed_env(calls: list[str]) -> dict[str, str]:
    return dict(c[4:].split("=", 1) for c in calls if c.startswith("ENV "))


# ── A: the gate must run on IAP-locked previews ─────────────────────────


def test_job_is_not_skipped_when_preview_is_behind_iap():
    cond = str(_job().get("if", ""))
    assert "iap_enabled" not in cond, (
        "IAP is on for every preview since #3733 -- gating on iap_enabled != 'true' "
        "skips the student-journey gate on every PR"
    )
    # the empty-URL guards (test_preview_guards_reject_empty_urls) stay
    for out in ("frontend_url", "backend_url"):
        assert f"needs.deploy-preview.outputs.{out} != 'N/A'" in cond, cond
        assert f"needs.deploy-preview.outputs.{out} != ''" in cond, cond


def test_job_can_sign_an_iap_jwt():
    job = _job()
    assert job.get("permissions") == {"contents": "read", "id-token": "write"}, job.get("permissions")
    steps = job["steps"]
    auth = [i for i, s in enumerate(steps) if "google-github-actions/auth@" in str(s.get("uses", ""))]
    assert len(auth) == 1, "needs exactly one WIF auth step to sign the IAP JWT"
    assert steps[auth[0]]["with"]["service_account"] == CI_SA
    assert auth[0] < steps.index(_run_step())


def test_runs_through_iap_with_token_for_every_preview_path():
    rc, calls, claims, out, _ = _run(_run_step(), _ctx(iap=True))
    assert rc == 0, out
    c = json.loads(claims)
    assert c["aud"] == FE + "/*", "bare URL only authorises '/' (run 43935544444)"
    assert c["iss"] == CI_SA
    passed = _passed_env(calls)
    assert passed.get("IAP_PROXY_TOKEN") == FAKE_JWT, passed
    assert passed.get("PLAYWRIGHT_BASE_URL") == FE, passed
    assert passed.get("E2E_BACKEND_URL") == FE, (
        "backend is run.invoker-locked; API must go through the frontend's /api proxy"
    )
    assert passed.get("E2E_ONLY_LESSONS") == "20063", passed
    assert passed.get("E2E_EXPECT_DEPLOYED") == "1", passed
    docker = _docker_call(calls)
    assert FAKE_JWT not in docker, "token must not be on the docker argv"
    assert "multiTextJourney.spec.ts" in docker, docker
    curls = [x for x in calls if x.startswith("curl ")]
    assert any(f"{FE}/login" in x and f"Proxy-Authorization: Bearer {FAKE_JWT}" in x for x in curls), (
        "must prove the token opens a sub-path before spending minutes in Playwright"
    )
    lines = out.splitlines()
    assert f"::add-mask::{FAKE_JWT}" in lines
    assert not [l for l in lines if FAKE_JWT in l and not l.startswith("::add-mask::")]


def test_cannot_sign_is_a_hard_error_not_an_anonymous_run():
    rc, calls, _, _, _ = _run(_run_step(), _ctx(iap=True), extra_env={"FAKE_SIGN_FAIL": "1"})
    assert rc != 0
    assert not [c for c in calls if c.startswith("docker run ")], calls


def test_iap_off_keeps_the_direct_backend_and_no_token():
    rc, calls, claims, out, _ = _run(_run_step(), _ctx(iap=False))
    assert rc == 0, out
    assert claims == "", "nothing to sign when the preview is not behind IAP"
    passed = _passed_env(calls)
    assert passed.get("IAP_PROXY_TOKEN", "") == ""
    assert passed.get("E2E_BACKEND_URL") == BE, passed


def test_container_gets_no_gcp_or_oidc_credentials():
    rc, calls, _, out, _ = _run(_run_step(), _ctx(iap=True))
    assert rc == 0, out
    docker = _docker_call(calls)
    for forbidden in ("ACTIONS_ID_TOKEN", "ACTIONS_RUNTIME", "GOOGLE_APPLICATION_CREDENTIALS",
                      "CLOUDSDK", "GOOGLE_GHA_CREDS", "--env-file", "docker.sock", "-e ALL"):
        assert forbidden not in docker, f"{forbidden} reaches the container: {docker}"
    mounts = re.findall(r"(?:-v|--volume) (\S+)", docker)
    assert mounts, docker
    for m in mounts:
        assert Path(m.split(":", 1)[0]).resolve() == (REPO / "frontend").resolve(), m


def test_no_third_party_code_on_the_credentialed_host():
    pat = re.compile(r"\b(npm|npx|playwright)\b")
    for s in _job()["steps"]:
        assert "setup-node" not in str(s.get("uses", ""))
        run = s.get("run")
        if not isinstance(run, str) or not pat.search(run):
            continue
        assert "docker run" in run, f"{s.get('name')} runs npm on the host"
        assert not pat.search(run.split("docker run", 1)[0]), "npm/npx only inside `docker run`"


def test_image_is_the_same_pinned_playwright_image_as_staging_e2e():
    m = re.search(r"mcr\.microsoft\.com/playwright:v([\d.]+)-\w+@sha256:[0-9a-f]{64}", str(_run_step()["run"]))
    assert m, "official Playwright image pinned by tag AND digest"
    lock = json.loads(LOCKFILE.read_text(encoding="utf-8"))
    assert m.group(1) == lock["packages"]["node_modules/@playwright/test"]["version"]
    assert m.group(0) in E2E_WF.read_text(encoding="utf-8"), "keep one image for both E2E jobs"


# ── B: a preview without demo credentials is INVALID, not FAIL ──────────


def test_no_demo_credentials_is_reported_invalid_and_skips_the_run():
    step = _step("環境合格")
    ctx = _ctx()
    ctx["secrets.DEMO_STUDENT_EMAIL"] = ""
    ctx["secrets.DEMO_STUDENT_PW"] = ""
    rc, _, _, out, gh_out = _run(step, ctx)
    assert rc == 0, out
    assert "valid=false" in gh_out
    assert "INVALID" in out and "Dependabot" in out, out
    for s in _job()["steps"]:
        if s.get("id") == "env-check" or "actions/checkout" in str(s.get("uses", "")):
            continue
        assert "steps.env-check.outputs.valid == 'true'" in str(s.get("if", "")), (
            f"{s.get('name') or s.get('uses')} must not run on an INVALID environment"
        )


def test_with_demo_credentials_the_environment_is_valid_and_nothing_leaks():
    rc, _, _, out, gh_out = _run(_step("環境合格"), _ctx())
    assert rc == 0, out
    assert "valid=true" in gh_out
    assert "demo1234" not in out and "student@example.com" not in out
