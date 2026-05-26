"""
Database plumbing: one async engine, one session factory, one FastAPI dependency.

Why async: a single FastAPI worker can handle many concurrent requests because while
one request waits on the database, the event loop serves others. SQLAlchemy 2.0's
async API + asyncpg is the Tweeds stack, so we match it.

The `get_db` dependency is how every route gets a session: FastAPI calls it, hands the
session to the route, and guarantees it's closed afterward (even if the route errors).
"""
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# echo=True in dev prints the SQL it runs — useful while learning, noisy in prod.
engine = create_async_engine(
    settings.database_url,
    echo=(settings.environment == "development"),
    pool_pre_ping=True,  # silently reconnect if the connection went stale (free-tier DBs nap)
)

# expire_on_commit=False => objects stay usable after commit; convenient with async.
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    """All ORM models inherit from this. SQLAlchemy collects their table definitions here."""
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency. Usage in a route: `db: AsyncSession = Depends(get_db)`."""
    async with SessionLocal() as session:
        yield session
