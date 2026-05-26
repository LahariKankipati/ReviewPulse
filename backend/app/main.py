"""FastAPI entrypoint with CORS, structured logging, and a deploy health endpoint."""
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
    """Application lifecycle hook for startup/shutdown logging."""
    logger.info("startup", extra={"environment": settings.environment})
    yield
    logger.info("shutdown")


app = FastAPI(title="ReviewPulse API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Liveness endpoint used by Render health checks and frontend smoke tests."""
    return {"status": "ok", "service": "reviewpulse", "env": settings.environment}
