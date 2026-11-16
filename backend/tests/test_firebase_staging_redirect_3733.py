"""#3733: the staging backend is being locked (Cloud Run run.invoker, no
allUsers). A Firebase Hosting rewrite to it cannot carry an identity token, so
lingoleap-staging.web.app / lingoleap-dev.web.app would serve pages whose
/api, /assets and /q calls all 403. Those two sites must instead forward every
path (and query) with a 302 to the staging Cloud Run frontend, which is the
IAP-protected entry. Prod must stay exactly as it was.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CFG = json.loads((ROOT / "firebase.json").read_text(encoding="utf-8"))
STAGING_FE = "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app"
EXPECTED_REDIRECTS = [{"source": "/:path*", "destination": f"{STAGING_FE}/:path*", "type": 302}]


def _target(name):
    hits = [h for h in CFG["hosting"] if h.get("target") == name]
    assert len(hits) == 1, f"expected exactly one hosting target {name!r}, got {len(hits)}"
    return hits[0]


def test_staging_and_dev_only_redirect_to_staging_frontend():
    for name in ("staging", "dev"):
        h = _target(name)
        assert "rewrites" not in h, f"{name} still rewrites (to the soon-locked backend)"
        assert h.get("redirects") == EXPECTED_REDIRECTS, f"{name} redirects -> {h.get('redirects')!r}"


def test_prod_untouched_still_rewrites_to_prod_backend():
    h = _target("prod")
    assert "redirects" not in h
    runs = [r["run"]["serviceId"] for r in h["rewrites"] if "run" in r]
    assert runs, "prod lost its backend rewrites"
    assert set(runs) == {"lingoleap-backend"}, runs
    assert {r["source"] for r in h["rewrites"] if "run" in r} == {"/api/**", "/assets/**", "/q/**"}


def _verify_step():
    wf = (ROOT / ".github/workflows/staging-deploy.yml").read_text(encoding="utf-8")
    m = re.search(r"- name: Verify Firebase sites\n(.*?)(?=\n      - name: |\n  [a-z][\w-]*:\n)", wf, re.S)
    assert m, "Verify Firebase sites step not found"
    return m.group(1)


def test_verify_step_checks_302_to_staging_frontend_not_200():
    step = _verify_step()
    assert "%{redirect_url}" in step
    assert f'"302 {STAGING_FE}/learn/x?a=1"' in step
    assert "/api/health" not in step, "verify step still expects the backend via Firebase"
    assert '!= "200"' not in step
    assert "exit 1" in step
