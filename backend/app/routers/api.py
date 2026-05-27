"""Core API routes for catalog, ingestion jobs, review listing, and semantic search."""
from __future__ import annotations

import hmac
import random
from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from collections import defaultdict

from sqlalchemy import Select, and_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import SessionLocal, get_db
from app.llm.service import embed_text
from app.models import Author, Book, IngestionJob, Review, ReviewAnalysis, ReviewEmbedding, Sentiment
from app.workers.pipeline import IngestReviewInput, enqueue_ingestion_job, process_ingestion_job

router = APIRouter(prefix="/api", tags=["reviewpulse"])
settings = get_settings()


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


@router.get("/books/{book_id}/trends")
async def get_book_trends(
    book_id: str,
    author_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """F5: Sentiment-over-time series, theme-frequency-over-time, and week-over-week delta.
    Scoped to author_id for multi-tenant isolation.
    """
    book = await db.scalar(select(Book).where(Book.id == book_id, Book.author_id == author_id))
    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    rows = (
        await db.execute(
            select(Review, ReviewAnalysis)
            .outerjoin(ReviewAnalysis, ReviewAnalysis.review_id == Review.id)
            .where(Review.book_id == book_id, Review.author_id == author_id)
            .where(ReviewAnalysis.id.isnot(None))
            .order_by(Review.review_date.asc())
        )
    ).all()

    def _week_key(dt: datetime) -> str:
        day = dt.weekday()  # Monday=0
        monday = dt - timedelta(days=day)
        return monday.strftime("%Y-%m-%d")

    # Build weekly sentiment buckets
    sentiment_by_week: dict[str, dict[str, int]] = defaultdict(lambda: {"positive": 0, "mixed": 0, "negative": 0, "total": 0})
    theme_by_week: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for review, analysis in rows:
        if not review.review_date:
            continue
        wk = _week_key(review.review_date)
        sent = analysis.sentiment.value
        sentiment_by_week[wk][sent] += 1
        sentiment_by_week[wk]["total"] += 1
        for theme in (analysis.themes or []):
            theme_by_week[wk][theme] += 1

    # Sentiment over time — sorted list of weekly data points
    sentiment_series = [
        {
            "week": wk,
            "positive": v["positive"],
            "mixed": v["mixed"],
            "negative": v["negative"],
            "total": v["total"],
        }
        for wk, v in sorted(sentiment_by_week.items())
    ]

    # Theme frequency over time — top themes per week (last 4 weeks)
    sorted_weeks = sorted(theme_by_week.keys())[-4:]
    theme_series = [
        {
            "week": wk,
            "themes": dict(sorted(theme_by_week[wk].items(), key=lambda x: -x[1])[:8]),
        }
        for wk in sorted_weeks
    ]

    # Week-over-week delta — compare last two weeks
    wow = None
    if len(sentiment_series) >= 2:
        prev = sentiment_series[-2]
        curr = sentiment_series[-1]
        prev_pos_rate = prev["positive"] / prev["total"] if prev["total"] else 0
        curr_pos_rate = curr["positive"] / curr["total"] if curr["total"] else 0
        prev_neg_rate = prev["negative"] / prev["total"] if prev["total"] else 0
        curr_neg_rate = curr["negative"] / curr["total"] if curr["total"] else 0
        wow = {
            "this_week": curr["week"],
            "last_week": prev["week"],
            "positive_delta_pct": round((curr_pos_rate - prev_pos_rate) * 100, 1),
            "negative_delta_pct": round((curr_neg_rate - prev_neg_rate) * 100, 1),
            "total_delta": curr["total"] - prev["total"],
        }

    # Theme WoW — rising and falling themes between last two weeks
    theme_wow = None
    if len(sorted_weeks) >= 2:
        curr_themes = theme_by_week[sorted_weeks[-1]]
        prev_themes = theme_by_week[sorted_weeks[-2]]
        all_themes = set(curr_themes) | set(prev_themes)
        theme_wow = sorted(
            [
                {
                    "theme": t,
                    "this_week": curr_themes.get(t, 0),
                    "last_week": prev_themes.get(t, 0),
                    "delta": curr_themes.get(t, 0) - prev_themes.get(t, 0),
                }
                for t in all_themes
            ],
            key=lambda x: -abs(x["delta"]),
        )[:8]

    return {
        "book_id": book_id,
        "sentiment_over_time": sentiment_series,
        "theme_frequency_over_time": theme_series,
        "week_over_week": wow,
        "theme_week_over_week": theme_wow,
    }


def _build_cron_reviews(batch_date: str, count: int) -> list[IngestReviewInput]:
    """Generate synthetic reviews with date-stamped IDs so each daily cron run adds new reviews,
    but re-running the same day is fully idempotent — body and rating are derived deterministically
    from the external_id so review_hash is stable across repeated runs."""
    import hashlib as _hl
    snippets = [
        "Loved the pacing and character growth.",
        "Interesting ideas, but the ending felt rushed.",
        "Dialogue felt flat and repetitive.",
        "Great worldbuilding and emotional payoff.",
        "The story kept me hooked until the very last page.",
    ]
    ratings = [1, 2, 3, 4, 5]
    now = datetime.now(timezone.utc)

    def _stable_pick(seed: str, lst: list):
        idx = int(_hl.md5(seed.encode()).hexdigest(), 16) % len(lst)
        return lst[idx]

    return [
        IngestReviewInput(
            external_id=f"cron-{batch_date}-{i}",
            reviewer_name=f"Reader {batch_date}-{i}",
            rating=_stable_pick(f"rating-{batch_date}-{i}", ratings),
            title=f"Cron review {batch_date}-{i}",
            body=_stable_pick(f"body-{batch_date}-{i}", snippets),
            review_date=now - timedelta(hours=_stable_pick(f"hr-{batch_date}-{i}", list(range(24)))),
            source="synthetic-cron",
        )
        for i in range(1, count + 1)
    ]


@router.post("/admin/refresh")
async def admin_refresh_all(
    request: Request,
    background_tasks: BackgroundTasks,
    synthetic_count: int = Query(default=3, ge=1, le=20),
    db: AsyncSession = Depends(get_db),
):
    """Trigger re-ingest for every book across all authors.
    Protected by X-Admin-Secret header — called by the GitHub Actions daily cron.
    Uses date-stamped external IDs so each day's run adds new reviews idempotently.
    """
    secret = request.headers.get("X-Admin-Secret", "")
    if not hmac.compare_digest(secret, settings.admin_secret):
        raise HTTPException(status_code=403, detail="Forbidden")

    books = (await db.execute(select(Book))).scalars().all()
    if not books:
        return {"triggered": 0, "jobs": []}

    batch_date = datetime.now(timezone.utc).strftime("%Y%m%d")
    jobs_out = []
    for book in books:
        reviews = _build_cron_reviews(batch_date, synthetic_count)
        job = await enqueue_ingestion_job(db=db, author_id=book.author_id, book_id=book.id)
        background_tasks.add_task(_run_job_background, job.id, reviews, None)
        jobs_out.append({"job_id": job.id, "book_id": book.id, "author_id": book.author_id})

    return {"triggered": len(jobs_out), "batch_date": batch_date, "jobs": jobs_out}
