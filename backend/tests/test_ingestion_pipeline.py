from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base
from app.models import Author, Book, IngestionJob, JobStatus, Review, ReviewAnalysis, ReviewEmbedding
from app.workers.pipeline import IngestReviewInput, enqueue_ingestion_job, process_ingestion_job


async def _seed_author_book(session):
    author = Author(auth_user_id="worker-a", email="worker-a@example.com", name="Worker A")
    session.add(author)
    await session.flush()

    book = Book(author_id=author.id, title="Worker Book", isbn="9780000000001")
    session.add(book)
    await session.commit()
    return author, book


def _sample_reviews() -> list[IngestReviewInput]:
    now = datetime.now(timezone.utc)
    return [
        IngestReviewInput(
            external_id="ext-1",
            reviewer_name="Alex",
            rating=5,
            title="Great read",
            body="Loved pacing and character depth.",
            review_date=now,
        ),
        IngestReviewInput(
            external_id="ext-2",
            reviewer_name="Sam",
            rating=2,
            title="Not for me",
            body="Slow pacing and weak ending.",
            review_date=now,
        ),
    ]


async def _setup_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, session_factory


def test_process_ingestion_job_completed_and_idempotent(monkeypatch):
    import asyncio

    from app.llm.schemas import AnalysisUsage, AnalyzeReviewResponse, EmbedResponse, ReviewAnalysisResult

    def fake_analyze(**kwargs):
        return AnalyzeReviewResponse(
            provider="mock",
            model="mock-model",
            result=ReviewAnalysisResult(
                sentiment="positive",
                sentiment_confidence=0.9,
                themes=["pacing"],
                ai_generated_flag=False,
                ai_confidence=0.1,
                summary="Good pacing.",
                actionable=True,
                actionability_reason="Keep pacing consistency.",
            ),
            usage=AnalysisUsage(tokens_in=10, tokens_out=5, cost_usd=0.0001),
        )

    def fake_embed(**kwargs):
        return EmbedResponse(provider="mock", model="mock-embed", vector=[0.1] * 768)

    monkeypatch.setattr("app.workers.pipeline.analyze_review", fake_analyze)
    monkeypatch.setattr("app.workers.pipeline.embed_text", fake_embed)

    async def run_case():
        engine, session_factory = await _setup_db()

        async with session_factory() as session:
            author, book = await _seed_author_book(session)
            job = await enqueue_ingestion_job(db=session, author_id=author.id, book_id=book.id)
            out = await process_ingestion_job(db=session, job_id=job.id, reviews=_sample_reviews())
            assert out.status == JobStatus.COMPLETED
            assert out.total_found == 2
            assert out.new_inserted == 2
            assert out.analyzed == 2
            assert out.failed == 0

        async with session_factory() as session:
            author = await session.scalar(select(Author).where(Author.auth_user_id == "worker-a"))
            book = await session.scalar(select(Book).where(Book.author_id == author.id))
            job2 = await enqueue_ingestion_job(db=session, author_id=author.id, book_id=book.id)
            out2 = await process_ingestion_job(db=session, job_id=job2.id, reviews=_sample_reviews())

            reviews_count = await session.scalar(select(func.count(Review.id)))
            analysis_count = await session.scalar(select(func.count(ReviewAnalysis.id)))
            embed_count = await session.scalar(select(func.count(ReviewEmbedding.id)))

            assert out2.status == JobStatus.COMPLETED
            assert out2.new_inserted == 0
            assert int(reviews_count or 0) == 2
            assert int(analysis_count or 0) == 2
            assert int(embed_count or 0) == 2

        await engine.dispose()

    asyncio.run(run_case())


def test_process_ingestion_job_partial_on_review_failure(monkeypatch):
    import asyncio

    from app.llm.schemas import AnalysisUsage, AnalyzeReviewResponse, EmbedResponse, ReviewAnalysisResult

    call_count = {"n": 0}

    def flaky_analyze(**kwargs):
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("mock analysis failure")
        return AnalyzeReviewResponse(
            provider="mock",
            model="mock-model",
            result=ReviewAnalysisResult(
                sentiment="mixed",
                sentiment_confidence=0.7,
                themes=["ending"],
                ai_generated_flag=False,
                ai_confidence=0.2,
                summary="Mixed sentiment.",
                actionable=False,
                actionability_reason="",
            ),
            usage=AnalysisUsage(tokens_in=11, tokens_out=4, cost_usd=0.0001),
        )

    def fake_embed(**kwargs):
        return EmbedResponse(provider="mock", model="mock-embed", vector=[0.2] * 768)

    monkeypatch.setattr("app.workers.pipeline.analyze_review", flaky_analyze)
    monkeypatch.setattr("app.workers.pipeline.embed_text", fake_embed)

    async def run_case():
        engine, session_factory = await _setup_db()

        async with session_factory() as session:
            author, book = await _seed_author_book(session)
            job = await enqueue_ingestion_job(db=session, author_id=author.id, book_id=book.id)
            out = await process_ingestion_job(db=session, job_id=job.id, reviews=_sample_reviews())
            assert out.status == JobStatus.PARTIAL
            assert out.total_found == 2
            assert out.failed == 1
            assert out.analyzed == 1

            jobs = await session.scalar(select(func.count(IngestionJob.id)))
            assert int(jobs or 0) == 1

        await engine.dispose()

    asyncio.run(run_case())
