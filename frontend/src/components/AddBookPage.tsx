import { useState } from "react";
import { createBook, getJob, listBookReviews, triggerIngestion } from "../api/reviewpulse";
import type { Book, Job, ReviewItem, Session } from "../types/domain";

type Props = {
  session: Session;
  onBookAdded: (book: Book, reviews: ReviewItem[]) => void;
};

type Phase = "form" | "running" | "done";

export function AddBookPage({ session, onBookAdded }: Props) {
  const [title, setTitle] = useState("");
  const [isbn, setIsbn] = useState("");
  const [count, setCount] = useState(30);
  const [phase, setPhase] = useState<Phase>("form");
  const [job, setJob] = useState<Job | null>(null);
  const [addedBook, setAddedBook] = useState<Book | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setPhase("running");

    try {
      // Step 1: Create book
      const book = await createBook(session.id, { title: title.trim(), isbn: isbn.trim() || undefined });
      setAddedBook(book);

      // Step 2: Trigger ingestion
      const { job_id } = await triggerIngestion(book.id, count);
      let currentJob = await getJob(job_id, session.id);
      setJob(currentJob);

      // Step 3: Poll until done (max 80s)
      let attempts = 0;
      while ((currentJob.status === "running" || currentJob.status === "queued") && attempts < 40) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          currentJob = await getJob(job_id, session.id);
        } catch {
          throw new Error("Lost connection while waiting for analysis. Please refresh and check your book.");
        }
        setJob(currentJob);
        attempts++;
      }
      if (currentJob.status === "running" || currentJob.status === "queued") {
        throw new Error("Analysis is taking longer than expected. It will finish in the background — check back in a minute.");
      }

      // Step 4: Load reviews
      const data = await listBookReviews(book.id, session.id);
      setPhase("done");
      onBookAdded(book, data.items);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("form");
    }
  }

  /* ── Done state ─────────────────────── */
  if (phase === "done" && addedBook && job) {
    return (
      <div className="page-narrow">
        <div className="card" style={{ textAlign: "center", padding: "3rem 2rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🎉</div>
          <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.4rem" }}>
            "{addedBook.title}" is ready
          </h2>
          <p style={{ color: "var(--ink-2)", fontSize: "0.92rem", marginBottom: "1.75rem" }}>
            {job.analyzed} review{job.analyzed !== 1 ? "s" : ""} analyzed &middot; sentiment, themes, AI detection, and embeddings complete.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              className="btn"
              onClick={() => onBookAdded(addedBook, [])}
            >
              View Reviews →
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => { setPhase("form"); setTitle(""); setIsbn(""); setJob(null); setAddedBook(null); }}
            >
              Add Another Book
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Running state ──────────────────── */
  if (phase === "running") {
    const isDone = job?.status === "completed" || job?.status === "partial";
    const isRunning = job?.status === "running";

    return (
      <div className="page-narrow">
        <h1 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "0.35rem" }}>Adding "{title}"</h1>
        <p style={{ color: "var(--ink-2)", fontSize: "0.88rem", marginBottom: "1.5rem" }}>
          Running the full analysis pipeline — this takes 20–60 seconds.
        </p>

        <div className="add-book-progress">
          <div className={`progress-step ${addedBook ? "ps-done" : "ps-active"}`}>
            <span className="ps-icon">{addedBook ? "✓" : "⟳"}</span>
            {addedBook ? "Book created" : "Creating book…"}
          </div>
          <div className={`progress-step ${job ? (isRunning ? "ps-active" : isDone ? "ps-done" : "") : ""}`}>
            <span className="ps-icon">{isDone ? "✓" : job ? "⟳" : "○"}</span>
            {isDone
              ? `Analyzed ${job?.analyzed ?? 0} reviews`
              : isRunning
              ? `Analyzing ${count} reviews (${job?.analyzed ?? 0} done so far)…`
              : "Waiting to start…"}
          </div>
          <div className={`progress-step ${isDone ? "ps-active" : ""}`}>
            <span className="ps-icon">{isDone ? "⟳" : "○"}</span>
            {isDone ? "Loading your results…" : "Building vector index (embeddings)"}
          </div>
        </div>

        {job && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
            {job.new_inserted > 0 && <span className="badge badge-neutral">inserted {job.new_inserted}</span>}
            {job.analyzed > 0 && <span className="badge badge-positive">analyzed {job.analyzed}</span>}
            {job.failed > 0 && <span className="badge badge-negative">failed {job.failed}</span>}
          </div>
        )}
      </div>
    );
  }

  /* ── Form state ─────────────────────── */
  return (
    <div className="page-narrow">
      <div style={{ marginBottom: "1.75rem" }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)", marginBottom: "0.2rem" }}>
          Catalog
        </div>
        <h1 style={{ fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.02em" }}>Add a book</h1>
        <p style={{ color: "var(--ink-2)", fontSize: "0.88rem", marginTop: "0.2rem" }}>
          ReviewPulse will generate and analyze synthetic reviews so you can see intelligence in action.
        </p>
      </div>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">Book Title</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. First Light"
              autoFocus
              required
            />
          </div>
          <div className="input-group">
            <label className="input-label">ISBN <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--ink-3)" }}>optional</span></label>
            <input
              className="input"
              value={isbn}
              onChange={(e) => setIsbn(e.target.value)}
              placeholder="e.g. 9780012345678"
            />
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <label className="input-label" style={{ display: "block", marginBottom: "0.5rem" }}>
              Reviews to generate &amp; analyze
            </label>
            <div className="count-slider-row">
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
            <div style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>
              ~20–50s on a warm backend · {count} reviews → LLM analysis + pgvector embeddings
            </div>
          </div>

          {error && <div className="error-bar" style={{ marginBottom: "0.75rem" }}>{error}</div>}

          <button className="btn btn-lg" type="submit" disabled={!title.trim()}>
            Add Book &amp; Analyze →
          </button>
        </form>
      </div>

      <div style={{ marginTop: "1.25rem", padding: "0.85rem 1rem", background: "var(--surface-2)", borderRadius: "10px", fontSize: "0.82rem", color: "var(--ink-2)" }}>
        <strong>What happens next:</strong> ReviewPulse generates {count} realistic reviews using your LLM provider, runs sentiment analysis, theme extraction, AI-detection, and builds vector embeddings for semantic search — all in one pipeline run.
      </div>
    </div>
  );
}
