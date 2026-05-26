"""CLI utility to seed synthetic catalog data into the configured database."""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import text

from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.services.synthetic_seed import seed_synthetic_catalog


async def _ensure_db_ready(init_schema: bool) -> None:
    settings = get_settings()
    if "localhost:5432/reviewpulse" in settings.database_url:
        raise RuntimeError(
            "DATABASE_URL is using the local default. Create backend/.env from "
            ".env.example and set DATABASE_URL to your Supabase connection string."
        )

    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))
        if init_schema:
            await conn.run_sync(Base.metadata.create_all)


async def _run(args: argparse.Namespace) -> None:
    await _ensure_db_ready(init_schema=args.init_schema)
    async with SessionLocal() as db:
        result = await seed_synthetic_catalog(
            db,
            seed=args.seed,
            author_count=args.authors,
            books_per_author=args.books,
            reviews_per_book_min=args.min_reviews,
            reviews_per_book_max=args.max_reviews,
        )
    print(result)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed synthetic ReviewPulse catalog")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--authors", type=int, default=3)
    parser.add_argument("--books", type=int, default=2)
    parser.add_argument("--min-reviews", type=int, default=25)
    parser.add_argument("--max-reviews", type=int, default=40)
    parser.add_argument(
        "--init-schema",
        action="store_true",
        help="Create tables from ORM metadata before seeding.",
    )
    args = parser.parse_args()
    try:
        asyncio.run(_run(args))
    except RuntimeError as exc:
        print(f"Error: {exc}")


if __name__ == "__main__":
    main()
