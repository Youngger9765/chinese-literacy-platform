"""#3733 — when IAP_ENABLED is flipped on, the BACKEND must be locked with
Cloud Run's own "require authentication" (roles/run.invoker), NOT with
native IAP.

Why (docs/iap-runbook.md, verified on a throwaway canary pair 2026-10-24):
the frontend's nginx reaches the backend through a sidecar that can only
fetch a plain metadata-server ID token. Native IAP rejects those (401
"Invalid JWT audience") and only accepts service-account self-signed JWTs,
which nginx cannot mint. So `gcloud beta run services update <backend> --iap`
— what both deploy workflows did before this lock — would cut the frontend
off from its own backend the moment anyone flipped the switch.

What this locks, for preview-deploy.yml and staging-deploy.yml:

  1. No step ever runs `--iap` against the backend service.
  2. The IAP_ENABLED-gated backend step grants roles/run.invoker to the
     frontend's runtime service account AND the CI service account, and
     only then removes the `allUsers` invoker binding (grant-before-revoke,
     so there's no window where nobody can call the backend).
  3. That step fails closed unless SAME_ORIGIN_PROXY_ENABLED is also 'true':
     without the same-origin proxy the browser calls the backend directly
     and would get 403 on every request.
  4. Native IAP (`--iap`) stays on the FRONTEND step only.
"""
from pathlib import Path

import yaml

WORKFLOWS_DIR = Path(__file__).resolve().parents[2] / ".github" / "workflows"
PREVIEW_WF = WORKFLOWS_DIR / "preview-deploy.yml"
STAGING_WF = WORKFLOWS_DIR / "staging-deploy.yml"

FRONTEND_RUNTIME_SA = "lingoleap-frontend-run@lingoleap-dev.iam.gserviceaccount.com"
CI_SA = "github-actions@lingoleap-dev.iam.gserviceaccount.com"


def _steps(path: Path, job_names: tuple[str, ...]) -> list[dict]:
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    steps: list[dict] = []
    for job in job_names:
        steps.extend(doc["jobs"][job]["steps"])
    return steps


def _preview_steps() -> list[dict]:
    return _steps(PREVIEW_WF, ("deploy-preview",))


def _staging_backend_steps() -> list[dict]:
    return _steps(STAGING_WF, ("deploy-backend",))


def _staging_frontend_steps() -> list[dict]:
    return _steps(STAGING_WF, ("deploy-frontend",))


def _run(step: dict) -> str:
    return str(step.get("run", ""))


def _gated(step: dict) -> bool:
    # "runs only when the switch is ON" -- `!= 'true'` (the #3733 rollback
    # step that turns IAP back off) must not count as gated-on.
    cond = str(step.get("if", ""))
    return "IAP_ENABLED == 'true'" in cond


PRE_GRANT = "deploy 前先授權"


def _backend_iap_steps(steps: list[dict]) -> list[dict]:
    # the post-deploy lock step (grant + revoke allUsers); the pre-deploy
    # grant-only step (#3733 security review ordering fix) is checked apart.
    return [
        s for s in steps
        if _gated(s) and "BACKEND_SERVICE" in _run(s)
        and PRE_GRANT not in str(s.get("name", ""))
    ]


def _assert_pre_grant_only_grants(steps: list[dict]) -> None:
    pre = [s for s in steps if PRE_GRANT in str(s.get("name", ""))]
    assert len(pre) == 1 and _gated(pre[0])
    run = _run(pre[0])
    assert "--iap" not in run
    assert FRONTEND_RUNTIME_SA in run and CI_SA in run and "roles/run.invoker" in run
    assert "remove-iam-" "policy-binding" not in run, "pre-deploy step must only grant"
    deploy_at = next(i for i, s in enumerate(steps)
                     if "gcloud run deploy ${{ env.BACKEND_SERVICE }}" in _run(s))
    assert steps.index(pre[0]) < deploy_at


def _frontend_iap_steps(steps: list[dict]) -> list[dict]:
    return [
        s for s in steps
        if _gated(s) and "FRONTEND_SERVICE" in _run(s)
    ]


