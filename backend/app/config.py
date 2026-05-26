"""
Central configuration. Everything secret or environment-specific lives here and is
read from environment variables (never hard-coded). This is what makes the same code
run on your laptop and on Render without edits — you just set different env vars.

pydantic-settings validates the values on startup, so a missing/typo'd variable fails
loudly and immediately instead of blowing up deep inside a request.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Database ---
    # async URL (used by FastAPI + worker): postgresql+asyncpg://user:pass@host:5432/db
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/reviewpulse"

    # --- Redis / Celery broker ---
    redis_url: str = "redis://localhost:6379/0"

    # --- LLM providers ---
    # Pick which adapter is the default; either provider can be selected per-call.
    llm_provider: str = "gemini"          # "anthropic" | "gemini"
    anthropic_api_key: str = ""
    gemini_api_key: str = ""
    llm_model_anthropic: str = "claude-3-5-haiku-20241022"
    llm_model_gemini: str = "gemini-1.5-flash"
    embedding_model: str = "gemini-embedding"  # which model produces vectors
    embedding_dim: int = 768                    # MUST match the DB vector(N) column

    # --- Auth (Supabase) ---
    # Supabase signs user JWTs with this secret (HS256). We verify tokens with it
    # so we can trust the author_id inside — we never trust an id from the URL.
    supabase_jwt_secret: str = "dev-insecure-secret-change-me"

    # --- Misc ---
    cors_origins: str = "http://localhost:5173"  # comma-separated; the Vercel URL goes here in prod
    webhook_secret: str = "dev-webhook-hmac-secret"  # used to sign completion webhooks (N10)
    environment: str = "development"


@lru_cache
def get_settings() -> Settings:
    # lru_cache => parsed once, reused everywhere. Import this, don't construct Settings directly.
    return Settings()
