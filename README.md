# ReviewPulse

Review-intelligence for independent authors. Add your books → ReviewPulse ingests reviews, runs LLM analysis (sentiment, themes, AI-detection, actionability) → stores vector embeddings for semantic search → surfaces everything on a live dashboard.

Built for the Tweeds full-stack take-home. Stack deliberately matches Tweeds (FastAPI · SQLAlchemy 2.0 async · Postgres + pgvector · React + Vite + Tailwind) so it translates directly to day one.

**Live demo:** https://review-pulse-eight.vercel.app/  
**API docs:** https://reviewpulse-qg59.onrender.com/docs  
**Health check:** https://reviewpulse-qg59.onrender.com/health

---

## What works

- Full ingestion pipeline: synthetic review generation → Groq LLM analysis → Jina embeddings → pgvector storage
- Author dashboard: catalog view, per-book deep-dive, cross-book comparison, semantic search, weekly digest
- Sentiment trend by week, theme frequency over time, week-over-week delta (frontend + REST API)
- "New since last login" grouped by book, prioritising negative and actionable reviews
- True Rating: AI-adjusted star score that excludes likely-fake reviews (P1 — not in spec)
- Idempotent ingestion via `review_hash` (SHA-256 of book key + external ID + body) — re-running inserts nothing, skips LLM calls for already-analyzed reviews
- Multi-tenant isolation: every SQL query is scoped to `author_id`; cross-tenant data leakage is blocked at the query layer (HTTP-layer enforcement requires JWT auth — see honest cuts below)
- Background async processing: job is enqueued immediately, analysis runs in a FastAPI `BackgroundTask`; frontend polls `/api/jobs/{id}` until done
- HMAC-SHA256 signed webhook fires on job completion (`X-ReviewPulse-Signature: sha256=<hex>`)
- Scheduled daily re-ingest via GitHub Actions cron — workflow at `.github/workflows/scheduled_ingest.yml`, runs at 06:00 UTC daily; requires two GitHub repository secrets: `BACKEND_URL` (the Render API base URL) and `ADMIN_SECRET` (set under repo → Settings → Secrets and variables → Actions)
- `GET /api/metrics` implemented: job health, pipeline coverage, cost totals, recent failures (protected by `X-Admin-Secret`)
- 9 backend tests: unit (LLM schema + mock provider), integration (pipeline happy path + partial failure), multi-tenant isolation

> **Implemented vs production-hardened:** F6 (cross-book compare), F9 (cron), F10 (digest), N10 (webhook), N12 (metrics) are all implemented and reachable. They are not load-tested or end-to-end exercised against a production traffic pattern — that would be the next step.

## What doesn't work / honest cuts

- **Auth (N11) — demo mode only:** session is email-based; `author_id` is returned by the server on login and stored in `localStorage`. There is no JWT — `author_id` is passed as a path/query param and trusted by the API. The query isolation is correct, but a caller who already has another author's UUID — from shared logs, an observed network request, or a compromised session — could query their data. Production fix: Supabase Auth JWT middleware + derive `author_id` from the verified token, never from input (~2h add).
- **Real Amazon scraping:** synthetic mode only. The pipeline is source-agnostic — swapping the synthetic generator for a real scraper requires changing one function.
- **GeminiProvider:** a documented stub that raises `NotImplementedError`. Satisfies the N2 two-implementation requirement. Groq is the active analysis provider; Jina is the active embedding provider.
- **Why Groq + Jina instead of Anthropic/Gemini:** the spec suggests Anthropic, Gemini, or OpenAI, but all three hit quota errors on free tiers without a payment method attached. Groq's free tier (llama-3.1-8b-instant) has no hard quota wall and supports JSON-mode output, which the analysis pipeline requires. Jina AI's free embedding tier (jina-embeddings-v2-base-en) similarly has no payment barrier and produces 768-dim vectors compatible with pgvector. Both are drop-in swappable via the provider adapter — changing two lines in `app/llm/service.py` would switch to Anthropic + OpenAI embeddings if billing is set up.

## What I'd do next

1. Wire Supabase Auth — JWT middleware, `author_id` from verified token, never from input
2. Supabase RLS — row-level security as a second isolation layer
3. Real review source — Goodreads/Trustpilot API or a Playwright scraper behind the ingestion interface
4. Email delivery for the weekly digest — the rendered preview is already built; add SendGrid/Resend

---

## Submission walkthrough

### What I cut and why

**Auth (N11):** wiring Supabase Auth correctly — JWT middleware, deriving `author_id` from `token.sub`, adding RLS — is roughly 2 hours on its own. The multi-tenant query isolation (every SQL query scoped to `author_id`) is the same either way. I chose to spend those 2 hours on F5 trend APIs, F6 cross-book comparison, and N12 observability, which are architecturally more interesting and harder to retrofit later. Auth is a standard integration; the pipeline design is not.

**Celery / durable task queue:** FastAPI `BackgroundTasks` keeps the deploy to a single service with no Redis dependency. The trade-off — a job stuck in `running` state if the server restarts mid-pipeline — is real but acceptable for a demo. Celery would have been the right call from day one for a production system.

**Real Amazon scraping:** Amazon's ToS prohibits scraping; the only legitimate review APIs require paid plans or approval. Synthetic reviews generated by the LLM demonstrate the analysis pipeline identically — the pipeline doesn't know or care about the source.

### One decision I'd reverse