def _assert_backend_step_uses_invoker(step: dict) -> None:
    run = _run(step)
    name = step.get("name")
    assert "--iap" not in run, (
        f"{name!r}: backend must NOT get native IAP (#3733) — the frontend's "
        "sidecar can only present a plain ID token, which native IAP rejects"
    )
    assert "add-iam-policy-binding" in run and "roles/run.invoker" in run, (
        f"{name!r}: backend lock must grant roles/run.invoker"
    )
    assert FRONTEND_RUNTIME_SA in run, (
        f"{name!r}: frontend runtime SA must be granted run.invoker or the "
        "same-origin proxy hop is cut off"
    )
    assert CI_SA in run, (
        f"{name!r}: CI SA must be granted run.invoker or health checks / "
        "verify_*.py scripts are cut off"
    )
    assert "remove-iam-policy-binding" in run and "allUsers" in run, (
        f"{name!r}: backend lock must remove the allUsers invoker binding"
    )
    assert run.index("add-iam-policy-binding") < run.index("remove-iam-policy-binding"), (
        f"{name!r}: grant run.invoker BEFORE revoking allUsers, never the "
        "other way round (no window where nobody can call the backend)"
    )
    assert "SAME_ORIGIN_PROXY_ENABLED" in run and "exit 1" in run, (
        f"{name!r}: must fail closed when the same-origin proxy is off — "
        "the browser would otherwise call the locked backend directly"
    )
    guard_at = run.index("SAME_ORIGIN_PROXY_ENABLED")
    assert guard_at < run.index("add-iam-policy-binding"), (
        f"{name!r}: the proxy guard must run before any IAM change"
    )


# ── preview-deploy.yml ───────────────────────────────────────────────────


def test_preview_backend_iap_step_uses_run_invoker_not_native_iap():
    steps = _backend_iap_steps(_preview_steps())
    assert len(steps) == 1, f"expected exactly 1 gated backend step, found {len(steps)}"
    _assert_backend_step_uses_invoker(steps[0])
    _assert_pre_grant_only_grants(_preview_steps())


def test_preview_native_iap_is_only_applied_to_the_frontend():
    steps = _preview_steps()
    iap_flag = [s for s in steps if "--iap" in _run(s)]
    assert iap_flag, "frontend preview must still get native IAP when switched on"
    for s in iap_flag:
        assert "FRONTEND_SERVICE" in _run(s) and "BACKEND_SERVICE" not in _run(s), (
            f"{s.get('name')!r}: --iap may only target the frontend service"
        )
    assert len(_frontend_iap_steps(steps)) == 1


# ── staging-deploy.yml ───────────────────────────────────────────────────


def test_staging_backend_iap_step_uses_run_invoker_not_native_iap():
    steps = _backend_iap_steps(_staging_backend_steps())
    assert len(steps) == 1, f"expected exactly 1 gated backend step, found {len(steps)}"
    _assert_backend_step_uses_invoker(steps[0])
    _assert_pre_grant_only_grants(_staging_backend_steps())


def test_staging_native_iap_is_only_applied_to_the_frontend():
    backend_iap = [s for s in _staging_backend_steps() if "--iap" in _run(s)]
    assert backend_iap == [], (
        "staging deploy-backend job must not run --iap anywhere (#3733)"
    )
    frontend_iap = [s for s in _staging_frontend_steps() if "--iap" in _run(s)]
    # the deploy itself (IAP flag only when IAP_ENABLED is true, #3733
    # security review) + the idempotent gated re-assert step
    assert len(frontend_iap) == 2
    for s in frontend_iap:
        assert "FRONTEND_SERVICE" in _run(s) and "BACKEND_SERVICE" not in _run(s)
        assert _gated(s) or 'IAP_ENABLED }}" = "true" ]' in _run(s)


def test_backend_deploy_still_public_while_switch_is_off():
    """Positive control: with IAP_ENABLED='false' (the default) nothing about
    today's behaviour changes — the backend deploy step still passes
    --allow-unauthenticated, and the only IAM-touching step is gated."""
    for steps in (_preview_steps(), _staging_backend_steps()):
        iam_steps = [
            s for s in steps
            if "iam-policy-binding" in _run(s) and "BACKEND_SERVICE" in _run(s)
        ]
        # gated-on steps, plus the switch-off rollback step that may only
        # ADD allUsers back (never revoke anything)
        for s in iam_steps:
            if not _gated(s):
                assert "IAP_ENABLED != 'true'" in str(s.get("if", "")), s.get("name")
                assert "remove-iam-" "policy-binding" not in _run(s)
                assert "--member=allUsers" in _run(s)
        assert iam_steps and any(_gated(s) for s in iam_steps)
        deploys = [
            s for s in steps
            if "gcloud run deploy ${{ env.BACKEND_SERVICE }}" in _run(s)
        ]
        assert deploys and all("--allow-unauthenticated" in _run(s) for s in deploys)
