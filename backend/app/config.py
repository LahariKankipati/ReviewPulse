"""Application settings loaded from environment variables."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed configuration shared by API and worker processes."""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Async DB URL used by API and workers.
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/reviewpulse"

    # --- Redis / Celery broker ---
    redis_url: str = "redis://localhost:6379/0"

    # LLM provider defaults.
    llm_provider: str = "gemini"          # "anthropic" | "gemini"
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    llm_model_anthropic: str = "claude-3-5-haiku-20241022"
    llm_model_gemini: str = "gemini-1.5-flash"
    embedding_model: str = "gemini-embedding"
    embedding_dim: int = 768

    # Secret used to verify Supabase JWTs.
    supabase_jwt_secret: str = "dev-insecure-secret-change-me"

    # Comma-separated CORS origins and webhook signing secret.
    cors_origins: str = "http://localhost:5173"
    webhook_secret: str = "dev-webhook-hmac-secret"
    environment: str = "development"


@lru_cache
def get_settings() -> Settings:
    """Return cached settings to avoid reparsing env vars on each import."""
    return Settings()
