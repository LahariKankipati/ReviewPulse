# ReviewPulse — Architecture

**Live demo:** https://review-pulse-eight.vercel.app/  
**API docs:** https://reviewpulse-qg59.onrender.com/docs  
**Health check:** https://reviewpulse-qg59.onrender.com/health

---

## Stack overview

| Layer | Choice | Reason |
|---|---|---|
| Backend framework | FastAPI | Matches Tweeds stack; native async; auto-generates OpenAPI docs |
| ORM | SQLAlchemy 2.0 async | Matches Tweeds stack; full async session support |
| Database | Supabase (Postgres + pgvector) | Free tier, one-click pgvector, managed TLS |
| LLM analysis | Groq (llama-3.1-8b-instant) | See provider section |
| Embeddings | Jina AI (jina-embeddings-v2-base-en) | See provider section |
| Frontend | React + Vite + Tailwind | Matches Tweeds stack; Vite is fast for iteration |
| Backend hosting | Render (free web service) | Auto-deploys from GitHub; free tier sufficient |
| Frontend hosting | Vercel (hobby plan) | One-command deploy; free CDN |
| Scheduler | GitHub Actions cron | See scheduled refresh section |

---

## Data model

### Why three tables per review instead of one

The most obvious approach is a single `reviews` table with all columns — raw text plus analysis plus embedding. This creates a hard coupling: if you want to re-run the LLM analysis with a better prompt or different model, you have to touch the same row that holds the immutable source data. If the re-analysis job crashes halfway, some rows have new analysis and some have old analysis with no way to tell.

Instead, ReviewPulse uses three tables:

| Table | What it holds | Why separate |
|---|---|---|
| `reviews` | Raw ingested text, source metadata, `review_hash`, timestamps | Immutable after insert — never modified, only read |
| `review_analysis` | LLM output: sentiment, themes, actionable flag, is_ai flag, one-sentence summary, true_rating, token counts, cost | Can be deleted and regenerated without touching raw data |
| `review_embeddings` | 768-dim Jina vector | Can be regenerated independently if the embedding model changes |

This means: re-analyzing reviews = delete `review_analysis` rows and re-run. Re-embedding = delete `review_embeddings` rows and re-run. The raw reviews are never at risk.

### Why `author_id` is denormalized onto every table

The multi-tenant isolation requirement (F12) means every query must be scoped to one author. The options are:

- **Join-based isolation:** query joins through `books → reviews` to reach the `author_id`. Requires a join on every read path.
- **Denormalized `author_id`:** stamp `author_id` directly on `reviews`, `review_analysis`, `review_embeddings`, and `ingestion_jobs`.

Denormalization wins here: every query becomes a single `WHERE author_id = ?` with no join, and adding a DB-level index on `author_id` makes the filter essentially free. The cost is a small amount of redundant storage, which is acceptable for a product at this scale.

---

## LLM and embedding providers

### What the adapter layer does

All LLM and embedding calls go through a protocol interface in `app/llm/base.py`. `GroqProvider` and `GeminiProvider` both implement `AnalysisProvider`; `JinaProvider` implements `EmbeddingProvider`. The pipeline calls the interface — it never imports a provider class directly. Swapping providers means changing one assignment in `app/llm/service.py`.

```
AnalysisProvider (protocol)
├── GroqProvider    — active (llama-3.1-8b-instant)
└── GeminiProvider  — stub (raises NotImplementedError, satisfies N2)

EmbeddingProvider (protocol)
└── JinaProvider    — active (jina-embeddings-v2-base-en, 768-dim)
```

### Why Groq instead of Anthropic, Gemini, or OpenAI

The spec suggests Anthropic, Gemini, and OpenAI. All three have the same problem on free accounts: quota limits kick in at very low call volumes unless a payment method is attached. On a fresh API key without billing, Anthropic's Claude returns `429 rate_limit_error` after a handful of requests; Gemini similarly throttles aggressively on the free tier; OpenAI requires billing enabled before the key is usable at any meaningful volume. For a take-home project that generates 20–80 reviews per pipeline run and runs that pipeline multiple times during development, these providers are practically unusable without paying.

Groq's free tier (no payment method required) gives 30 requests/minute on llama-3.1-8b-instant with a daily token limit that is far above what the pipeline needs. It also supports JSON-mode structured output, which the analysis pipeline requires — the LLM is instructed to return a strict JSON schema (sentiment, themes, is_ai, actionable, summary, confidence), and JSON mode ensures the output is always parseable without defensive string extraction.

