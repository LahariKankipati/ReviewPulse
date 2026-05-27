"""Core API routes for catalog, ingestion jobs, review listing, and semantic search."""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import Select, and_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal, get_db
from app.llm.service import embed_text
from app.models import Author, Book, IngestionJob, Review, ReviewAnalysis, ReviewEmbedding, Sentiment
from app.workers.pipeline import IngestReviewInput, enqueue_ingestion_job, process_ingestion_job

router = APIRouter(prefix="/api", tags=["reviewpulse"])


class AuthorCreateRequest(BaseModel):
    auth_user_id: str = Field(min_length=3, max_length=128)
    email: str
    name: str | None = None


class BookCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    isbn: str | None = None
    source_url: str | None = None


class IngestReviewPayload(BaseModel):
    external_id: str
    reviewer_name: str
    rating: int = Field(ge=1, le=5)
    title: str
    body: str
    review_date: datetime
    source: str = "synthetic"


class TriggerIngestRequest(BaseModel):
    provider_name: str | None = None
    reviews: list[IngestReviewPayload] | None = None
    synthetic_count: int = Field(default=0, ge=0, le=150)


class SearchRequest(BaseModel):
    query: str
    top_k: int = Field(default=10, ge=1, le=50)


class LoginRequest(BaseModel):
    email: str


def _build_synthetic_reviews(count: int) -> list[IngestReviewInput]:
    if count <= 0:
        return []
    snippets = [
        "Loved the pacing and character growth.",
        "Interesting ideas, but the ending felt rushed.",
        "Dialogue felt flat and repetitive.",
        "Great worldbuilding and emotional payoff.",
    ]
    now = datetime.now(timezone.utc)
    rows: list[IngestReviewInput] = []
    for i in range(1, count + 1):
        rows.append(
            IngestReviewInput(
                external_id=f"synthetic-{i}",
                reviewer_name=f"Reader {i}",
                rating=random.choice([1, 2, 3, 4, 5]),
                title=f"Synthetic review {i}",
                body=random.choice(snippets),
                review_date=now - timedelta(days=random.randint(0, 45), hours=random.randint(0, 23)),
                source="synthetic",
            )
        )
    return rows


async def _run_job_background(job_id: str, reviews: list[IngestReviewInput], provider_name: str | None) -> None:
    async with SessionLocal() as db:
        await process_ingestion_job(
            db=db,
            job_id=job_id,
            reviews=reviews,
            provider_name=provider_name,
        )


@router.post("/authors")
async def create_author(payload: AuthorCreateRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.scalar(select(Author).where(Author.auth_user_id == payload.auth_user_id))
    if existing is not None:
        raise HTTPException(status_code=409, detail="Author with auth_user_id already exists")

    author = Author(
        auth_user_id=payload.auth_user_id,
        email=str(payload.email),
        name=payload.name,
        current_login_at=datetime.now(timezone.utc),
    )
    db.add(author)
    await db.commit()
    await db.refresh(author)
    return {
        "id": author.id,
        "auth_user_id": author.auth_user_id,
        "email": author.email,
        "name": author.name,
        "last_login_at": author.last_login_at,
        "current_login_at": author.current_login_at,
    }


@router.post("/auth/login")
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    author = await db.scalar(select(Author).where(Author.email == payload.email))
    if author is None:
        raise HTTPException(status_code=404, detail="No account found with this email. Please register first.")
    prev = author.current_login_at
    author.last_login_at = prev
    author.current_login_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(author)
    return {
        "id": author.id,
        "auth_user_id": author.auth_user_id,
        "email": author.email,
        "name": author.name,
        "last_login_at": author.last_login_at,
        "current_login_at": author.current_login_at,
    }


@router.get("/authors/{author_id}/books")
async def list_author_books(author_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Book).where(Book.author_id == author_id).order_by(Book.created_at))
    books = result.scalars().all()
    return {
        "items": [{"id": b.id, "author_id": b.author_id, "title": b.title, "isbn": b.isbn} for b in books]
    }


@router.post("/authors/{author_id}/books")
async def add_book(author_id: str, payload: BookCreateRequest, db: AsyncSession = Depends(get_db)):
    author = await db.get(Author, author_id)
    if author is None:
        raise HTTPException(status_code=404, detail="Author not found")

    if payload.isbn:
        dup = await db.scalar(
            select(Book).where(Book.author_id == author_id, Book.isbn == payload.isbn)
        )
        if dup is not None:
            return {"id": dup.id, "author_id": dup.author_id, "title": dup.title, "isbn": dup.isbn}

    book = Book(author_id=author_id, title=payload.title, isbn=payload.isbn, source_url=payload.source_url)
    db.add(book)
    await db.commit()
    await db.refresh(book)
    return {"id": book.id, "author_id": book.author_id, "title": book.title, "isbn": book.isbn}


