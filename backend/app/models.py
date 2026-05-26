"""
Phase 1 data model.

Design goals:
- Separate raw reviews from LLM analysis and embeddings so re-analysis is safe and auditable.
- Enforce idempotency at the DB layer (`review_hash` unique).
- Keep explicit `author_id` on tenant-owned tables to make query scoping and future RLS simple.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Sentiment(str, Enum):
    """Allowed sentiment labels returned by analysis."""
    POSITIVE = "positive"
    MIXED = "mixed"
    NEGATIVE = "negative"


class JobStatus(str, Enum):
    """Lifecycle states for asynchronous ingestion jobs."""
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


class Author(Base):
    """Tenant/account owner. Every book and review is scoped to one author."""
    __tablename__ = "authors"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    auth_user_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    books: Mapped[list[Book]] = relationship(back_populates="author", cascade="all, delete-orphan")


class Book(Base):
    """A catalog title owned by a single author."""
    __tablename__ = "books"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    author_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("authors.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    isbn: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    author: Mapped[Author] = relationship(back_populates="books")
    reviews: Mapped[list[Review]] = relationship(back_populates="book", cascade="all, delete-orphan")
    jobs: Mapped[list[IngestionJob]] = relationship(back_populates="book", cascade="all, delete-orphan")


class Review(Base):
    """Raw ingested review text and metadata (source of truth)."""
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("review_hash", name="uq_reviews_review_hash"),
        Index("ix_reviews_author_book_date", "author_id", "book_id", "review_date"),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    book_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("authors.id", ondelete="CASCADE"), nullable=False
    )

    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    review_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    reviewer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    review_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(64), default="synthetic", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    book: Mapped[Book] = relationship(back_populates="reviews")
    analysis: Mapped[ReviewAnalysis | None] = relationship(
        back_populates="review", cascade="all, delete-orphan", uselist=False
    )
    embedding: Mapped[ReviewEmbedding | None] = relationship(
        back_populates="review", cascade="all, delete-orphan", uselist=False
    )


class ReviewAnalysis(Base):
    """Structured LLM output for a review (separate so re-analysis is safe)."""
    __tablename__ = "review_analysis"
    __table_args__ = (
        UniqueConstraint("review_id", name="uq_review_analysis_review_id"),
        Index("ix_review_analysis_sentiment", "sentiment"),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    review_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("reviews.id", ondelete="CASCADE"), nullable=False
    )

    sentiment: Mapped[Sentiment] = mapped_column(SAEnum(Sentiment), nullable=False)
    sentiment_confidence: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False)
    themes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)

    ai_generated_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    ai_confidence: Mapped[float] = mapped_column(Numeric(4, 3), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)

    actionable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    actionability_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    model_provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model_name: Mapped[str] = mapped_column(String(128), nullable=False)
    tokens_in: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    review: Mapped[Review] = relationship(back_populates="analysis")


class ReviewEmbedding(Base):
    """Vector representation of a review used by semantic search."""
    __tablename__ = "review_embeddings"
    __table_args__ = (
        UniqueConstraint("review_id", name="uq_review_embeddings_review_id"),
        Index("ix_review_embeddings_author_book", "author_id", "book_id"),
    )

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    review_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("reviews.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("authors.id", ondelete="CASCADE"), nullable=False
    )
    book_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )

    embedding: Mapped[Any] = mapped_column(Vector(768), nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    review: Mapped[Review] = relationship(back_populates="embedding")


class IngestionJob(Base):
    """Tracks progress and outcome for an ingest/analyze run per book."""
    __tablename__ = "ingestion_jobs"
    __table_args__ = (Index("ix_ingestion_jobs_author_status", "author_id", "status"),)

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    author_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("authors.id", ondelete="CASCADE"), nullable=False
    )
    book_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("books.id", ondelete="CASCADE"), nullable=False
    )

    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus), nullable=False, default=JobStatus.QUEUED
    )
    total_found: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    new_inserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    analyzed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    book: Mapped[Book] = relationship(back_populates="jobs")
