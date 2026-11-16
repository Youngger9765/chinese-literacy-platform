"""#3733 — the remaining "actually open the door" wiring, executed for real.

These tests don't grep the YAML for strings: they pull each deploy step's
`run:` script out of the workflow, substitute the `${{ ... }}` expressions,
and EXECUTE it under bash with fake `gcloud` / `docker` / `curl` on PATH
that record their argv. So they lock what the step actually does when the
switches are on or off, not what words happen to appear in it.

What this locks (preview-deploy.yml and staging-deploy.yml):

  1. backend deploy: IAP_ENABLED=true -> `--no-allow-unauthenticated`
     (no public window between "deployed" and "locked"); false -> exactly
     today's `--allow-unauthenticated`.
  2. backend deploy: SAME_ORIGIN_PROXY_ENABLED=true -> FRONTEND_PROXY_SA +
     BACKEND_AUDIENCE set (backend/app/config.py, #3740), BACKEND_AUDIENCE
     equal to the SAME URL the sidecar asks the metadata server for.
  3. frontend deploy: proxy on -> nginx + invoker-sidecar two-container
     deploy (sidecar probe on /healthz, BACKEND_INVOKER_AUDIENCE, every
     service-level flag before the first --container); proxy off ->
     today's single-image deploy, unchanged.
  4. a sidecar image is built + pushed when (and only when) the proxy is on.
  5. CI calls to the backend carry a Cloud Run invoker ID token in
     X-Serverless-Authorization when IAP is on (google-github-actions/auth
     with token_format=id_token, audience = backend URL).
  6. frontend health check signs its IAP JWT for the frontend's own URL
     when IAP is on (not only from an unset secret).
  7. switch back off -> a step turns native IAP off on a frontend that
     still has it (otherwise "flip to false" never actually reopens it).
  8. the credential-less e2e job doesn't pretend to test a locked preview.
"""
from __future__ import annotations

import os
import re
import stat
import subprocess
import tempfile
from pathlib import Path

import pytest
import yaml

WORKFLOWS_DIR = Path(__file__).resolve().parents[2] / ".github" / "workflows"
PREVIEW_WF = WORKFLOWS_DIR / "preview-deploy.yml"
STAGING_WF = WORKFLOWS_DIR / "staging-deploy.yml"

FRONTEND_RUNTIME_SA = "lingoleap-frontend-run@lingoleap-dev.iam.gserviceaccount.com"
STAGING_BACKEND_URL = "https://lingoleap-backend-staging-958347263320.asia-east1.run.app"
STAGING_FRONTEND_URL = "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app"
PREVIEW_BACKEND_URL = "https://lingoleap-backend-issue-77-958347263320.asia-east1.run.app"
PREVIEW_FRONTEND_URL = "https://lingoleap-frontend-issue-77-958347263320.asia-east1.run.app"


# ── harness ──────────────────────────────────────────────────────────────