@router.delete("/books/{book_id}")
async def delete_book(book_id: str, author_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    book = await db.scalar(select(Book).where(Book.id == book_id, Book.author_id == author_id))
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")
    await db.delete(book)
    await db.commit()
    return {"deleted": True}


@router.post("/books/{book_id}/ingest")
async def trigger_ingestion(
    book_id: str,
    payload: TriggerIngestRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    book = await db.get(Book, book_id)
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    reviews = [IngestReviewInput(**r.model_dump()) for r in (payload.reviews or [])]
    if payload.synthetic_count > 0:
        reviews.extend(_build_synthetic_reviews(payload.synthetic_count))
    if not reviews:
        raise HTTPException(status_code=400, detail="Provide reviews or synthetic_count > 0")

    job = await enqueue_ingestion_job(db=db, author_id=book.author_id, book_id=book_id)
    background_tasks.add_task(_run_job_background, job.id, reviews, payload.provider_name)
    return {"job_id": job.id, "status": job.status.value}


@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await db.get(IngestionJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "id": job.id,
        "author_id": job.author_id,
        "book_id": job.book_id,
        "status": job.status.value,
        "total_found": job.total_found,
        "new_inserted": job.new_inserted,
        "analyzed": job.analyzed,
        "failed": job.failed,
        "error": job.error,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


@router.get("/books/{book_id}/reviews")
async def list_reviews(
    book_id: str,
    author_id: str = Query(...),
    sentiment: str | None = None,
    ai_flagged: bool | None = None,
    actionable: bool | None = None,
    theme: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort: str = Query("newest", pattern="^(newest|oldest|rating_desc|rating_asc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    q: Select = (
        select(Review, ReviewAnalysis)
        .outerjoin(ReviewAnalysis, ReviewAnalysis.review_id == Review.id)
        .where(Review.book_id == book_id, Review.author_id == author_id)
    )

    if sentiment:
        q = q.where(ReviewAnalysis.sentiment == Sentiment(sentiment))
    if ai_flagged is not None:
        q = q.where(ReviewAnalysis.ai_generated_flag == ai_flagged)
    if actionable is not None:
        q = q.where(ReviewAnalysis.actionable == actionable)
    if date_from is not None:
        q = q.where(Review.review_date >= date_from)
    if date_to is not None:
        q = q.where(Review.review_date <= date_to)
    if theme:
        q = q.where(text("review_analysis.themes::text ILIKE :theme")).params(theme=f"%{theme}%")

    if sort == "newest":
        q = q.order_by(Review.review_date.desc().nullslast())
    elif sort == "oldest":
        q = q.order_by(Review.review_date.asc().nullslast())
    elif sort == "rating_desc":
        q = q.order_by(Review.rating.desc().nullslast())
    else:
        q = q.order_by(Review.rating.asc().nullslast())

    q = q.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(q)).all()

    out = []
    for review, analysis in rows:
        out.append(
            {
                "review_id": review.id,
                "book_id": review.book_id,
                "external_id": review.external_id,
                "rating": review.rating,
                "title": review.title,
                "body": review.body,
                "review_date": review.review_date,
                "source": review.source,
                "analysis": None
                if analysis is None
                else {
                    "sentiment": analysis.sentiment.value,
                    "sentiment_confidence": float(analysis.sentiment_confidence),
                    "themes": analysis.themes,
                    "ai_generated_flag": analysis.ai_generated_flag,
                    "ai_confidence": float(analysis.ai_confidence),
                    "summary": analysis.summary,
                    "actionable": analysis.actionable,
                    "actionability_reason": analysis.actionability_reason,
                    "cost_usd": float(analysis.cost_usd),
                    "tokens_in": analysis.tokens_in,
                    "tokens_out": analysis.tokens_out,
                    "model": analysis.model_name,
                },
            }
        )

    return {"items": out, "page": page, "page_size": page_size}


@router.post("/authors/{author_id}/search")
async def semantic_search(author_id: str, payload: SearchRequest, db: AsyncSession = Depends(get_db)):
    query_emb = embed_text(text=payload.query)

    # Postgres/pgvector path.
    try:
        sql = text(
            """
            SELECT
                r.id AS review_id,
                r.book_id AS book_id,
                LEFT(r.body, 220) AS snippet,
                1 - (e.embedding <=> CAST(:query_vec AS vector)) AS score
            FROM review_embeddings e
            JOIN reviews r ON r.id = e.review_id
            WHERE e.author_id = :author_id
            ORDER BY e.embedding <=> CAST(:query_vec AS vector)
            LIMIT :top_k
            """
        )
        vec_literal = "[" + ",".join(f"{x:.8f}" for x in query_emb.vector) + "]"
        rows = (
            await db.execute(
                sql,
                {"author_id": author_id, "query_vec": vec_literal, "top_k": payload.top_k},
            )
        ).mappings().all()
        return {
            "query": payload.query,
            "provider": query_emb.provider,
            "model": query_emb.model,
            "items": [dict(r) for r in rows],
        }
    except Exception:
        # Fallback path (useful in local sqlite tests).
        rows = (
            await db.execute(
                select(ReviewEmbedding, Review)
                .join(Review, Review.id == ReviewEmbedding.review_id)
                .where(ReviewEmbedding.author_id == author_id)
            )
        ).all()

        q = np.array(query_emb.vector, dtype=float)
        q_norm = np.linalg.norm(q) or 1.0

        scored = []
        for emb, review in rows:
            v = np.array(emb.embedding, dtype=float)
            score = float(np.dot(q, v) / ((q_norm * (np.linalg.norm(v) or 1.0))))
            scored.append(
                {
                    "review_id": review.id,
                    "book_id": review.book_id,
                    "snippet": (review.body or "")[:220],
                    "score": score,
                }
            )

        scored.sort(key=lambda x: x["score"], reverse=True)
        return {
            "query": payload.query,
            "provider": query_emb.provider,
            "model": query_emb.model,
            "items": scored[: payload.top_k],
        }
