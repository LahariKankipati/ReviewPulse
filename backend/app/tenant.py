"""Tenant-scoped query helpers.

These helpers keep the author boundary explicit in query code. When routes are added,
we always use these scoped selectors instead of querying tables directly.
"""
from __future__ import annotations

from sqlalchemy import Select, select

from app.models import Book, Review


def scoped_books_query(author_id: str) -> Select[tuple[Book]]:
    """Return only books owned by the given author."""
    return select(Book).where(Book.author_id == author_id)


def scoped_reviews_query(author_id: str) -> Select[tuple[Review]]:
    """Return only reviews owned by the given author."""
    return select(Review).where(Review.author_id == author_id)