Using `FastAPI BackgroundTasks` over a proper task queue. The "job stuck in running state on server restart" gap is not theoretical — Render's free tier restarts dynos on every deploy, which means any in-flight job at deploy time is permanently stuck. I noticed this during testing. With more time I'd use Celery + Redis (or Render Background Workers), which gives durable task queues and automatic retry on worker failure. Everything else in the pipeline design would stay the same.

### What's interesting about the problem that wasn't in the spec

Amazon star ratings are polluted by AI-generated and incentivised reviews. An author seeing a 4.2-star average might actually be a 4.7-star book among genuine readers, dragged down by suspicious reviews that all appeared on the same day. The spec asks you to detect AI-generated reviews — I went one step further and built **True Rating**: an AI-adjusted star score that excludes likely-fake reviews from the average. This is the number an author actually needs to see, because the raw star count is the one Amazon shows to buyers. The gap between True Rating and raw rating is itself a signal — a large gap means the review corpus is worth investigating.

### How AI tools shaped the work

Claude Code was used throughout — route scaffolding, SQLAlchemy async query patterns, React state management, test generation. Where it helped most: systematically verifying that every query path included `WHERE author_id = ?` for tenant isolation, and generating the HMAC webhook signing and verification example correctly on the first try.

Where it went wrong and was overridden: the initial provider setup had `GroqProvider.embed_text()` delegating to `GeminiProvider()`, which was never defined — a hallucinated dependency that caused an import error at runtime. Caught during manual testing, not by the AI. Similarly, the first draft of the job polling endpoint had no `author_id` scoping, meaning any authenticated user could poll any job ID — a cross-tenant leak. Both bugs were introduced by AI-assisted code and caught by manual review. The lesson: AI tools produce plausible-looking code that passes type checks but can fail at the integration boundary. Read every route handler before shipping.

---

## Running locally (under 10 minutes)

### Prerequisites
- Python 3.11+
- Node 18+
- A Postgres database with pgvector enabled (Supabase free tier — enable pgvector in Extensions)
- A Groq API key (free at console.groq.com)
- A Jina AI API key (free at jina.ai)

### 1. Clone and set up the backend

```bash
git clone https://github.com/LahariKankipati/ReviewPulse
cd reviewpulse/backend

python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — fill in DATABASE_URL, GROQ_API_KEY, JINA_API_KEY
```

Create the database schema (SQLAlchemy `create_all` — no Alembic, idempotent):
```bash
python scripts/init_db.py
```

Start the API:
```bash
uvicorn app.main:app --reload --port 8000
```

API is now at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

### 2. Set up the frontend

```bash
cd ../frontend
npm install

echo "VITE_API_URL=http://localhost:8000" > .env.local

npm run dev
```

Frontend is now at `http://localhost:5173`.

### 3. Try it out

1. Open `http://localhost:5173` → Create account with any email
2. Add a book, set review count to 20–30, click **Add Book & Analyze**
3. Watch the pipeline run (20–40s on a warm backend)
4. Explore the dashboard — catalog, deep-dive, semantic search, digest

### Testing admin/cron endpoints locally

The `POST /api/admin/refresh` and `GET /api/metrics` endpoints require the `X-Admin-Secret` header. The default value from `.env.example` is `dev-admin-secret-change-me`:

```bash
curl http://localhost:8000/api/metrics \
  -H "X-Admin-Secret: dev-admin-secret-change-me"
```

### Running tests

```bash
cd backend
pytest tests/ -v
# 9 tests, all pass, no external services required (SQLite in-memory)
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | `postgresql+asyncpg://...` — Supabase or local Postgres with pgvector |
| `GROQ_API_KEY` | Yes | Groq API key for LLM analysis (free at console.groq.com) |
| `JINA_API_KEY` | Yes | Jina AI key for embeddings (free at jina.ai) |
| `CORS_ORIGINS` | Yes | Comma-separated allowed frontend origins |
| `ADMIN_SECRET` | Yes | Protects `POST /api/admin/refresh` and `GET /api/metrics` |
| `WEBHOOK_SECRET` | No | HMAC secret for signing job-completion webhooks |
| `WEBHOOK_URL` | No | URL to POST signed webhook payload to |
| `ENVIRONMENT` | No | `development` or `production` (default: `development`) |

---

## API overview

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/authors` | Register a new author |
| `POST` | `/api/auth/login` | Login by email, update login timestamps |
| `GET` | `/api/authors/{id}/books` | List author's books |
| `POST` | `/api/authors/{id}/books` | Add a book to the catalog |
| `DELETE` | `/api/books/{id}` | Remove a book and all its reviews |
| `POST` | `/api/books/{id}/ingest` | Trigger ingestion job (async) |
| `GET` | `/api/jobs/{id}` | Poll job status (requires `author_id` query param) |
| `GET` | `/api/books/{id}/reviews` | List reviews with filters/sort/pagination |
| `GET` | `/api/books/{id}/trends` | Sentiment over time, theme frequency, WoW delta |
| `GET` | `/api/authors/{id}/compare` | Cross-book comparison (sentiment, themes, velocity) |
| `POST` | `/api/authors/{id}/search` | Semantic search via pgvector cosine similarity |
| `POST` | `/api/admin/refresh` | Trigger daily re-ingest for all books — requires `X-Admin-Secret` |
| `GET` | `/api/metrics` | Observability — job health, cost totals, recent failures — requires `X-Admin-Secret` |

---

## Webhook verification example

```python
import hmac, hashlib

def verify(body: bytes, header: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", header)
```

Header sent: `X-ReviewPulse-Signature: sha256=<hex>`
