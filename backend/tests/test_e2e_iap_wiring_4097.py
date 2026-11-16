"""#4097 — staging E2E (e2e-tests.yml) must get through IAP, without handing
third-party code a GCP credential.

Since #3733 turned IAP on for staging, the "Wait for staging to be healthy"
step curled the staging frontend anonymously, got 302 (Google login) thirty
times and the whole E2E job died before a single test ran. The job only read
`secrets.IAP_AUDIENCE` (unset -> no token -> anonymous).

Same style as test_iap_open_wiring_3733.py: each step's `run:` script is
pulled out of the workflow, its `${{ ... }}` expressions substituted, and it
is EXECUTED under bash with fake `gcloud` / `curl` / `docker` / `python3` on
PATH that record their argv. So these lock what the step does, not which
words appear in it.

What this locks:

  1. the health wait signs an IAP JWT for the staging frontend's own URL
     (literal, not an unset secret) as the CI service account, sends it as
     Proxy-Authorization, and curls that same host (IAP checks aud against
     the exact hostname).
  2. failing to sign is a hard error, not a silent anonymous retry loop.
  3. Playwright runs with the same token, and its API calls go through the
     frontend's same-origin proxy (E2E_BACKEND_URL == frontend URL): the
     backend is run.invoker-locked and only the IAP JWT is carried.
  4. the third-party code (npm ci + Playwright) runs inside a container that
     gets ONLY the variables it needs: no GitHub OIDC request variables, no
     GCP credential file, no mount of the workspace root (where auth@v2
     writes its credential file). Same rule as
     backend/specs/test_workflow_gcp_cred_exposure_spec.py.
  5. the container image's Playwright version equals the lockfile's
     (browsers are baked into the image).
  6. workflow_dispatch exists, so staging can be re-checked after a merge.
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
E2E_WF = REPO / ".github" / "workflows" / "e2e-tests.yml"
LOCKFILE = REPO / "frontend" / "package-lock.json"

STAGING_FRONTEND_URL = "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app"
CI_SA = "github-actions@lingoleap-dev.iam.gserviceaccount.com"
FAKE_JWT = "eyFAKE.header.sig"


def _job() -> dict:
    return yaml.safe_load(E2E_WF.read_text(encoding="utf-8"))["jobs"]["e2e"]


def _step(name_part: str) -> dict:
    hits = [s for s in _job()["steps"] if name_part in str(s.get("name", ""))]
    assert len(hits) == 1, f"expected 1 step named ~{name_part!r}, got {len(hits)}"
    return hits[0]


_EXPR = re.compile(r"\$\{\{\s*(.*?)\s*\}\}")


def _render(script: str, ctx: dict[str, str]) -> str:
    return _EXPR.sub(lambda m: ctx.get(m.group(1), ""), script)


# sign-jwt: `gcloud iam service-accounts sign-jwt <claims> <out> --iam-account=SA`
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
    # record the env the container would receive from `-e NAME` pass-through
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


def _run(step: dict, ctx: dict[str, str] | None = None,
         extra_env: dict[str, str] | None = None) -> tuple[int, list[str], str, str]:
    script = _render(str(step["run"]), ctx or {})
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
        env = {
            "PATH": f"{bindir}:/usr/bin:/bin",
            "CALLS": str(calls),
            "HOME": tmp,
            "FAKE_JWT": FAKE_JWT,
            "GITHUB_WORKSPACE": str(REPO),
            "GITHUB_OUTPUT": str(Path(tmp) / "gh_out"),
            "GITHUB_ENV": str(Path(tmp) / "gh_env"),
            # what a real runner exports into every step when id-token: write
            "ACTIONS_ID_TOKEN_REQUEST_URL": "https://oidc.example/req",
            "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "oidc-request-secret",
            "GOOGLE_APPLICATION_CREDENTIALS": str(REPO / "gha-creds-x.json"),
        }
        for k, v in (step.get("env") or {}).items():
            env[k] = _render(str(v), ctx or {})
        env.update(extra_env or {})
        proc = subprocess.run(
            ["bash", "-e", "-o", "pipefail", "-c", script],
            cwd=REPO, env=env, capture_output=True, text=True, timeout=60,
        )
        recorded = [line for line in calls.read_text().splitlines() if line]
        claims_file = Path(str(calls) + ".claims")
        claims = claims_file.read_text() if claims_file.exists() else ""
        return proc.returncode, recorded, claims, proc.stdout + proc.stderr


def _assert_token_only_masked(out: str) -> None:
    """The runner consumes `::add-mask::` lines (never shown in the log) and
    redacts the value afterwards; anything else printing it is a leak."""
    lines = out.splitlines()
    assert any(l == f"::add-mask::{FAKE_JWT}" for l in lines), "token must be masked"
    leaked = [l for l in lines if FAKE_JWT in l and not l.startswith("::add-mask::")]
    assert not leaked, leaked


# ── 1/2: health wait ─────────────────────────────────────────────────────


def test_health_wait_signs_for_staging_frontend_and_sends_it():
    step = _step("Wait for staging to be healthy")
    env = step.get("env") or {}
    assert str(env.get("IAP_AUDIENCE")) == STAGING_FRONTEND_URL, (
        "audience must be the staging frontend URL itself, not an unset secret"
    )
    assert str(env.get("IAP_SIGNING_SA_EMAIL")) == CI_SA
    rc, calls, claims, out = _run(step)
    assert rc == 0, out
    assert json.loads(claims)["aud"] == STAGING_FRONTEND_URL
    assert json.loads(claims)["iss"] == CI_SA
    curls = [c for c in calls if c.startswith("curl ")]
    assert curls, calls
    assert all(f"Proxy-Authorization: Bearer {FAKE_JWT}" in c for c in curls), curls
    assert all(STAGING_FRONTEND_URL in c for c in curls), curls
    _assert_token_only_masked(out)


def test_health_wait_fails_fast_when_it_cannot_sign():
    rc, calls, _, out = _run(_step("Wait for staging to be healthy"),
                             extra_env={"FAKE_SIGN_FAIL": "1"})
    assert rc != 0, "no token while IAP is on must be a hard error"
    assert not [c for c in calls if c.startswith("curl ")], (
        "must not loop 30x anonymously into the Google login page"
    )


# ── 3/4: Playwright run ──────────────────────────────────────────────────


def _docker_call(calls: list[str]) -> str:
    runs = [c for c in calls if c.startswith("docker run ")]
    assert len(runs) == 1, calls
    return runs[0]


def test_playwright_runs_in_container_with_iap_token_through_frontend():
    step = _step("Run E2E tests")
    rc, calls, claims, out = _run(step, ctx={"steps.wait.outputs.effective_url": STAGING_FRONTEND_URL})
    assert rc == 0, out
    assert json.loads(claims)["aud"] == STAGING_FRONTEND_URL
    passed = dict(c[4:].split("=", 1) for c in calls if c.startswith("ENV "))
    assert passed.get("IAP_PROXY_TOKEN") == FAKE_JWT, passed
    assert passed.get("PLAYWRIGHT_BASE_URL") == STAGING_FRONTEND_URL, passed
    assert passed.get("E2E_BACKEND_URL") == STAGING_FRONTEND_URL, (
        "API calls must go through the frontend's /api proxy; the backend is "
        "invoker-locked and the container carries only the IAP JWT"
    )
    assert FAKE_JWT not in _docker_call(calls), "token must not be on the docker argv"
    _assert_token_only_masked(out)


def test_container_gets_no_gcp_or_oidc_credentials():
    rc, calls, _, out = _run(_step("Run E2E tests"),
                             ctx={"steps.wait.outputs.effective_url": STAGING_FRONTEND_URL})
    assert rc == 0, out
    docker = _docker_call(calls)
    for forbidden in ("ACTIONS_ID_TOKEN", "ACTIONS_RUNTIME", "GOOGLE_APPLICATION_CREDENTIALS",
                      "CLOUDSDK", "GOOGLE_GHA_CREDS", "--env-file", "-e ALL"):
        assert forbidden not in docker, f"{forbidden} reaches the container: {docker}"
    mounts = re.findall(r"(?:-v|--volume) (\S+)", docker)
    assert mounts, docker
    for m in mounts:
        host = m.split(":", 1)[0]
        assert Path(host).resolve() == (REPO / "frontend").resolve(), (
            f"only frontend/ may be mounted (workspace root holds gha-creds-*.json): {m}"
        )


def test_no_third_party_code_runs_on_the_credentialed_host():
    """npm / npx / playwright may only appear inside the container step."""
    pat = re.compile(r"\b(npm|npx|playwright)\b")
    for s in _job()["steps"]:
        uses = str(s.get("uses", ""))
        assert "setup-node" not in uses, "host node toolchain is not needed any more"
        run = s.get("run")
        if not isinstance(run, str) or not pat.search(run):
            continue
        assert "Run E2E tests" in str(s.get("name")), f"{s.get('name')} runs npm on the host"
        before_docker = run.split("docker run", 1)[0]
        assert not pat.search(before_docker), "npm/npx must only run inside `docker run`"


def test_mint_happens_after_auth_in_the_same_job():
    names = [str(s.get("name", s.get("id", ""))) for s in _job()["steps"]]
    auth = next(i for i, s in enumerate(_job()["steps"])
                if "google-github-actions/auth@" in str(s.get("uses", "")))
    assert auth < names.index(_step("Wait for staging to be healthy")["name"])
    assert auth < names.index(_step("Run E2E tests")["name"])


# ── 5: image version == lockfile ─────────────────────────────────────────


def test_playwright_image_matches_lockfile_version():
    run = str(_step("Run E2E tests")["run"])
    m = re.search(r"mcr\.microsoft\.com/playwright:v([\d.]+)-\w+@sha256:[0-9a-f]{64}", run)
    assert m, "image must be the official Playwright image, pinned by tag AND digest"
    lock = json.loads(LOCKFILE.read_text(encoding="utf-8"))
    assert m.group(1) == lock["packages"]["node_modules/@playwright/test"]["version"]


# ── 6: manual re-run against staging ─────────────────────────────────────


def test_workflow_dispatch_runs_the_e2e_job():
    doc = yaml.safe_load(E2E_WF.read_text(encoding="utf-8"))
    on = doc.get("on", doc.get(True))
    assert "workflow_dispatch" in on
    det = doc["jobs"]["detect-changes"]
    assert "workflow_dispatch" in json.dumps(det), (
        "detect-changes must not skip a manual run (paths-filter has no PR diff there)"
    )