**Trade-off:** llama-3.1-8b-instant is a smaller model than Claude Sonnet or GPT-4o. Analysis quality is lower, particularly for nuanced sentiment and theme extraction. In production with billing available, switching to Claude would improve accuracy with a two-line change.

### Why Jina AI instead of OpenAI embeddings

OpenAI's `text-embedding-3-small` is the natural choice for embeddings, but it requires billing. Jina AI's embedding API has a genuinely free tier (no credit card, no expiry) and produces 768-dimensional vectors. The 768-dim size is important — Supabase's pgvector extension supports it without any configuration, and it keeps the index size manageable. OpenAI's `text-embedding-3-small` produces 1536-dim vectors by default, which doubles the storage and index size.

**Trade-off:** Jina's model quality is slightly below OpenAI's for English semantic similarity, but the difference is not perceptible in a product that searches across a few hundred reviews. The cosine similarity threshold (`0.6`) is tuned for Jina's embedding space.

### Why GeminiProvider is a stub

The spec requires the LLM adapter layer to have at least two implementations (N2). GeminiProvider is the second implementation — it defines the interface correctly and documents the integration path, but raises `NotImplementedError` when called. This is honest: shipping a partial Gemini integration that silently returns wrong results would be worse than a clear stub. If Gemini's free quota situation changes or billing is added, implementing `GeminiProvider.analyze_review()` is a self-contained task.

### Rate limiting and retries

All LLM and embedding calls are wrapped with `tenacity`: 3 attempts, exponential backoff starting at 1 second with jitter, retrying on any `Exception`. This handles Groq's occasional `503` responses and transient network errors. The policy is documented in `app/llm/providers.py`. If all 3 attempts fail, the exception propagates to the pipeline and the review is counted as `failed` in the job counters — the job continues with the remaining reviews rather than aborting.

---

## Ingestion pipeline

### What it does, step by step

```
POST /api/books/{id}/ingest  { synthetic_count: N }
  1. Create IngestionJob row with status="queued"
  2. Return { job_id, status: "queued" } immediately — HTTP response is sent
  3. FastAPI BackgroundTask picks up:
     a. Mark job status="running"
     b. Generate N synthetic reviews via Groq (structured output)
     c. For each review:
        - Compute SHA-256 review_hash
        - Skip if hash already exists in DB (idempotency)
        - Call Groq: analyze_review() → sentiment, themes, is_ai, actionable, summary
        - Call Jina: embed_text() → 768-dim vector
        - Insert review + review_analysis + review_embedding in one transaction
        - Increment job.analyzed counter
     d. Mark job status="completed" (or "partial" if some reviews failed)
     e. Fire HMAC-SHA256 signed webhook if WEBHOOK_URL is configured
  4. Frontend polls GET /api/jobs/{id} every 2 seconds until status is terminal
```

### Why FastAPI BackgroundTasks instead of Celery

The spec mentions Celery as an option. Celery requires a message broker (Redis or RabbitMQ) running as a separate service. On free-tier infrastructure this means either a second Render service or an external Redis (Upstash free tier). That adds deploy complexity, a second failure point, and another service to configure.

FastAPI's `BackgroundTasks` runs in the same process as the API server — no broker, no worker, no extra service. A job enqueued via `BackgroundTasks` starts as soon as the current request finishes and runs until the analysis is complete.

**The trade-off is real:** if the Render dyno restarts while a job is running (e.g., due to a deploy or a crash), the job stops but its DB row stays in `status="running"` forever. There is no retry and no durable queue. For a demo this is acceptable — the frontend shows a timeout message after 80 seconds and tells the user to check back. In production with real authors depending on the pipeline, the right fix is Celery + Redis or Render Background Workers (paid plan), which provides durable task queues with automatic retry on worker failure.

---

## Idempotency

### How review deduplication works

`review_hash = SHA-256(book_key | external_id | normalized_body)`

Before inserting a review, the pipeline computes its hash and checks whether a row with that hash already exists in the `reviews` table. If it does, the entire review is skipped — no DB write, no LLM call, no embedding call. This means:

- Running the same ingestion job twice produces exactly the same final DB state
- Re-running after a partial failure only processes the reviews that didn't make it in the first run
- The LLM is never called for a review that has already been analyzed

