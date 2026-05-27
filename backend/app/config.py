"""Application settings loaded from environment variables."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed configuration shared by API and worker processes."""
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Async DB URL — postgresql+asyncpg://... with pgvector enabled.
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/reviewpulse"

    # Active LLM provider: "groq" (default). Swap to "gemini" to route to GeminiProvider stub.
    llm_provider: str = "groq"
    groq_api_key: str = ""
    llm_model_groq: str = "llama-3.1-8b-instant"

    # Active embedding provider: Jina AI (jina-embeddings-v2-base-en, 768-dim).
    jina_api_key: str = ""

    # Comma-separated allowed frontend origins.
    cors_origins: str = "http://localhost:5173"

    # HMAC secret for signing job-completion webhooks (N10).
    # If webhook_url is empty, webhook firing is skipped silently.
    webhook_secret: str = "dev-webhook-hmac-secret"
    webhook_url: str = ""

    # Secret for POST /api/admin/refresh and GET /api/metrics (used by GitHub Actions cron).
    admin_secret: str = "dev-admin-secret-change-me"

    environment: str = "development"


@lru_cache
def get_settings() -> Settings:
    """Return cached settings to avoid reparsing env vars on each import."""
    return Settings()
