# Frontend — Phase 0 committed scaffold

This frontend is already scaffolded and committed (React + TypeScript + Vite + Tailwind v4).
Its Phase 0 goal is simple: prove frontend can call backend `/health`.

## Run locally

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:5173`.

If backend is running at `http://localhost:8000`, the page should show:
`backend says: ok (development)`

## Deploy on Vercel (Phase 0 closeout)

1. Push this repo to GitHub.
2. In Vercel: New Project -> import repo.
3. Set **Root Directory** to `frontend`.
4. Add env var `VITE_API_URL` = your Render backend URL.
5. Deploy.

If the card shows `backend unreachable`, check backend URL and `CORS_ORIGINS` in backend env vars.