### How the cron job stays idempotent

The scheduled refresh generates new synthetic reviews each day using date-stamped `external_id`s (`cron-{date}-{n}`). To ensure that re-running the cron on the same day produces the same hashes, the review body is generated deterministically: `_stable_pick(seed, list)` uses MD5 of the seed string as an index into the list, so the same seed always picks the same item. Random selection would produce different bodies → different hashes → duplicate reviews on re-run.

---

## Semantic search

### What it does

`POST /api/authors/{id}/search { "query": "..." }` embeds the query string using JinaProvider, then runs a pgvector cosine similarity search (`<=>` operator) over all `review_embeddings` rows belonging to the author's books. Results above a `0.6` similarity threshold are returned ranked by score, with book title, review snippet, and score.

### Why pgvector instead of Pinecone, Weaviate, or Chroma

The spec explicitly asks for pgvector and notes it is used at Tweeds. Beyond spec compliance: pgvector stores vectors inside Postgres, which means no additional service, no separate API key, no separate billing, and no data sync lag between the reviews table and the vector index. Pinecone, Weaviate, and Chroma are all separate services that would need to be kept in sync with the Postgres data — if a review is deleted in Postgres but the vector isn't removed from Pinecone, search returns stale results.

With pgvector, a single `DELETE FROM review_embeddings WHERE review_id = ?` keeps everything consistent. Supabase enables pgvector with one click in the Extensions panel.

---

## Scheduled refresh (F9)

### What it does

A GitHub Actions workflow (`.github/workflows/scheduled_ingest.yml`) runs at 06:00 UTC every day. It sends an HTTP POST to `POST /api/admin/refresh` with an `X-Admin-Secret` header. The endpoint iterates over every book across all authors and triggers a `BackgroundTask` ingestion for each one, generating 5 new synthetic reviews per book using that day's date as the seed. Because of the idempotency system, reviews that already exist are skipped — only genuinely new content is inserted.

The workflow also supports `workflow_dispatch`, which lets you trigger it manually from the GitHub Actions UI to test it without waiting for the scheduled time.

### Why GitHub Actions instead of Render cron or Celery Beat

- **Render cron:** only available on paid Render plans. The free web service tier has no built-in cron capability.
- **Celery Beat:** requires Celery + Redis running as separate services (see BackgroundTasks rationale above). Significant extra infrastructure for a single daily task.
- **GitHub Actions cron:** free on all GitHub plans, runs reliably, produces a full audit log in the Actions tab (you can see every run, its logs, and whether it succeeded), and can be triggered manually. The only requirement is that the backend URL and admin secret are stored as GitHub repository secrets — a one-time setup.

**The trade-off:** GitHub Actions has a ~1 minute startup time before the HTTP request fires. For a daily background refresh this is irrelevant. For a task that needed sub-minute precision, a different approach would be required.

---

## Webhook (N10)

### What it does

When an ingestion job completes (status `completed` or `partial`), the pipeline POSTs a JSON payload to `WEBHOOK_URL` (if configured) with a signature header:

```
X-ReviewPulse-Signature: sha256=<hex>
```

The signature is `HMAC-SHA256(body_bytes, WEBHOOK_SECRET)`. The recipient verifies it using `hmac.compare_digest` (timing-safe comparison — prevents timing attacks where an attacker learns the signature length by measuring response time).

### Why HMAC-SHA256

A webhook without a signature is just an unauthenticated POST — any caller who knows the URL can fake a completion event and trigger downstream logic (e.g., sending a digest email for a job that never ran). HMAC-SHA256 binds the signature to the exact byte content of the payload using a secret only the sender and recipient know. SHA-256 is the industry standard for webhook signing (used by Stripe, GitHub, Shopify). The verification example is in the README.

---

## Observability (N12)

### What `GET /api/metrics` returns

Protected by `X-Admin-Secret`. Returns:

- **Job health:** total jobs, running/completed/failed/partial counts, jobs in the last 24h
- **Pipeline coverage:** total reviews ingested, how many have been analyzed, how many have embeddings, percentage coverage
- **Cost totals:** total USD spent on LLM analysis across all authors, total tokens in/out, per-author cost breakdown
- **Recent failures:** last 10 failed jobs with book title, author, error message, and timestamp

This is the "3 AM dashboard" — enough information to answer "is the pipeline healthy, how much have we spent, and what broke last."

### Why a `/metrics` endpoint instead of Grafana or Sentry

