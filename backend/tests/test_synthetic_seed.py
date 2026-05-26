from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base
from app.models import Author, Book, Review
from app.services.synthetic_seed import build_synthetic_catalog, seed_synthetic_catalog


def test_build_synthetic_catalog_shape():
    data = build_synthetic_catalog(
        seed=7,
        author_count=3,
        books_per_author=2,
        reviews_per_book_min=10,
        reviews_per_book_max=12,
    )

    assert len(data) == 3
    assert all(len(a.books) == 2 for a in data)
    assert all(
        10 <= len(book.reviews) <= 12
        for author in data
        for book in author.books
    )


async def _row_counts(session):
    author_count = await session.scalar(select(func.count(Author.id)))
    book_count = await session.scalar(select(func.count(Book.id)))
    review_count = await session.scalar(select(func.count(Review.id)))
    return int(author_count or 0), int(book_count or 0), int(review_count or 0)


async def _seed_once(session):
    return await seed_synthetic_catalog(
        session,
        seed=11,
        author_count=3,
        books_per_author=2,
        reviews_per_book_min=8,
        reviews_per_book_max=10,
    )


async def _run_idempotency_case():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        first = await _seed_once(session)
        counts_after_first = await _row_counts(session)

    async with session_factory() as session:
        second = await _seed_once(session)
        counts_after_second = await _row_counts(session)

    await engine.dispose()

    assert first["created_authors"] == 3
    assert first["created_books"] == 6
    assert first["created_reviews"] > 0
    assert second == {"created_authors": 0, "created_books": 0, "created_reviews": 0}
    assert counts_after_first == counts_after_second


def test_seed_synthetic_catalog_idempotent():
    import asyncio

    asyncio.run(_run_idempotency_case())
