"""App config — env vars for CORS, DB, JWT, etc.

ALLOWED_ORIGINS: comma-separated frontend origins (Production: lingoleap-frontend-*.run.app, lingoleap-dev.web.app)
"""
import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str = ""
    gemini_api_key: str = ""
    database_url: str = "sqlite:///./test.db"
    redis_url: str = "redis://localhost:6379"
    allowed_origins: str = "http://localhost:3000,http://localhost:5173,http://localhost:5174"
    gcs_bucket: str = "lingoleap-assets"
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8 hours
    google_client_id: str = ""  # set GOOGLE_CLIENT_ID env var in Cloud Run
    # Junyi SSO base URL (issue #1198).
    # Production: https://www.junyiacademy.org
    # Testing ci-live server: override with JUNYI_SSO_BASE_URL env var
    junyi_sso_base_url: str = "https://www.junyiacademy.org"
    parent_portal_enabled: bool = False
    # Email verification gate (issue #460).
    # False (default): auto-verify on registration — existing flow unchanged.
    # True: new registrations get email_verified=False and must click a link before login.
    require_email_verification: bool = False
    # Teacher-gating (issue #457).
    # False (default): students without a classroom can still access the platform.
    # True: students without a classroom are redirected to the "no teacher" waiting screen.
    # Flip via Cloud Run env var ENFORCE_TEACHER_GATING=true when ready to enforce.
    enforce_teacher_gating: bool = False
    # Demo / test data seeding gate (Issue #989).
    # True (default): POST /api/admin/seed/demo-students is available.
    # Set ENABLE_TEST_SEED=false in production Cloud Run to disable.
    enable_test_seed: bool = True
    # GCS bucket for OMO (photo upload) feature (Issue #1575).
    # Per-environment: prod → lingoleap-omo-uploads-prod,
    #                  staging → lingoleap-omo-uploads-staging,
    #                  preview → lingoleap-omo-uploads-preview.
    # Falls back to original shared bucket for backward compat / local dev.
    gcs_omo_bucket: str = "lingoleap-omo-uploads"
    # Shared secret for the public QA-board tools (spotlight-qa / keypoints-qa) — Issue #2534.
    # Empty (default): endpoints are OPEN (local-dev escape hatch).
    # Set QA_TOOLS_SHARED_SECRET in staging/preview Cloud Run to require an
    # `x-qa-token` header on every QA-board request (fail-closed once set).
    qa_tools_shared_secret: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]

    # Preview frontends must reach the staging backend (#3139).
    #
    # `preview-deploy.yml` only builds a preview BACKEND when the PR touches
    # `backend/**`. A frontend-only PR therefore points its preview frontend at
    # the staging backend, whose ALLOWED_ORIGINS is a hardcoded list of four
    # origins that has never contained a preview URL -- so every frontend-only
    # PR hits CORS at the exact moment someone is asked to verify it.
    # Adding the origin by hand does not survive either: `staging-deploy.yml`
    # writes ALLOWED_ORIGINS with `--set-env-vars`, which replaces the whole
    # set on the next merge.
    #
    # ⛔ The project pin is the security boundary, not decoration. Cloud Run
    # service names are not globally unique -- without pinning our own project
    # number and URL hash, anyone could deploy `lingoleap-frontend-issue-999`
    # in their own project and be trusted with `allow_credentials=True`.
    # Both shapes below are real and in use for the same service:
    #   https://lingoleap-frontend-issue-3134-958347263320.asia-east1.run.app
    #   https://lingoleap-frontend-issue-3134-oja2sffiya-de.a.run.app
    _PREVIEW_ORIGIN_REGEX = (
        r"^https://lingoleap-frontend-(?:issue|pr)-\d+"
        r"-(?:958347263320\.asia-east1|oja2sffiya-de\.a)"
        r"\.run\.app$"
    )

    @property
    def allow_preview_origins(self) -> bool:
        """True on staging / preview / local dev. Never on production.

        Fail-closed the same way `is_dev` does: an unset ENVIRONMENT on Cloud
        Run is treated as production, so a workflow that forgets the var does
        not silently widen CORS on the production backend.
        """
        env = os.environ.get("ENVIRONMENT", "").lower()
        if env in ("development", "preview", "staging"):
            return True
        if env == "production":
            return False
        # Unset: Cloud Run always sets K_SERVICE. If present → treat as prod.
        if os.environ.get("K_SERVICE"):
            return False
        # Local dev (no K_SERVICE, no ENVIRONMENT).
        return True

    @property
    def preview_origin_regex(self) -> str | None:
        """Regex for CORSMiddleware, or None where previews must not be trusted."""
        if not self.allow_preview_origins:
            return None
        return self._PREVIEW_ORIGIN_REGEX

    @property
    def is_dev(self) -> bool:
        """True when running in a non-production environment (development or preview).

        Fail-safe: unknown or missing ENVIRONMENT on Cloud Run defaults to
        production (is_dev=False), so tokens never leak when deploy workflows
        forget to set the var. Local runs (no K_SERVICE) default to dev.
        """
        env = os.environ.get("ENVIRONMENT", "").lower()
        if env in ("development", "preview"):
            return True
        if env in ("production", "staging"):
            return False
        # Unset: Cloud Run always sets K_SERVICE. If present → treat as prod.
        if os.environ.get("K_SERVICE"):
            return False
        # Local dev (no K_SERVICE, no ENVIRONMENT) → dev.
        return True


settings = Settings()
