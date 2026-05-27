"""Create all database tables from ORM metadata (idempotent — safe to re-run)."""
import asyncio

from app import models  # noqa: F401 — registers all ORM models before create_all
from app.db import Base, engine


async def main() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Schema ready.")


if __name__ == "__main__":
    asyncio.run(main())
