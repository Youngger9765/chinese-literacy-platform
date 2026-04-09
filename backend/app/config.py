"""App config — env vars for CORS, DB, JWT, etc.

ALLOWED_ORIGINS: comma-separated frontend origins (Production: lingoleap-frontend-*.run.app, lingoleap-dev.web.app)
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str = ""
    gemini_api_key: str = ""
    database_url: str = "sqlite:///./test.db"
    redis_url: str = "redis://localhost:6379"
    allowed_origins: str = "http://localhost:3000,http://localhost:5173,http://localhost:5174"
    gcs_bucket: str = "lingoleap-assets"
    gcs_public_url: str = "https://storage.googleapis.com/lingoleap-assets"
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8 hours
    google_client_id: str = ""  # set GOOGLE_CLIENT_ID env var in Cloud Run
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

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


settings = Settings()
