"""Ingestion pipeline orchestration with idempotent processing semantics."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.service import analyze_review, embed_text
from app.models import (
    Book,
    IngestionJob,
    JobStatus,
    Review,
    ReviewAnalysis,
    ReviewEmbedding,
    Sentiment,
)


@dataclass(frozen=True)
class IngestReviewInput:
    external_id: str
    reviewer_name: str
    rating: int
    title: str
    body: str
    review_date: datetime
    source: str = "synthetic"


def _review_hash(book_key: str, external_id: str, body: str) -> str:
    normalized = " ".join(body.lower().split())
    raw = f"{book_key}|{external_id}|{normalized}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def enqueue_ingestion_job(*, db: AsyncSession, author_id: str, book_id: str) -> IngestionJob:
    """Insert a queued ingestion job and commit so callers can return job id immediately."""
    job = IngestionJob(author_id=author_id, book_id=book_id, status=JobStatus.QUEUED)
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def process_ingestion_job(
    *,
    db: AsyncSession,
    job_id: str,
    reviews: list[IngestReviewInput],
    provider_name: str | None = None,
) -> IngestionJob:
    """Process one ingestion job with idempotent review/analysis/embedding writes."""
    job = await db.get(IngestionJob, job_id)
    if job is None:
        raise ValueError(f"Job not found: {job_id}")

    book = await db.get(Book, job.book_id)
    if book is None:
        raise ValueError(f"Book not found for job: {job.book_id}")

    job.status = JobStatus.RUNNING
    job.started_at = datetime.now(timezone.utc)
    job.total_found = len(reviews)
    job.new_inserted = 0
    job.analyzed = 0
    job.failed = 0
    job.error = None
    await db.commit()

    book_key = book.isbn or book.title
    new_inserted = 0
    analyzed_count = 0
    failed_count = 0
    last_error: str | None = None

    for item in reviews:
        try:
            async with db.begin_nested():
                review_hash = _review_hash(book_key, item.external_id, item.body)

                review = await db.scalar(select(Review).where(Review.review_hash == review_hash))
                if review is None:
                    review = Review(
                        author_id=job.author_id,
                        book_id=job.book_id,
                        external_id=item.external_id,
                        review_hash=review_hash,
                        reviewer_name=item.reviewer_name,
                        rating=item.rating,
                        title=item.title,
                        body=item.body,
                        review_date=item.review_date,
                        source=item.source,
                    )
                    db.add(review)
                    await db.flush()
                    new_inserted += 1

                analysis = await db.scalar(
                    select(ReviewAnalysis).where(ReviewAnalysis.review_id == review.id)
                )
                if analysis is None:
                    analyzed = analyze_review(
                        review_title=item.title,
                        review_body=item.body,
                        provider_name=provider_name,
                    )
                    analysis = ReviewAnalysis(
                        review_id=review.id,
                        sentiment=Sentiment(analyzed.result.sentiment),
                        sentiment_confidence=analyzed.result.sentiment_confidence,
                        themes=analyzed.result.themes,
                        ai_generated_flag=analyzed.result.ai_generated_flag,
                        ai_confidence=analyzed.result.ai_confidence,
                        summary=analyzed.result.summary,
                        actionable=analyzed.result.actionable,
                        actionability_reason=analyzed.result.actionability_reason,
                        model_provider=analyzed.provider,
                        model_name=analyzed.model,
                        tokens_in=analyzed.usage.tokens_in,
                        tokens_out=analyzed.usage.tokens_out,
                        cost_usd=analyzed.usage.cost_usd,
                    )
                    db.add(analysis)

                embedding = await db.scalar(
                    select(ReviewEmbedding).where(ReviewEmbedding.review_id == review.id)
                )
                if embedding is None:
                    embedded = embed_text(text=item.body, provider_name=provider_name)
                    embedding = ReviewEmbedding(
                        review_id=review.id,
                        author_id=job.author_id,
                        book_id=job.book_id,
                        embedding=embedded.vector,
                        embedding_model=embedded.model,
                    )
                    db.add(embedding)

                analyzed_count += 1
        except Exception as exc:  # noqa: BLE001
            failed_count += 1
            last_error = str(exc)

    job.finished_at = datetime.now(timezone.utc)
    job.new_inserted = new_inserted
    job.analyzed = analyzed_count
    job.failed = failed_count
    job.error = last_error
    job.status = JobStatus.PARTIAL if failed_count > 0 else JobStatus.COMPLETED
    await db.commit()
    await db.refresh(job)
    return job
