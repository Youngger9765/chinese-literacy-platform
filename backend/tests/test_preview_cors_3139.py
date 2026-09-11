"""Preview frontends must reach the staging backend, and must NOT reach production (#3139).

Why this exists
---------------
`preview-deploy.yml` only deploys a preview BACKEND when the PR touches
`backend/**`. A frontend-only PR therefore builds its preview frontend against
the *staging* backend -- whose `ALLOWED_ORIGINS` is a hardcoded list of four
origins that has never contained any preview URL. So every frontend-only PR
hits CORS at exactly the moment someone is asked to verify it.

Manually adding the origin does not survive: `staging-deploy.yml` writes
`ALLOWED_ORIGINS` with `--set-env-vars`, which replaces the whole set on the
next merge.

The fix is a regex that recognises our own preview frontends, enabled only
outside production.

Security boundary
-----------------
The regex is pinned to THIS project's two URL shapes. Without that pin, anyone
could deploy a Cloud Run service named `lingoleap-frontend-issue-999` in their
own project and satisfy the pattern. Both shapes are real and in use:

    https://lingoleap-frontend-issue-3134-958347263320.asia-east1.run.app
    https://lingoleap-frontend-issue-3134-oja2sffiya-de.a.run.app
"""
import importlib
import re

import pytest

import app.config as config_module


def _settings_with_env(monkeypatch, **env):
    for k in ("ENVIRONMENT", "K_SERVICE"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    importlib.reload(config_module)
    return config_module.Settings()


PREVIEW_ORIGINS = [
    "https://lingoleap-frontend-issue-3134-958347263320.asia-east1.run.app",
    "https://lingoleap-frontend-issue-3134-oja2sffiya-de.a.run.app",
    "https://lingoleap-frontend-issue-1-958347263320.asia-east1.run.app",
    "https://lingoleap-frontend-pr-42-oja2sffiya-de.a.run.app",
    "https://lingoleap-frontend-pr-9999-958347263320.asia-east1.run.app",
]

# Every one of these must be refused even on staging. The first two are the
# attack this pin exists for: same service name, someone else's project.
FOREIGN_ORIGINS = [
    "https://lingoleap-frontend-issue-999-attacker123-de.a.run.app",
    "https://lingoleap-frontend-issue-999-111111111111.asia-east1.run.app",
    "https://lingoleap-frontend-issue-3134-958347263320.asia-east1.run.app.evil.com",
    "http://lingoleap-frontend-issue-3134-oja2sffiya-de.a.run.app",  # plain http
    "https://evil.com/?x=https://lingoleap-frontend-issue-3134-oja2sffiya-de.a.run.app",
    "https://lingoleap-frontend-issue-abc-oja2sffiya-de.a.run.app",  # non-numeric
    "https://lingoleap-backend-issue-3134-oja2sffiya-de.a.run.app",  # backend, not frontend
]


@pytest.mark.parametrize("env", ["staging", "preview", "development"])
def test_preview_regex_is_active_outside_production(monkeypatch, env):
    s = _settings_with_env(monkeypatch, ENVIRONMENT=env, K_SERVICE="svc")
    assert s.preview_origin_regex is not None, f"{env} must accept preview origins"
    rx = re.compile(s.preview_origin_regex)
    for origin in PREVIEW_ORIGINS:
        assert rx.match(origin), f"{env}: should allow {origin}"


def test_production_never_accepts_preview_origins(monkeypatch):
    s = _settings_with_env(monkeypatch, ENVIRONMENT="production", K_SERVICE="svc")
    assert s.preview_origin_regex is None, "production must not accept preview origins"


def test_unset_environment_on_cloud_run_fails_closed(monkeypatch):
    """A deploy workflow that forgets ENVIRONMENT must behave like production."""
    s = _settings_with_env(monkeypatch, K_SERVICE="svc")
    assert s.preview_origin_regex is None


def test_local_dev_accepts_preview_origins(monkeypatch):
    s = _settings_with_env(monkeypatch)  # no K_SERVICE, no ENVIRONMENT
    assert s.preview_origin_regex is not None


@pytest.mark.parametrize("origin", FOREIGN_ORIGINS)
def test_foreign_origins_refused_even_on_staging(monkeypatch, origin):
    s = _settings_with_env(monkeypatch, ENVIRONMENT="staging", K_SERVICE="svc")
    rx = re.compile(s.preview_origin_regex)
    assert not rx.match(origin), f"must NOT allow {origin}"


def test_regex_is_anchored_both_ends(monkeypatch):
    s = _settings_with_env(monkeypatch, ENVIRONMENT="staging", K_SERVICE="svc")
    assert s.preview_origin_regex.startswith("^")
    assert s.preview_origin_regex.endswith("$")


def test_middleware_receives_the_regex(monkeypatch):
    """Positive control on the wiring: the property is useless if main.py drops it.

    Asserting on the built app (not on a copy of the logic) is the point --
    a correct property that nobody passes to CORSMiddleware fixes nothing.
    """
    monkeypatch.setenv("ENVIRONMENT", "staging")
    monkeypatch.setenv("K_SERVICE", "svc")
    # main.py refuses to import outside dev without this; missing it makes the
    # test fail on setup, which is INVALID, not a verdict on the wiring.
    monkeypatch.setenv("JWT_SECRET_KEY", "test-only-not-a-real-key")
    importlib.reload(config_module)
    import app.main as main_module
    importlib.reload(main_module)

    from fastapi.middleware.cors import CORSMiddleware

    found = [m for m in main_module.app.user_middleware if m.cls is CORSMiddleware]
    assert found, "CORSMiddleware is not installed at all"
    kwargs = found[0].kwargs
    assert kwargs.get("allow_origin_regex"), (
        "CORSMiddleware was built without allow_origin_regex -- the property "
        "exists but nothing passes it, so previews still hit CORS"
    )
    rx = re.compile(kwargs["allow_origin_regex"])
    assert rx.match(PREVIEW_ORIGINS[0])
    assert not rx.match(FOREIGN_ORIGINS[0])
