"""
FastAPI application entrypoint. Phase 0 deliberately keeps this tiny: an app, CORS,
JSON logging, and a /health endpoint. The whole point of Phase 0 is to DEPLOY this
nearly-empty app to Render today, prove the pipe works end-to-end, and never again
worry "will it deploy?" — we only ever add features to something already live.

Routers (authors, books, jobs, reviews, search, ...) get plugged in here as we build
them in later phases. They're imported lazily-ish at the bottom so this file stays the
single, readable "table of contents" for the API.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.logging_config import configure_logging, get_logger

settings = get_settings()
configure_logging()
logger = get_logger("reviewpulse")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs once on startup / once on shutdown. Good place for warmup or pool checks.
    logger.info("startup", extra={"environment": settings.environment})
    yield
    logger.info("shutdown")


app = FastAPI(title="ReviewPulse API", version="0.1.0", lifespan=lifespan)

# The browser blocks cross-origin calls unless the server opts in. Our Vercel frontend
# lives on a different domain than the Render backend, so we must allow it explicitly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Render pings this to confirm the service is alive. Also our 'is it deployed?' check."""
    return {"status": "ok", "service": "reviewpulse", "env": settings.environment}


# --- Routers (added phase by phase) ---
# from app.routers import authors, books, jobs, reviews, search, trends
# app.include_router(authors.router)
# ...
