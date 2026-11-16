"""#3719 — the IAP_ENABLED switch (preview-deploy.yml + staging-deploy.yml)
must default to off.

IAP (Google Identity-Aware Proxy) is not being turned on yet. Both deploy
workflows gained a single on/off switch (`env.IAP_ENABLED`) so that flipping
IAP on for a preview or staging later needs exactly one line changed, with
no other code changes. The structural guarantee this locks, for each file:

  1. The switch defaults to the STRING 'false' (not the boolean — GitHub
     Actions expressions compare `env.X` as a string, and `'false' == true`
     in YAML/JS-ish truthiness traps have bitten this repo's workflows
     before; a bare `false` here would silently always evaluate truthy in
     an `if: env.IAP_ENABLED == 'true'` string comparison).
  2. Every IAP-enabling step is gated on that switch being the string
     'true' — never run unconditionally.
  3. The steps call `gcloud beta run services update --iap` (Cloud Run's
     native IAP integration), not a Cloud Run deploy flag -- `--iap` does
     not exist on `gcloud run deploy`/`gcloud run services update` (GA);
     it is only under `gcloud beta`/`gcloud alpha` as of this writing
     (verified via `gcloud beta run services update --help`).

preview-deploy.yml has one job with four services' worth of steps and reuses
each sibling deploy step's detect-changes gate; staging-deploy.yml splits
backend/frontend into separate jobs already gated at the job level, so its
IAP steps only need the env check.
"""
from pathlib import Path

import yaml

WORKFLOWS_DIR = Path(__file__).resolve().parents[2] / ".github" / "workflows"
PREVIEW_WF = WORKFLOWS_DIR / "preview-deploy.yml"
STAGING_WF = WORKFLOWS_DIR / "staging-deploy.yml"


def _load(path: Path):
    raw = path.read_text(encoding="utf-8")
    return raw, yaml.safe_load(raw)


def _iap_steps(steps):
    return [s for s in steps if "gcloud beta run services update" in str(s.get("run", ""))]


# ── preview-deploy.yml ───────────────────────────────────────────────────


def test_preview_iap_enabled_defaults_to_the_string_false():
    raw, doc = _load(PREVIEW_WF)
    env = doc.get("env", {})
    assert "IAP_ENABLED" in env, "IAP_ENABLED switch is missing from preview-deploy.yml env"
    assert env["IAP_ENABLED"] == "false", (
        f"IAP_ENABLED must default to the string 'false', got {env['IAP_ENABLED']!r}"
    )


def test_preview_iap_steps_are_gated_on_the_switch_not_unconditional():
    raw, doc = _load(PREVIEW_WF)
    steps = doc["jobs"]["deploy-preview"]["steps"]
    iap_steps = _iap_steps(steps)
    # #3733: only the frontend gets native IAP now; the backend is locked
    # with run.invoker instead (see test_backend_invoker_switch_3733.py).
    assert len(iap_steps) >= 1, (
        f"expected at least 1 step calling `gcloud beta run services update` "
        f"(frontend preview), found {len(iap_steps)}"
    )
    for step in iap_steps:
        cond = step.get("if", "")
        assert "IAP_ENABLED" in cond and "'true'" in cond, (
            f"step {step.get('name')!r} runs `gcloud beta run services update` "
            f"without gating on env.IAP_ENABLED == 'true' (if: {cond!r})"
        )


def test_preview_iap_steps_use_the_native_cloud_run_iap_flag():
    raw, doc = _load(PREVIEW_WF)
    steps = doc["jobs"]["deploy-preview"]["steps"]
    iap_flag_steps = [s for s in steps if "--iap" in str(s.get("run", ""))]
    assert len(iap_flag_steps) >= 1  # frontend only since #3733
    for step in iap_flag_steps:
        # #3733 security review: the frontend deploy itself now passes --iap
        # (`gcloud beta run deploy`), so beta `deploy` is allowed too; what
        # matters is that --iap never goes to the GA command group.
        # test_iap_open_wiring_3733.py executes that step and asserts the
        # recorded call starts with `gcloud beta run deploy`.
        assert "gcloud beta run" in str(step["run"]), (
            f"step {step.get('name')!r} uses --iap but not via "
            "`gcloud beta run ...` -- that flag does not exist "
            "on the GA `gcloud run` command group"
        )


# ── staging-deploy.yml ───────────────────────────────────────────────────


def test_staging_iap_enabled_defaults_to_the_string_false():
    raw, doc = _load(STAGING_WF)
    env = doc.get("env", {})
    assert "IAP_ENABLED" in env, "IAP_ENABLED switch is missing from staging-deploy.yml env"
    assert env["IAP_ENABLED"] == "false", (
        f"IAP_ENABLED must default to the string 'false', got {env['IAP_ENABLED']!r}"
    )


def test_staging_iap_steps_are_gated_on_the_switch_not_unconditional():
    raw, doc = _load(STAGING_WF)
    all_steps = []
    for job_name in ("deploy-backend", "deploy-frontend"):
        all_steps.extend(doc["jobs"][job_name]["steps"])
    iap_steps = _iap_steps(all_steps)
    # #3733: only the frontend gets native IAP now (backend → run.invoker).
    assert len(iap_steps) >= 1, (
        f"expected at least 1 step calling `gcloud beta run services update` "
        f"(staging frontend), found {len(iap_steps)}"
    )
    for step in iap_steps:
        cond = step.get("if", "")
        assert "IAP_ENABLED" in cond and "'true'" in cond, (
            f"step {step.get('name')!r} runs `gcloud beta run services update` "
            f"without gating on env.IAP_ENABLED == 'true' (if: {cond!r})"
        )


def test_staging_iap_steps_use_the_native_cloud_run_iap_flag():
    raw, doc = _load(STAGING_WF)
    all_steps = []
    for job_name in ("deploy-backend", "deploy-frontend"):
        all_steps.extend(doc["jobs"][job_name]["steps"])
    iap_flag_steps = [s for s in all_steps if "--iap" in str(s.get("run", ""))]
    assert len(iap_flag_steps) >= 1  # frontend only since #3733
    for step in iap_flag_steps:
        # see the preview test above: beta `deploy` --iap is allowed (#3733)
        assert "gcloud beta run" in str(step["run"]), (
            f"step {step.get('name')!r} uses --iap but not via "
            "`gcloud beta run ...`"
        )
