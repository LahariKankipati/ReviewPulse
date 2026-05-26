# ReviewPulse

Review-intelligence for independent authors. Ingest reviews for an author's catalog →
LLM analysis (sentiment, themes, AI-generated flag, summary, actionable) → pgvector
semantic search → author dashboard. Multi-tenant, async, cost-aware.

Built for the Tweeds full-stack take-home. Stack matched to Tweeds on purpose
(FastAPI · SQLAlchemy 2.0 async · Postgres + pgvector · Celery · React/Vite/Tailwind/shadcn)
so it translates to day one.

## Status — Phase 0 (repo complete, cloud step pending)

**Works**
- FastAPI app with `/health`, env-driven config, structured JSON logging (N4 foundation).
- Deploy blueprint for Render (backend) + setup instructions for Vercel (frontend) + Supabase (DB).
- Committed frontend React+Vite+Tailwind skeleton that pings backend `/health`.
- Smoke test (`pytest`) confirming the app boots and `/health` responds.

**Cloud login pending to mark Phase 0 fully done**
- Supabase project created + `pgvector` enabled + Auth enabled.
- Backend deployed on Render and reachable at `/health`.
- Frontend deployed on Vercel with `VITE_API_URL` pointed at backend URL.

**Next after Phase 0 closeout** — Phase 1: schema (separated raw/analysis/embeddings tables) + multi-tenant isolation.

## Run the backend (under 10 min)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # for Phase 0 you can leave the defaults
uvicorn app.main:app --reload # http://localhost:8000/health
```

## Test

```bash
cd backend && source .venv/bin/activate && pytest -v
```

## Layout (Phase 0)

```
backend/app/
  config.py          env-driven settings (pydantic-settings)
  db.py              async SQLAlchemy engine + session + get_db dependency
  logging_config.py  structured JSON logs (N4)
  main.py            FastAPI app + /health  (routers plug in here later)
  llm/ workers/ routers/   empty packages, filled in Phases 3–5
backend/tests/       test_health.py
frontend/            committed Vite + React + Tailwind skeleton that pings /health
render.yaml          Render deploy blueprint
```
