"""#3733: once the staging backend is locked (run.invoker, no allUsers), a
Firebase Hosting rewrite to it cannot carry an identity token, so
lingoleap-staging.web.app / lingoleap-dev.web.app would serve a page whose
/api, /assets and /q calls all 403.  Those two sites must instead forward
every path to the IAP-protected staging frontend, keeping path + query.
Prod is untouched."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGING_FE = "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app"


def _targets():
    cfg = json.loads((ROOT / "firebase.json").read_text())
    return {h["target"]: h for h in cfg["hosting"]}


def test_staging_and_dev_sites_forward_everything_to_locked_staging_frontend():
    for name in ("staging", "dev"):
        site = _targets()[name]
        assert not site.get("rewrites"), f"{name}: rewrites to locked backend would 403"
        redirects = site.get("redirects") or []
        assert redirects, f"{name}: no redirect"
        r = redirects[0]
        assert r["source"] == "/:path*"
        assert r["destination"] == STAGING_FE + "/:path*"
        assert r["type"] == 302  # temporary: reversible if IAP is rolled back


def test_prod_site_keeps_serving_and_rewriting_to_prod_backend():
    prod = _targets()["prod"]
    assert not prod.get("redirects")
    ids = {r["run"]["serviceId"] for r in prod["rewrites"] if "run" in r}
    assert ids == {"lingoleap-backend"}


def test_staging_workflow_verifies_the_redirect_not_a_200():
    wf = (ROOT / ".github/workflows/staging-deploy.yml").read_text()
    step = wf.split("name: Verify Firebase sites", 1)[1].split("\n  smoke-test:", 1)[0]
    assert "302" in step and "redirect_url" in step
    assert '"$API" != "200"' not in step