Grafana requires a metrics scraper (Prometheus) running as a separate service. Sentry/Logflare/Axiom are third-party SaaS tools with their own accounts and setup. For a demo project, a JSON endpoint that returns the same information is functionally equivalent and requires zero additional infrastructure. In production, the right move is to emit structured metrics from this endpoint into a Prometheus scraper and visualise in Grafana — the data is already structured correctly for that.

---

## Auth — demo mode only (deliberate cut)

### Current state

Session is email-only, stored in `localStorage`. On login, the server looks up the author by email and returns their `author_id` UUID. The frontend stores this in `localStorage` and sends it as a path or query parameter on every subsequent request. The API trusts that value without verification.

**The gap:** a caller who knows another author's UUID can query their books and reviews by passing that UUID in the request. UUIDs are not guessable, but they are not secret either — they appear in API responses and browser network logs.

### What is protected

Every SQL query includes `WHERE author_id = ?`, so the database layer enforces isolation correctly. The gap is at the HTTP authentication layer, not the data layer. If an attacker has the UUID, they can read data; they cannot write data under another author's account because write endpoints also scope on `author_id`.

### Production fix

Replace `POST /api/auth/login` with Supabase Auth. The flow becomes:

1. Frontend calls Supabase Auth → receives a signed JWT
2. Frontend sends JWT as `Authorization: Bearer <token>` on every request
3. FastAPI middleware verifies the JWT signature using the Supabase JWT secret
4. `author_id` is extracted from `token.sub` — never from request input
5. Supabase RLS (Row-Level Security) adds a second enforcement layer at the DB level

Estimated time: ~2 hours. The query isolation code does not need to change — only the auth middleware and the session handling on the frontend.

---

## Schema management

No Alembic. Schema is created by running `python scripts/init_db.py`, which calls SQLAlchemy's `Base.metadata.create_all`. This is safe to re-run — `create_all` uses `CREATE TABLE IF NOT EXISTS` internally and will not touch existing tables.

**Why not Alembic:** Alembic is the right tool when you have a live database with data that must be preserved across schema changes. It generates migration scripts that apply diffs incrementally. For a demo project where the schema can be recreated from scratch (wipe the DB, run `init_db.py`, re-ingest), the migration overhead is not justified. If this were a production system with author data that cannot be dropped, Alembic migrations would be required from day one.

---

## Review data source

### Why synthetic reviews instead of real Amazon data

The spec explicitly allows — and recommends — synthetic mode. Real Amazon scraping raises two issues: Amazon's Terms of Service prohibit automated scraping, and there is no free official API for review data. Third-party datasets (Kaggle Amazon review datasets) exist but are large, require pre-processing, and complicate the local setup story.

Synthetic reviews generated by the LLM serve the purpose equally well for demonstrating the analysis pipeline: the pipeline doesn't know or care whether a review was written by a human or generated — it runs the same sentiment analysis, theme extraction, and embedding either way. The generated reviews are realistic enough (varied sentiment, varied themes, varied length) to produce meaningful trend data.

The pipeline is written to be source-agnostic: `generate_reviews()` in `app/services/synthetic_seed.py` is the only function that would need to be replaced to switch to real reviews. Everything downstream (analysis, embedding, storage, search) is unchanged.

---

## Deployment

### Backend — Render free web service

Render's free web service auto-deploys from the GitHub `main` branch on every push. It runs the FastAPI app via `uvicorn`. The free tier spins down after 15 minutes of inactivity (cold start is ~30 seconds). This is documented in the README under "infra cold-start time." The ingestion pipeline itself (once the server is warm) runs in 20–40 seconds.

**Why not Fly.io or Railway:** Render's free tier was the most straightforward to configure for a Python/FastAPI app with environment variables and a single service. Fly.io and Railway both work but require more initial CLI setup.

### Frontend — Vercel hobby plan

Vercel auto-deploys from GitHub, serves the Vite build as a static site on a global CDN, and is free for public repos. The frontend is a pure static build with no server-side rendering — it hits the Render API directly from the browser.

### Database — Supabase free tier

Supabase provides managed Postgres with pgvector enabled in one click (Extensions → pgvector). The free tier includes 500MB storage and 2GB egress per month — sufficient for a demo with a few hundred reviews. The connection string is the standard `postgresql+asyncpg://` format that SQLAlchemy's async engine accepts directly.
