"""The prod/staging backend deploy step must keep AI_FEATURES_ENABLED=true
pinned explicitly (#3861 — chatbot-only scope correction to the #3838 kill
switch).

`gcloud run deploy --set-env-vars=...` REPLACES the service's entire env var
map — it does not merge with what the previous revision had (that's
`--update-env-vars`). Both deploy.yml and staging-deploy.yml deploy the
backend with a hardcoded `--set-env-vars` list. If AI_FEATURES_ENABLED is
ever dropped from that list, the NEXT deploy silently wipes whatever value
was set manually on the running revision (exactly what happened on
production between #3844's hotfix and this PR — Young had to manually
`gcloud run services update --set-env-vars AI_FEATURES_ENABLED=true` to
restore 朗讀/OMO/etc. ahead of this fix landing).

`app.services.ai_feature_flag.ai_features_enabled()` now defaults to
enabled when the env var is absent, so losing it from a deploy no longer
re-breaks AI — but pinning it explicitly removes any ambiguity for the next
person reading the workflow, and is cheap to keep locked here.
"""
from __future__ import annotations

import pathlib
import re

WF = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows"

#: (workflow file, job step name substring) — identifies the backend deploy
#: step whose --set-env-vars string we check.
_BACKEND_DEPLOY_STEPS = [
    ("deploy.yml", "Deploy backend to Cloud Run"),
    ("staging-deploy.yml", "Deploy backend to Cloud Run (Staging)"),
]


def _extract_set_env_vars_value(workflow_name: str, step_name: str) -> str:
    """Pull the --set-env-vars="..." value out of the named step's `run:`
    block. Avoids a full YAML parse of the `run:` block (it's a multi-line
    shell script, not structured YAML) — a plain regex over the raw file
    text is simpler and robust to how the YAML block scalar is indented.
    """
    text = (WF / workflow_name).read_text(encoding="utf-8")
    # Find the step by its name: line, then look for --set-env-vars="..."
    # within the next ~40 lines (the gcloud run deploy invocation).
    step_idx = text.find(f"name: {step_name}")
    assert step_idx != -1, f"could not find step {step_name!r} in {workflow_name}"
    window = text[step_idx:step_idx + 4000]
    match = re.search(r'--set-env-vars="([^"]*)"', window)
    assert match, f"could not find --set-env-vars=\"...\" after step {step_name!r} in {workflow_name}"
    return match.group(1)


def test_backend_deploy_workflows_exist():
    """Positive control — if these files move/rename, every test below would
    otherwise silently pass against a stale assumption."""
    for name, _ in _BACKEND_DEPLOY_STEPS:
        assert (WF / name).is_file(), f"{name} not found under {WF}"


def test_set_env_vars_pins_ai_features_enabled_true():
    for name, step in _BACKEND_DEPLOY_STEPS:
        value = _extract_set_env_vars_value(name, step)
        assert "AI_FEATURES_ENABLED=true" in value, (
            f"{name}'s backend deploy step's --set-env-vars is missing "
            f"AI_FEATURES_ENABLED=true. Since --set-env-vars REPLACES the "
            f"whole env var map (not merges), the next deploy would silently "
            f"wipe any value set manually on the running Cloud Run revision. "
            f"Got: {value!r}"
        )


def test_set_env_vars_never_pins_ai_features_enabled_false():
    """A deliberate full-incident kill (#3838-style) is set manually via
    `gcloud run services update --set-env-vars AI_FEATURES_ENABLED=false`
    on the live revision — it must never be hardcoded into the deploy
    workflow itself, or every subsequent deploy would re-break AI."""
    for name, step in _BACKEND_DEPLOY_STEPS:
        value = _extract_set_env_vars_value(name, step)
        assert "AI_FEATURES_ENABLED=false" not in value, (
            f"{name} hardcodes AI_FEATURES_ENABLED=false in its deploy step — "
            f"this would re-break AI on every future deploy."
        )
