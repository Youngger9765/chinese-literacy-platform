from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    openai_api_key: str = ""
    gemini_api_key: str = ""
    database_url: str = "sqlite:///./test.db"
    redis_url: str = "redis://localhost:6379"
    allowed_origins: str = "http://localhost:3000"
    gcs_bucket: str = "lingoleap-assets"
    gcs_public_url: str = "https://storage.googleapis.com/lingoleap-assets"
    jwt_secret_key: str = "dev-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8 hours

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",")]


settings = Settings()
