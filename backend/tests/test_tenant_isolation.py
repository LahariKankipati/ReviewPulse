from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base
from app.models import Author, Book, Review
from app.tenant import scoped_books_query, scoped_reviews_query


@pytest.mark.asyncio
async def test_author_scoped_queries_do_not_leak_cross_tenant_data():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        author_a = Author(
            auth_user_id="auth-a",
            email="a@example.com",
            name="Author A",
        )
        author_b = Author(
            auth_user_id="auth-b",
            email="b@example.com",
            name="Author B",
        )
        session.add_all([author_a, author_b])
        await session.flush()

        book_a = Book(author_id=author_a.id, title="A Book", isbn="111")
        book_b = Book(author_id=author_b.id, title="B Book", isbn="222")
        session.add_all([book_a, book_b])
        await session.flush()

        session.add_all(
            [
                Review(
                    author_id=author_a.id,
                    book_id=book_a.id,
                    review_hash="hash-a",
                    body="Great pacing and characters",
                    review_date=datetime.now(timezone.utc),
                ),
                Review(
                    author_id=author_b.id,
                    book_id=book_b.id,
                    review_hash="hash-b",
                    body="Too slow for my taste",
                    review_date=datetime.now(timezone.utc),
                ),
            ]
        )
        await session.commit()

        books_for_a = (await session.execute(scoped_books_query(author_a.id))).scalars().all()
        reviews_for_a = (await session.execute(scoped_reviews_query(author_a.id))).scalars().all()

        assert len(books_for_a) == 1
        assert books_for_a[0].author_id == author_a.id

        assert len(reviews_for_a) == 1
        assert reviews_for_a[0].author_id == author_a.id
        assert reviews_for_a[0].review_hash == "hash-a"

    await engine.dispose()