def _doc(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _job(path: Path, job: str) -> dict:
    return _doc(path)["jobs"][job]


def _step(path: Path, job: str, name_part: str) -> dict:
    hits = [s for s in _job(path, job)["steps"] if name_part in str(s.get("name", ""))]
    assert len(hits) == 1, f"{path.name}:{job}: expected 1 step named ~{name_part!r}, got {len(hits)}"
    return hits[0]


_EXPR = re.compile(r"\$\{\{\s*(.*?)\s*\}\}")


def _render(script: str, ctx: dict[str, str]) -> str:
    def sub(m: re.Match) -> str:
        expr = m.group(1)
        if expr in ctx:
            return ctx[expr]
        if expr.startswith("env."):
            return ctx.get(expr[4:], "")
        return "DUMMY"

    return _EXPR.sub(sub, script)


_FAKE_GCLOUD = r"""#!/bin/bash
echo "gcloud $*" >> "$CALLS"
case "$*" in
  *"services describe"*) [ -n "${FAKE_MISSING:-}" ] && exit 1 ;;
esac
case "$*" in
  *"services describe"*"status.url"*) echo "$FAKE_URL" ;;
  *"services describe"*"annotations"*) echo "${FAKE_IAP_ANNOTATION:-}" ;;
  *"get-iam-policy"*)
    if [ -n "${FAKE_IAM_POLICY:-}" ]; then echo "$FAKE_IAM_POLICY"
    else echo '{"bindings":[{"members":["allUsers"]}]}'; fi ;;
esac
exit 0
"""

_FAKE_LOGGER = r"""#!/bin/bash
echo "$(basename "$0") $*" >> "$CALLS"
case "$(basename "$0")" in
  curl)
    case "$*" in
      *backend*) echo "${FAKE_CURL_BACKEND:-200}" ;;
      *frontend*) echo "${FAKE_CURL_FRONTEND:-200}" ;;
      *) echo 200 ;;
    esac ;;
esac
exit 0
"""


def _run_step(step: dict, ctx: dict[str, str], extra_env: dict[str, str] | None = None) -> list[str]:
    """Execute a step's run script; return the recorded command lines."""
    rc, calls, out = _run_step_rc(step, ctx, extra_env)
    assert rc == 0, f"step failed rc={rc}\n{out}"
    return calls


def _run_step_rc(step: dict, ctx: dict[str, str],
                 extra_env: dict[str, str] | None = None) -> tuple[int, list[str], str]:
    """Execute a step's run script; return (exit code, recorded commands, output)."""
    script = _render(str(step["run"]), ctx)
    with tempfile.TemporaryDirectory() as tmp:
        bindir = Path(tmp) / "bin"
        bindir.mkdir()
        for name, body in (("gcloud", _FAKE_GCLOUD), ("docker", _FAKE_LOGGER),
                           ("curl", _FAKE_LOGGER), ("sleep", _FAKE_LOGGER)):
            p = bindir / name
            p.write_text(body)
            p.chmod(p.stat().st_mode | stat.S_IEXEC)
        calls = Path(tmp) / "calls.txt"
        calls.write_text("")
        env = {
            "PATH": f"{bindir}:/usr/bin:/bin",
            "CALLS": str(calls),
            "HOME": tmp,
            "GITHUB_ENV": str(Path(tmp) / "gh_env"),
            "GITHUB_OUTPUT": str(Path(tmp) / "gh_out"),
            "GITHUB_STEP_SUMMARY": str(Path(tmp) / "gh_sum"),
            "FAKE_URL": ctx.get("FAKE_URL", ""),
        }
        for k, v in (step.get("env") or {}).items():
            env[k] = _render(str(v), ctx)
        env.update(extra_env or {})
        repo_root = WORKFLOWS_DIR.parents[1]
        proc = subprocess.run(
            ["bash", "-e", "-o", "pipefail", "-c", script],
            cwd=repo_root, env=env, capture_output=True, text=True, timeout=60,
        )
        recorded = [line for line in calls.read_text().splitlines() if line]
        return proc.returncode, recorded, f"STDERR:\n{proc.stderr}\nSTDOUT:\n{proc.stdout}"


def _ctx(iap: bool, proxy: bool, preview: bool) -> dict[str, str]:
    c = {
        "IAP_ENABLED": "true" if iap else "false",
        "SAME_ORIGIN_PROXY_ENABLED": "true" if proxy else "false",
        "PROJECT_ID": "lingoleap-dev",
        "REGION": "asia-east1",
        "REGISTRY": "asia-east1-docker.pkg.dev/lingoleap-dev/lingoleap",
        "github.sha": "abc123",
        "github.event.pull_request.head.sha": "abc123",
    }
    if preview:
        c.update({
            "BACKEND_SERVICE": "lingoleap-backend-issue-77",
            "FRONTEND_SERVICE": "lingoleap-frontend-issue-77",
            "ISSUE_NUM": "77",
            "steps.backend-url.outputs.url": PREVIEW_BACKEND_URL,
            "steps.backend-url.outputs.audience": PREVIEW_BACKEND_URL,
            "steps.preview-urls.outputs.backend_url": PREVIEW_BACKEND_URL,
            "steps.preview-urls.outputs.frontend_url": PREVIEW_FRONTEND_URL,
        })
    else:
        c.update({
            "BACKEND_SERVICE": "lingoleap-backend-staging",
            "FRONTEND_SERVICE": "lingoleap-frontend-staging",
            "steps.backend-url.outputs.url": STAGING_BACKEND_URL,
        })
    return c


def _gcloud(calls: list[str], needle: str) -> list[str]:
    return [c for c in calls if c.startswith("gcloud ") and needle in c]


CASES = [
    pytest.param(PREVIEW_WF, "deploy-preview", True, id="preview"),
    pytest.param(STAGING_WF, "deploy-backend", False, id="staging"),
]
FE_CASES = [
    pytest.param(PREVIEW_WF, "deploy-preview", True, id="preview"),
    pytest.param(STAGING_WF, "deploy-frontend", False, id="staging"),
]


# ── 1 + 2: backend deploy ───────────────────────────────────────────────


@pytest.mark.parametrize("wf,job,preview", CASES)
def test_backend_deploy_locks_on_deploy_when_iap_enabled(wf, job, preview):
    step = _step(wf, job, "Deploy backend")
    calls = _run_step(step, _ctx(iap=True, proxy=True, preview=preview))
    deploys = _gcloud(calls, "run deploy")
    assert len(deploys) == 1
    assert "--no-allow-unauthenticated" in deploys[0]
    assert re.search(r"(?<!no-)--allow-unauthenticated", deploys[0]) is None


@pytest.mark.parametrize("wf,job,preview", CASES)
def test_backend_deploy_unchanged_when_iap_disabled(wf, job, preview):
    step = _step(wf, job, "Deploy backend")
    calls = _run_step(step, _ctx(iap=False, proxy=False, preview=preview))
    deploys = _gcloud(calls, "run deploy")
    assert len(deploys) == 1
    assert " --allow-unauthenticated" in deploys[0]
    assert "--no-allow-unauthenticated" not in deploys[0]
    assert "FRONTEND_PROXY_SA" not in deploys[0]
    assert "BACKEND_AUDIENCE" not in deploys[0]


@pytest.mark.parametrize("wf,job,preview", CASES)
def test_backend_trusts_frontend_proxy_identity_when_proxy_enabled(wf, job, preview):
    step = _step(wf, job, "Deploy backend")
    calls = _run_step(step, _ctx(iap=False, proxy=True, preview=preview))
    deploy = _gcloud(calls, "run deploy")[0]
    backend_url = PREVIEW_BACKEND_URL if preview else STAGING_BACKEND_URL
    assert f"FRONTEND_PROXY_SA={FRONTEND_RUNTIME_SA}" in deploy
    assert f"BACKEND_AUDIENCE={backend_url}" in deploy


# ── 3 + 4: frontend deploy ──────────────────────────────────────────────


@pytest.mark.parametrize("wf,job,preview", FE_CASES)
def test_frontend_deploys_nginx_plus_invoker_sidecar_when_proxy_enabled(wf, job, preview):
    step = _step(wf, job, "Deploy frontend")
    calls = _run_step(step, _ctx(iap=True, proxy=True, preview=preview))
    deploys = _gcloud(calls, "run deploy")
    assert len(deploys) == 1
    d = deploys[0]
    assert d.startswith("gcloud beta run deploy"), "multi-container + IAP needs the beta surface"
    assert d.count("--container=") == 2
    assert "--container=frontend" in d and "--container=sidecar" in d
    first_container = d.index("--container=")
    for svc_flag in ("--project", "--region", "--service-account", "--max-instances", "--timeout"):
        assert svc_flag in d, svc_flag
        assert d.index(svc_flag) < first_container, f"{svc_flag} must precede the first --container"
    sidecar_part = d[d.index("--container=sidecar"):]
    frontend_part = d[d.index("--container=frontend"):d.index("--container=sidecar")]
    assert "invoker-sidecar:" in sidecar_part
    backend_url = PREVIEW_BACKEND_URL if preview else STAGING_BACKEND_URL
    assert f"BACKEND_INVOKER_AUDIENCE={backend_url}" in sidecar_part
    assert "--update-env-vars" in sidecar_part and "--set-env-vars" not in sidecar_part
    assert "httpGet.path=/healthz" in sidecar_part and "httpGet.port=8081" in sidecar_part
    assert "--depends-on=sidecar" in frontend_part and "--port=8080" in frontend_part


@pytest.mark.parametrize("wf,job,preview", FE_CASES)
def test_frontend_deploy_unchanged_when_proxy_disabled(wf, job, preview):
    step = _step(wf, job, "Deploy frontend")
    calls = _run_step(step, _ctx(iap=False, proxy=False, preview=preview))
    deploys = _gcloud(calls, "run deploy")
    assert len(deploys) == 1
    assert deploys[0].startswith("gcloud run deploy ")
    assert "--container" not in deploys[0]
    assert "--image" in deploys[0] and "--allow-unauthenticated" in deploys[0]


@pytest.mark.parametrize("wf,job,preview", FE_CASES)
def test_sidecar_image_built_only_when_proxy_enabled(wf, job, preview):
    step = _step(wf, job, "invoker sidecar image")
    on = _run_step(step, _ctx(iap=True, proxy=True, preview=preview))
    builds = [c for c in on if c.startswith("docker build")]
    pushes = [c for c in on if c.startswith("docker push")]
    assert len(builds) == 1 and "scripts/invoker-sidecar/Dockerfile" in builds[0]
    assert len(pushes) == 1 and "invoker-sidecar:" in pushes[0]
    off = _run_step(step, _ctx(iap=False, proxy=False, preview=preview))
    assert not [c for c in off if c.startswith("docker ")]


# ── 5: CI → backend carries an invoker ID token ─────────────────────────


def _invoker_auth_step(wf: Path, job: str) -> dict:
    hits = [
        s for s in _job(wf, job)["steps"]
        if "google-github-actions/auth" in str(s.get("uses", ""))
        and (s.get("with") or {}).get("token_format") == "id_token"
    ]
    assert len(hits) == 1, f"{wf.name}:{job}: expected one id_token auth step, got {len(hits)}"
    return hits[0]


@pytest.mark.parametrize("wf,job,backend_expr", [
    pytest.param(PREVIEW_WF, "deploy-preview", "steps.preview-urls.outputs.backend_url", id="preview"),
    pytest.param(STAGING_WF, "deploy-backend", None, id="staging-deploy"),
    pytest.param(STAGING_WF, "smoke-test", None, id="staging-smoke"),
])
def test_ci_mints_invoker_id_token_for_backend_when_iap_enabled(wf, job, backend_expr):
    step = _invoker_auth_step(wf, job)
    cond = str(step.get("if", ""))
    assert "IAP_ENABLED" in cond and "'true'" in cond, "only mint when the lock is on"
    w = step["with"]
    assert str(w.get("id_token_include_email")).lower() == "true"
    assert str(w.get("create_credentials_file")).lower() == "false"
    aud = str(w.get("id_token_audience"))
    if backend_expr:
        assert backend_expr in aud
    else:
        assert aud == STAGING_BACKEND_URL or "STAGING_BACKEND" in aud
    job_steps = _job(wf, job)["steps"]
    assert job_steps.index(step) < len(job_steps) - 1


@pytest.mark.parametrize("wf,job,name,preview", [
    pytest.param(STAGING_WF, "deploy-backend", "Verify backend health", False, id="staging-verify"),
    pytest.param(STAGING_WF, "smoke-test", "Smoke test /api/health", False, id="staging-smoke"),
    pytest.param(PREVIEW_WF, "deploy-preview", "Warm backend", True, id="preview-warm"),
])
def test_backend_checks_send_invoker_token_in_x_serverless_authorization(wf, job, name, preview):
    step = _step(wf, job, name)
    ctx = _ctx(iap=True, proxy=True, preview=preview)
    ctx["FAKE_URL"] = PREVIEW_BACKEND_URL if preview else STAGING_BACKEND_URL
    ctx["steps.invoker.outputs.id_token"] = "tok-123"
    calls = _run_step(step, ctx, extra_env={"STAGING_BACKEND": STAGING_BACKEND_URL})
    curls = [c for c in calls if c.startswith("curl ")]
    assert curls, "the check must actually call the backend"
    for c in curls:
        assert "X-Serverless-Authorization: Bearer tok-123" in c, c
        assert "Proxy-Authorization" not in c, "backend is not behind IAP; don't send an IAP JWT there"


@pytest.mark.parametrize("wf,job,name,preview", [
    pytest.param(STAGING_WF, "deploy-backend", "Verify backend health", False, id="staging-verify"),
    pytest.param(PREVIEW_WF, "deploy-preview", "Warm backend", True, id="preview-warm"),
])
def test_backend_checks_send_no_auth_header_when_switch_off(wf, job, name, preview):
    step = _step(wf, job, name)
    ctx = _ctx(iap=False, proxy=False, preview=preview)
    ctx["FAKE_URL"] = PREVIEW_BACKEND_URL if preview else STAGING_BACKEND_URL
    ctx["steps.invoker.outputs.id_token"] = ""
    calls = _run_step(step, ctx)
    curls = [c for c in calls if c.startswith("curl ")]
    assert curls
    for c in curls:
        assert "X-Serverless-Authorization" not in c and "Proxy-Authorization" not in c


# ── 6: frontend health check targets the frontend's own URL ─────────────


@pytest.mark.parametrize("wf,job,name", [
    pytest.param(STAGING_WF, "deploy-frontend", "Verify frontend health", id="staging"),
])
def test_frontend_health_signs_iap_jwt_for_frontend_url(wf, job, name):
    step = _step(wf, job, name)
    aud = str((step.get("env") or {}).get("IAP_AUDIENCE", ""))
    assert "IAP_ENABLED" in aud and STAGING_FRONTEND_URL in aud, aud
    sa = str((step.get("env") or {}).get("IAP_SIGNING_SA_EMAIL", ""))
    assert sa.startswith("git") and sa.endswith("@lingoleap-dev.iam.gserviceaccount.com")


def test_preview_has_frontend_health_check_with_iap_jwt():
    step = _step(PREVIEW_WF, "deploy-preview", "Verify frontend preview health")
    env = step.get("env") or {}
    assert "steps.preview-urls.outputs.frontend_url" in str(env.get("IAP_AUDIENCE", ""))
    assert "IAP_ENABLED" in str(env.get("IAP_AUDIENCE", ""))
    ctx = _ctx(iap=False, proxy=False, preview=True)
    calls = _run_step(step, ctx)
    curls = [c for c in calls if c.startswith("curl ")]
    assert curls and PREVIEW_FRONTEND_URL in curls[0]


# ── 7: switching back off actually reopens the frontend ─────────────────


@pytest.mark.parametrize("wf,job,preview", FE_CASES)
def test_switch_off_turns_native_iap_off_if_still_on(wf, job, preview):
    step = _step(wf, job, "IAP_ENABLED 關")
    cond = str(step.get("if", ""))
    assert "env.IAP_ENABLED != 'true'" in cond, cond
    ctx = _ctx(iap=False, proxy=False, preview=preview)
    calls = _run_step(step, ctx, extra_env={"FAKE_IAP_ANNOTATION": "true"})
    assert _gcloud(calls, "--no-iap"), "frontend still had IAP on -> must be turned off"
    calls = _run_step(step, ctx, extra_env={"FAKE_IAP_ANNOTATION": ""})
    assert not _gcloud(calls, "--no-iap"), "no IAP on the service -> touch nothing (today's deploys)"


# ── 8: e2e job has no credentials; must not run against a locked preview ─


def test_e2e_preview_check_does_not_run_against_locked_preview():
    job = _job(PREVIEW_WF, "e2e-preview-check")
    assert "outputs.iap_enabled != 'true'" in str(job.get("if", "")), (
        "e2e-preview-check has no GCP credentials by design; with IAP on it "
        "can only ever see the Google login page"
    )


def test_switches_are_off_and_move_together():
    """2026-11-16: opened in #4083, rolled back (an existing service with a
    single unnamed container cannot be switched to the two-container deploy,
    see docs/iap-runbook.md). The two switches must stay equal."""
    for wf in (PREVIEW_WF, STAGING_WF):
        env = _doc(wf)["env"]
        assert env["IAP_ENABLED"] == "false", wf.name
        assert env["SAME_ORIGIN_PROXY_ENABLED"] == "false", wf.name


STAGING_FRONTEND_HASH_URL = "https://lingoleap-frontend-staging-oja2sffiya-de.a.run.app"


def test_staging_health_curls_the_same_host_its_iap_jwt_is_for():
    """IAP checks the JWT aud against the exact hostname requested (preview
    trial, PR #4082). The step signs for the -958347263320 URL, so it must
    curl that URL -- not status.url, which gcloud returns as the hash
    (oja2sffiya-de) host and IAP would reject with 401."""
    step = _step(STAGING_WF, "deploy-frontend", "Verify frontend health")
    ctx = _ctx(iap=True, proxy=True, preview=False)
    ctx["FAKE_URL"] = STAGING_FRONTEND_HASH_URL
    # the harness only substitutes plain names; evaluate the step's
    # IAP_ENABLED-ternary for IAP on (asserted on by the test above).
    aud_expr = _EXPR.search(str(step["env"]["IAP_AUDIENCE"])).group(1)
    assert "env.IAP_ENABLED == 'true'" in aud_expr and STAGING_FRONTEND_URL in aud_expr
    ctx[aud_expr] = STAGING_FRONTEND_URL
    calls = _run_step(step, ctx)
    curls = [c for c in calls if c.startswith("curl ")]
    assert curls, calls
    assert all(STAGING_FRONTEND_URL + "/" in c for c in curls), curls
    assert not any("oja2sffiya" in c for c in curls), curls


# ── 9: security review round (#3733) — ordering, negative check, rollback ─

_IAP_FLAG = re.compile(r"(?<![\w-])--iap(?![\w-])")
_GRANT = "add-iam-" + "policy-binding"
_REVOKE = "remove-iam-" + "policy-binding"


def _index(wf: Path, job: str, name_part: str) -> int:
    steps = _job(wf, job)["steps"]
    return steps.index(_step(wf, job, name_part))


# finding 1: with IAP on, the frontend must never serve a revision without
# IAP. `--iap` has to be on the deploy itself, not only in a later step:
# between "deploy --allow-unauthenticated" and "services update --iap" an
# anonymous user reaches nginx, whose sidecar reaches the locked backend.
@pytest.mark.parametrize("proxy", [True, False], ids=["proxy-on", "proxy-off"])
@pytest.mark.parametrize("wf,job,preview", FE_CASES)
def test_frontend_deploy_carries_iap_when_iap_enabled(wf, job, preview, proxy):
    step = _step(wf, job, "Deploy frontend")
    calls = _run_step(step, _ctx(iap=True, proxy=proxy, preview=preview))
    deploys = _gcloud(calls, "run deploy")
    assert len(deploys) == 1
    assert deploys[0].startswith("gcloud beta run deploy"), "--iap only exists on the beta surface"
    assert _IAP_FLAG.search(deploys[0]), "IAP must be on in the same call that creates the revision"


@pytest.mark.parametrize("wf,job,preview", FE_CASES)
def test_frontend_deploy_has_no_iap_flag_when_iap_disabled(wf, job, preview):
    step = _step(wf, job, "Deploy frontend")
    for proxy in (True, False):
        calls = _run_step(step, _ctx(iap=False, proxy=proxy, preview=preview))
        deploy = _gcloud(calls, "run deploy")[0]
        assert not _IAP_FLAG.search(deploy) and "--no-iap" not in deploy


# finding 2: --no-allow-unauthenticated on the backend deploy removes
# allUsers, so the frontend SA + CI SA must already hold run.invoker by then.
@pytest.mark.parametrize("wf,job,preview", CASES)
def test_invoker_grants_happen_before_backend_deploy(wf, job, preview):
    assert _index(wf, job, "deploy 前先授權") < _index(wf, job, "Deploy backend")
    step = _step(wf, job, "deploy 前先授權")
    assert "env.IAP_ENABLED == 'true'" in str(step.get("if", ""))
    calls = _run_step(step, _ctx(iap=True, proxy=True, preview=preview))
    adds = _gcloud(calls, _GRANT)
    assert any("lingoleap-frontend-run@" in c and "roles/run.invoker" in c for c in adds)
    assert any("github-actions@" in c and "roles/run.invoker" in c for c in adds)
    assert not _gcloud(calls, _REVOKE), "revoking allUsers is the deploy's job"
    assert not _gcloud(calls, "run deploy")


@pytest.mark.parametrize("wf,job,preview", CASES)
def test_pre_deploy_grant_skips_when_service_does_not_exist_yet(wf, job, preview):
    step = _step(wf, job, "deploy 前先授權")
    calls = _run_step(step, _ctx(iap=True, proxy=True, preview=preview),
                      extra_env={"FAKE_MISSING": "1"})
    assert not _gcloud(calls, _GRANT)


@pytest.mark.parametrize("wf,job,preview", CASES)
def test_pre_deploy_grant_refuses_iap_without_proxy(wf, job, preview):
    step = _step(wf, job, "deploy 前先授權")
    rc, calls, _ = _run_step_rc(step, _ctx(iap=True, proxy=False, preview=preview))
    assert rc != 0, "fail before the deploy locks a backend the browser calls directly"
    assert not _gcloud(calls, _GRANT)


# finding 3: positive health checks only prove CI's token works. With IAP
# on, an anonymous request must be refused by both services.
NEG_CASES = [
    pytest.param(PREVIEW_WF, "deploy-preview", True, id="preview"),
    pytest.param(STAGING_WF, "smoke-test", False, id="staging"),
]


def _neg_env(backend_code: str, frontend_code: str) -> dict[str, str]:
    return {"STAGING_BACKEND": STAGING_BACKEND_URL,
            "FAKE_CURL_BACKEND": backend_code, "FAKE_CURL_FRONTEND": frontend_code}


@pytest.mark.parametrize("wf,job,preview", NEG_CASES)
def test_negative_check_passes_when_both_refuse_anonymous(wf, job, preview):
    step = _step(wf, job, "未帶憑證必須被擋")
    assert "env.IAP_ENABLED == 'true'" in str(step.get("if", ""))
    backend_url = PREVIEW_BACKEND_URL if preview else STAGING_BACKEND_URL
    frontend_url = PREVIEW_FRONTEND_URL if preview else STAGING_FRONTEND_URL
    for fe_code in ("302", "401"):
        rc, calls, out = _run_step_rc(step, _ctx(iap=True, proxy=True, preview=preview),
                                      extra_env=_neg_env("403", fe_code))
        assert rc == 0, out
        curls = [c for c in calls if c.startswith("curl ")]
        assert any(f"{backend_url}/api/health" in c for c in curls), curls
        assert any(frontend_url in c and "backend" not in c for c in curls), curls
        for c in curls:
            assert "Authorization" not in c, f"negative check must carry no credentials: {c}"


@pytest.mark.parametrize("backend_code,frontend_code", [
    ("200", "302"), ("401", "302"), ("403", "200"), ("403", "500"),
])
@pytest.mark.parametrize("wf,job,preview", NEG_CASES)
def test_negative_check_fails_when_anonymous_gets_through(wf, job, preview, backend_code, frontend_code):
    step = _step(wf, job, "未帶憑證必須被擋")
    rc, _, out = _run_step_rc(step, _ctx(iap=True, proxy=True, preview=preview),
                              extra_env=_neg_env(backend_code, frontend_code))
    assert rc != 0, f"backend={backend_code} frontend={frontend_code} must fail the job\n{out}"


# finding 4: rolling IAP_ENABLED back to 'false' with a frontend-only change
# skips the backend deploy, leaving it locked while the non-proxy frontend
# calls it from the browser. The frontend job must reopen it first.
@pytest.mark.parametrize("wf,job,preview", FE_CASES)
def test_switch_off_reopens_locked_backend_before_frontend_deploy(wf, job, preview):
    assert _index(wf, job, "補回 allUsers") < _index(wf, job, "Deploy frontend")
    step = _step(wf, job, "補回 allUsers")
    assert "env.IAP_ENABLED != 'true'" in str(step.get("if", ""))
    calls = _run_step(step, _ctx(iap=False, proxy=False, preview=preview), extra_env={
        "FAKE_IAM_POLICY": '{"bindings":[{"members":["serviceAccount:x@y"]}]}'})
    adds = _gcloud(calls, _GRANT)
    assert len(adds) == 1 and "--member=allUsers" in adds[0] and "roles/run.invoker" in adds[0]
    svc = "lingoleap-backend-issue-77" if preview else "lingoleap-backend-staging"
    assert svc in adds[0]


@pytest.mark.parametrize("wf,job,preview", FE_CASES)
def test_switch_off_backend_already_public_is_untouched(wf, job, preview):
    step = _step(wf, job, "補回 allUsers")
    calls = _run_step(step, _ctx(iap=False, proxy=False, preview=preview))
    assert not _gcloud(calls, _GRANT), "today's normal state: no IAM write"
    calls = _run_step(step, _ctx(iap=False, proxy=False, preview=preview), extra_env={
        "FAKE_MISSING": "1",
        "FAKE_IAM_POLICY": '{"bindings":[{"members":["serviceAccount:x@y"]}]}'})
    assert not _gcloud(calls, _GRANT), "no backend service -> nothing to reopen"


# Live preview trial (PR #4079): the GitHub runner's gcloud ships WITHOUT the
# `beta` component, so the first `gcloud beta run deploy` stopped on an
# install prompt ("This prompt could not be answered because you are not in
# an interactive session") and the frontend deploy failed. Every job that
# runs a `gcloud beta` command must install the component in its
# setup-gcloud step, before any step that uses it. Checked across every
# workflow, not just the two IAP ones, so a new beta call can't regress it.
def _beta_jobs():
    for wf in sorted(WORKFLOWS_DIR.glob("*.yml")):
        for name, job in (_doc(wf).get("jobs") or {}).items():
            steps = job.get("steps") or []
            if any(re.search(r"\bgcloud\s+beta\b", str(s.get("run", ""))) for s in steps):
                yield wf, name


BETA_JOBS = list(_beta_jobs())


def test_beta_job_discovery_finds_the_iap_deploy_jobs():
    # positive control: the scan must see the jobs we know use gcloud beta
    found = {(wf.name, job) for wf, job in BETA_JOBS}
    assert ("preview-deploy.yml", "deploy-preview") in found, found
    assert ("staging-deploy.yml", "deploy-frontend") in found, found


@pytest.mark.parametrize("wf,job", BETA_JOBS, ids=[f"{w.name}:{j}" for w, j in BETA_JOBS])
def test_jobs_using_gcloud_beta_install_the_beta_component(wf, job):
    steps = _job(wf, job)["steps"]
    setup = [i for i, s in enumerate(steps) if "google-github-actions/setup-gcloud" in str(s.get("uses", ""))]
    assert len(setup) == 1, f"{wf.name}:{job}: expected one setup-gcloud step, got {len(setup)}"
    comps = str((steps[setup[0]].get("with") or {}).get("install_components", ""))
    assert "beta" in [c.strip() for c in comps.split(",")], (
        f"{wf.name}:{job}: setup-gcloud must set install_components: 'beta' "
        "(runner gcloud has no beta component; the deploy dies on an install prompt)")
    first_beta = min(i for i, s in enumerate(steps) if re.search(r"\bgcloud\s+beta\b", str(s.get("run", ""))))
    assert setup[0] < first_beta, f"{wf.name}:{job}: beta used before setup-gcloud"


# ── 10: a change to the deploy workflow itself redeploys both services ──


@pytest.mark.parametrize("wf", [PREVIEW_WF, STAGING_WF], ids=["preview", "staging"])
def test_workflow_change_counts_as_backend_and_frontend_change(wf):
    """2026-11-16 (#4083): flipping IAP_ENABLED only touched the workflow
    file, so paths-filter skipped deploy-frontend. The backend got locked,
    the old public frontend kept serving and called the locked backend
    directly -> staging broken until a manual workflow_dispatch. Any edit to
    this workflow must redeploy both halves so the switches apply together."""
    steps = _job(wf, "detect-changes")["steps"]
    filt = [s for s in steps if "paths-filter" in str(s.get("uses", ""))]
    assert len(filt) == 1
    filters = yaml.safe_load(filt[0]["with"]["filters"])
    me = f".github/workflows/{wf.name}"
    for key in ("backend", "frontend"):
        assert me in filters[key], f"{wf.name}: {key} filter misses {me}: {filters[key]}"
