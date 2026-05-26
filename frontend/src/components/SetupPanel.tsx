import { useState } from "react";
import type { Author, Book, Job } from "../types/domain";

type Props = {
  author: Author | null;
  books: Book[];
  jobs: Record<string, Job>;
  busy: boolean;
  onCreateAuthor: (form: { auth_user_id: string; email: string; name: string }) => Promise<void>;
  onAddBook: (form: { title: string; isbn: string; source_url: string }) => Promise<void>;
  onIngest: (bookId: string, count: number) => Promise<void>;
  onGoToDashboard: () => void;
};

function StepTrack({ step }: { step: number }) {
  const labels = ["Author", "Book", "Generate"];
  return (
    <div className="step-track">
      {labels.map((label, i) => (
        <div key={label} style={{ display: "flex", alignItems: "center", flex: i < labels.length - 1 ? "1" : "auto" }}>
          <div
            className={`step-dot ${step > i ? "s-done" : step === i ? "s-active" : ""}`}
            title={label}
          >
            {step > i ? "✓" : i + 1}
          </div>
          {i < labels.length - 1 && <div className={`step-line ${step > i ? "s-done" : ""}`} />}
        </div>
      ))}
    </div>
  );
}

export function SetupPanel({ author, books, jobs, busy, onCreateAuthor, onAddBook, onIngest, onGoToDashboard }: Props) {
  const [name, setName] = useState("Demo Author");
  const [email, setEmail] = useState("author@example.com");
  const [bookTitle, setBookTitle] = useState("First Light");
  const [isbn, setIsbn] = useState("9780012345678");
  const [count, setCount] = useState(30);

  const step = !author ? 0 : books.length === 0 ? 1 : 2;
  const lastBook = books[books.length - 1];
  const lastJob = lastBook ? jobs[lastBook.id] : null;
  const isCompleted = lastJob?.status === "completed" || lastJob?.status === "partial";

  async function handleAuthor() {
    await onCreateAuthor({
      auth_user_id: `author-${Date.now()}`,
      email,
      name,
    });
  }

  async function handleBook() {
    await onAddBook({ title: bookTitle, isbn, source_url: "" });
  }

  async function handleIngest() {
    if (!lastBook) return;
    await onIngest(lastBook.id, count);
  }

  if (isCompleted) {
    return (
      <div className="setup-page">
        <div className="setup-card">
          <div className="setup-success">
            <div className="success-icon">🎉</div>
            <div className="setup-title">You're all set, {author?.name}!</div>
            <p style={{ color: "var(--ink-2)", marginTop: "0.5rem", fontSize: "0.95rem" }}>
              {lastJob?.analyzed} reviews analyzed for <strong>{lastBook?.title}</strong>.
              Your intelligence dashboard is ready.
            </p>
            <div style={{ marginTop: "1.5rem" }}>
              <button className="btn" onClick={onGoToDashboard}>
                Open Dashboard →
              </button>
            </div>
            <p style={{ marginTop: "1rem", fontSize: "0.8rem", color: "var(--ink-3)" }}>
              You can add more books from the Dashboard at any time.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-page">
      <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)", marginBottom: "0.4rem" }}>
          Getting Started
        </div>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          Set up ReviewPulse
        </h1>
        <p style={{ color: "var(--ink-2)", fontSize: "0.92rem", marginTop: "0.35rem", maxWidth: "400px", margin: "0.35rem auto 0" }}>
          Three steps to see AI-powered intelligence on your book reviews.
        </p>
      </div>

      <StepTrack step={step} />

      <div className="setup-card">
        {/* Step 0 — Author */}
        {step === 0 && (
          <>
            <div className="setup-kicker">Step 1 of 3</div>
            <div className="setup-title">Create your author profile</div>
            <div className="setup-desc">One account per author — all your books and reviews stay isolated to you.</div>
            <div className="input-group">
              <label className="input-label">Your Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Austen" />
            </div>
            <div className="input-group">
              <label className="input-label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="setup-actions">
              <button className="btn" disabled={busy || !name || !email} onClick={handleAuthor}>
                {busy ? "Creating…" : "Create Profile →"}
              </button>
            </div>
          </>
        )}

        {/* Step 1 — Book */}
        {step === 1 && (
          <>
            <div className="setup-kicker">Step 2 of 3</div>
            <div className="setup-title">Add your first book</div>
            <div className="setup-desc">
              Hi, <strong>{author?.name}</strong>! Add a title to start tracking its reviews.
              You can add more books from the dashboard later.
            </div>
            <div className="input-group">
              <label className="input-label">Book Title</label>
              <input className="input" value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="e.g. First Light" />
            </div>
            <div className="input-group">
              <label className="input-label">ISBN (optional)</label>
              <input className="input" value={isbn} onChange={(e) => setIsbn(e.target.value)} placeholder="e.g. 9780012345678" />
            </div>
            <div className="setup-actions">
              <button className="btn" disabled={busy || !bookTitle} onClick={handleBook}>
                {busy ? "Adding…" : "Add Book →"}
              </button>
            </div>
          </>
        )}

        {/* Step 2 — Ingest */}
        {step === 2 && (
          <>
            <div className="setup-kicker">Step 3 of 3</div>
            <div className="setup-title">Generate and analyze reviews</div>
            <div className="setup-desc">
              Seeding <strong>"{lastBook?.title}"</strong> with synthetic reviews and running full LLM analysis —
              sentiment, themes, AI-detection, and embeddings.
            </div>

            <label className="input-label" style={{ display: "block", marginBottom: "0.4rem" }}>
              Number of reviews to generate
            </label>
            <div className="count-slider">
              <input
                type="range"
                min={10}
                max={80}
                step={5}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
              <span className="count-val">{count}</span>
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--ink-3)", marginBottom: "1.25rem" }}>
              ~10–30s on a warm backend · {count} reviews → LLM analysis + pgvector embeddings
            </p>

            {lastJob && (
              <div style={{ marginBottom: "1rem" }}>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                  <span className={`badge ${lastJob.status === "running" ? "badge-job-running" : "badge-job"}`}>
                    {lastJob.status === "running" ? "⟳ running…" : lastJob.status}
                  </span>
                  {lastJob.new_inserted > 0 && <span className="badge badge-neutral">inserted {lastJob.new_inserted}</span>}
                  {lastJob.analyzed > 0 && <span className="badge badge-neutral">analyzed {lastJob.analyzed}</span>}
                </div>
                {lastJob.status === "running" && (
                  <div style={{ fontSize: "0.8rem", color: "var(--ink-3)" }}>
                    Pipeline running: fetching → analyzing → embedding…
                  </div>
                )}
              </div>
            )}

            <div className="setup-actions">
              <button className="btn" disabled={busy} onClick={handleIngest}>
                {busy ? "Processing… (may take ~30s)" : "Run Analysis Pipeline →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
