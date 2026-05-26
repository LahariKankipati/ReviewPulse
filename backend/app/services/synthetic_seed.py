"""Synthetic review data generation + idempotent DB seeding."""
from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Author, Book, Review


@dataclass(frozen=True)
class SyntheticReviewInput:
    external_id: str
    reviewer_name: str
    rating: int
    title: str
    body: str
    review_date: datetime
    source: str = "synthetic"


@dataclass(frozen=True)
class SyntheticBookInput:
    title: str
    isbn: str
    source_url: str
    reviews: list[SyntheticReviewInput]


@dataclass(frozen=True)
class SyntheticAuthorInput:
    auth_user_id: str
    email: str
    name: str
    books: list[SyntheticBookInput]


# Theme and tone snippets are intentionally simple for deterministic generation.
POSITIVE_SNIPPETS = [
    "I loved the pacing and couldn't stop reading.",
    "The characters felt real and emotionally grounded.",
    "Strong ending that paid off earlier setup.",
    "The worldbuilding was clear and immersive.",
]
MIXED_SNIPPETS = [
    "Good concept, but the middle chapters dragged.",
    "I liked the protagonist, though the ending felt rushed.",
    "Fun read overall, but some plot points were predictable.",
    "Great premise with uneven execution in parts.",
]
NEGATIVE_SNIPPETS = [
    "Pacing was too slow and hard to stay engaged.",
    "Dialogue felt repetitive and unnatural.",
    "The ending didn't resolve key story threads.",
    "I struggled to connect with the main characters.",
]

REVIEWER_NAMES = [
    "Alex M.",
    "Jordan Lee",
    "Priya N.",
    "Sam T.",
    "Morgan K.",
    "Taylor R.",
    "Casey D.",
    "Avery P.",
]


def _review_hash(book_key: str, external_id: str, body: str) -> str:
    """Stable hash used for ingest idempotency."""
    normalized = " ".join(body.lower().split())
    raw = f"{book_key}|{external_id}|{normalized}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_synthetic_catalog(
    *,
    seed: int = 42,
    author_count: int = 3,
    books_per_author: int = 2,
    reviews_per_book_min: int = 25,
    reviews_per_book_max: int = 40,
) -> list[SyntheticAuthorInput]:
    """Create a deterministic multi-tenant synthetic catalog for local/dev seeding."""
    rng = random.Random(seed)
    now = datetime.now(timezone.utc)

    authors: list[SyntheticAuthorInput] = []
    for a_idx in range(1, author_count + 1):
        books: list[SyntheticBookInput] = []
        for b_idx in range(1, books_per_author + 1):
            title = f"Author {a_idx} Book {b_idx}"
            isbn = f"978000{a_idx:02d}{b_idx:02d}{rng.randint(100, 999)}"
            source_url = f"https://example.com/books/{a_idx}/{b_idx}"

            review_count = rng.randint(reviews_per_book_min, reviews_per_book_max)
            reviews: list[SyntheticReviewInput] = []
            for r_idx in range(1, review_count + 1):
                sentiment_bucket = rng.choices(
                    ["positive", "mixed", "negative"], weights=[0.55, 0.30, 0.15], k=1
                )[0]
                if sentiment_bucket == "positive":
                    rating = rng.choice([4, 5])
                    snippet = rng.choice(POSITIVE_SNIPPETS)
                elif sentiment_bucket == "mixed":
                    rating = rng.choice([2, 3, 4])
                    snippet = rng.choice(MIXED_SNIPPETS)
                else:
                    rating = rng.choice([1, 2])
                    snippet = rng.choice(NEGATIVE_SNIPPETS)

                title_text = f"Review {a_idx}-{b_idx}-{r_idx}"
                body = (
                    f"{snippet} Themes touched: pacing, characters, ending. "
                    f"Book reference: {title}."
                )

                days_ago = rng.randint(0, 180)
                review_date = now - timedelta(days=days_ago, hours=rng.randint(0, 23))
                external_id = f"ext-a{a_idx}-b{b_idx}-r{r_idx}"

                reviews.append(
                    SyntheticReviewInput(
                        external_id=external_id,
                        reviewer_name=rng.choice(REVIEWER_NAMES),
                        rating=rating,
                        title=title_text,
                        body=body,
                        review_date=review_date,
                    )
                )

            books.append(
                SyntheticBookInput(
                    title=title,
                    isbn=isbn,
                    source_url=source_url,
                    reviews=reviews,
                )
            )

        authors.append(
            SyntheticAuthorInput(
                auth_user_id=f"synthetic-auth-{a_idx}",
                email=f"author{a_idx}@reviewpulse.local",
                name=f"Synthetic Author {a_idx}",
                books=books,
            )
        )

    return authors


async def seed_synthetic_catalog(
    db: AsyncSession,
    *,
    seed: int = 42,
    author_count: int = 3,
    books_per_author: int = 2,
    reviews_per_book_min: int = 25,
    reviews_per_book_max: int = 40,
) -> dict[str, int]:
    """Seed synthetic tenants/books/reviews with idempotent insert semantics.

    Idempotency strategy:
    - Author upsert keyed by unique `auth_user_id`.
    - Book lookup keyed by (`author_id`, `isbn`).
    - Review insert keyed by unique `review_hash`.
    """
    data = build_synthetic_catalog(
        seed=seed,
        author_count=author_count,
        books_per_author=books_per_author,
        reviews_per_book_min=reviews_per_book_min,
        reviews_per_book_max=reviews_per_book_max,
    )

    created_authors = 0
    created_books = 0
    created_reviews = 0

    for author_input in data:
        author = await db.scalar(
            select(Author).where(Author.auth_user_id == author_input.auth_user_id)
        )
        if author is None:
            author = Author(
                auth_user_id=author_input.auth_user_id,
                email=author_input.email,
                name=author_input.name,
            )
            db.add(author)
            await db.flush()
            created_authors += 1

        for book_input in author_input.books:
            book = await db.scalar(
                select(Book).where(
                    Book.author_id == author.id,
                    Book.isbn == book_input.isbn,
                )
            )
            if book is None:
                book = Book(
                    author_id=author.id,
                    title=book_input.title,
                    isbn=book_input.isbn,
                    source_url=book_input.source_url,
                )
                db.add(book)
                await db.flush()
                created_books += 1

            book_key = book.isbn or book.title
            for review_input in book_input.reviews:
                review_hash = _review_hash(book_key, review_input.external_id, review_input.body)
                exists = await db.scalar(
                    select(func.count(Review.id)).where(Review.review_hash == review_hash)
                )
                if exists:
                    continue

                db.add(
                    Review(
                        author_id=author.id,
                        book_id=book.id,
                        external_id=review_input.external_id,
                        review_hash=review_hash,
                        reviewer_name=review_input.reviewer_name,
                        rating=review_input.rating,
                        title=review_input.title,
                        body=review_input.body,
                        review_date=review_input.review_date,
                        source=review_input.source,
                    )
                )
                created_reviews += 1

    await db.commit()

    return {
        "created_authors": created_authors,
        "created_books": created_books,
        "created_reviews": created_reviews,
    }
