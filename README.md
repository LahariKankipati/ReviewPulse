# ReviewPulse

Review-intelligence for independent authors. Ingest reviews for an author's catalog →
LLM analysis (sentiment, themes, AI-generated flag, summary, actionable) → pgvector
semantic search → author dashboard. Multi-tenant, async, cost-aware.

Built for the Tweeds full-stack take-home. Stack matched to Tweeds on purpose
(FastAPI · SQLAlchemy 2.0 async · Postgres + pgvector · Celery · React/Vite/Tailwind/shadcn)
so it translates to day one.

```
