import type { Author, Book, Job, ReviewItem } from "../types/domain";

type Props = {
  author: Author | null;
  books: Book[];
  bookReviews: Record<string, ReviewItem[]>;
  jobs: Record<string, Job>;
  onSelectBook: (book: Book) => void;
  lastVisit: Date;
};

// Returns the raw average star rating across all rated reviews.
function avgRating(reviews: ReviewItem[]) {
  const rated = reviews.filter((r) => r.rating != null);
  if (!rated.length) return null;
  return rated.reduce((s, r) => s + r.rating!, 0) / rated.length;
}

// Returns the average rating excluding reviews flagged as AI-generated.
function trueRating(reviews: ReviewItem[]) {
  const real = reviews.filter((r) => r.rating != null && !r.analysis?.ai_generated_flag);
  if (!real.length) return null;
  return real.reduce((s, r) => s + r.rating!, 0) / real.length;
}

// Tallies positive, mixed, and negative sentiment counts across a list of reviews.
function sentimentCounts(reviews: ReviewItem[]) {
  let pos = 0, mix = 0, neg = 0;
  for (const r of reviews) {
    if (r.analysis?.sentiment === "positive") pos++;
    else if (r.analysis?.sentiment === "mixed") mix++;
    else if (r.analysis?.sentiment === "negative") neg++;
  }
  return { pos, mix, neg, total: pos + mix + neg };
}

// Returns the top N most frequently mentioned themes across a list of reviews.
function topThemes(reviews: ReviewItem[], n = 3) {
  const counts: Record<string, number> = {};
  for (const r of reviews) {
    for (const t of r.analysis?.themes ?? []) {
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

function SentimentBar({ pos, mix, neg }: { pos: number; mix: number; neg: number }) {
  const total = pos + mix + neg || 1;
  return (
    <div className="sentiment-bar-wrap">
      <div className="sentiment-bar">
        <div className="sb-pos" style={{ width: `${(pos / total) * 100}%` }} />
        <div className="sb-mix" style={{ width: `${(mix / total) * 100}%` }} />
        <div className="sb-neg" style={{ width: `${(neg / total) * 100}%` }} />
      </div>
      <div className="sentiment-legend">
        <span><span className="legend-dot ld-pos" />{pos} positive</span>
        <span><span className="legend-dot ld-mix" />{mix} mixed</span>
        <span><span className="legend-dot ld-neg" />{neg} negative</span>
      </div>
    </div>
  );
}

function WhatsNew({ books, bookReviews, lastVisit }: { books: Book[]; bookReviews: Record<string, ReviewItem[]>; lastVisit: Date }) {
  const allReviews = books.flatMap((b) => bookReviews[b.id] ?? []);
  const newReviews = allReviews.filter((r) => r.review_date && new Date(r.review_date) > lastVisit);
  const newNeg = newReviews.filter((r) => r.analysis?.sentiment === "negative");
  const newActionable = newReviews.filter((r) => r.analysis?.actionable);
  const newAi = newReviews.filter((r) => r.analysis?.ai_generated_flag);

  if (allReviews.length === 0) return null;

  const daysSince = Math.round((Date.now() - lastVisit.getTime()) / 86400000);
  const sinceLabel = daysSince === 0 ? "today" : daysSince === 1 ? "yesterday" : `${daysSince} days ago`;

  const highlights = [
    ...newNeg.slice(0, 1),
    ...newActionable.filter((r) => !newNeg.includes(r)).slice(0, 1),
  ];

  return (
    <div className="whats-new">
      <div className="whats-new-kicker">Since your last visit · {sinceLabel}</div>
      <div className="whats-new-head">
        {newReviews.length > 0
          ? `${newReviews.length} new review${newReviews.length !== 1 ? "s" : ""} arrived across your catalog`
          : "Your catalog is up to date — no new reviews since last visit"}
      </div>
      {newReviews.length > 0 && (
        <div className="whats-new-grid">
          <div className="whats-new-item">
            <div className="whats-new-item-num">{newReviews.length}</div>
            <div className="whats-new-item-label">New reviews</div>
          </div>
          {newNeg.length > 0 && (
            <div className="whats-new-item">
              <div className="whats-new-item-num" style={{ color: "#fca5a5" }}>{newNeg.length}</div>
              <div className="whats-new-item-label">Negative — need attention</div>
            </div>
          )}
          {newActionable.length > 0 && (
            <div className="whats-new-item">
              <div className="whats-new-item-num" style={{ color: "#fcd34d" }}>{newActionable.length}</div>
              <div className="whats-new-item-label">Actionable insights</div>
            </div>
          )}
          {newAi.length > 0 && (
            <div className="whats-new-item">
              <div className="whats-new-item-num" style={{ color: "#93c5fd" }}>{newAi.length}</div>
              <div className="whats-new-item-label">Likely AI-generated</div>
            </div>
          )}
        </div>
      )}
      {highlights.length > 0 && (
        <div className="whats-new-items-list">
          {highlights.map((r) => {
            const isNeg = r.analysis?.sentiment === "negative";
            const isAction = r.analysis?.actionable;
            return (
              <div key={r.review_id} className="whats-new-review">
                <div
                  className="whats-new-review-dot"
                  style={{ background: isNeg ? "#fca5a5" : isAction ? "#fcd34d" : "#6ee7b7" }}
                />
                <span>"{r.analysis?.summary || r.body.slice(0, 100)}"</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BookCard({ book, reviews, job, onSelect }: { book: Book; reviews: ReviewItem[]; job?: Job; onSelect: () => void }) {
  const raw = avgRating(reviews);
  const trueR = trueRating(reviews);
  const { pos, mix, neg } = sentimentCounts(reviews);
  const themes = topThemes(reviews);
  const aiCount = reviews.filter((r) => r.analysis?.ai_generated_flag).length;
  const actionableCount = reviews.filter((r) => r.analysis?.actionable).length;

  return (
    <article className="book-card" onClick={onSelect} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect()}>
      <div className="book-card-title">{book.title}</div>
      <div className="book-card-isbn">{book.isbn ? `ISBN ${book.isbn}` : "No ISBN"}</div>

      {/* True Rating Block */}
      {trueR != null && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.85rem" }}>
          <div className="true-rating">
            <div>
              <div className="true-rating-score">{trueR.toFixed(1)} <span className="stars" style={{ fontSize: "0.9rem" }}>★</span></div>
              <div className="true-rating-label">Verified Rating</div>
            </div>
          </div>
          {raw != null && Math.abs(raw - trueR) > 0.05 && (
            <div className="raw-rating">
              {raw.toFixed(1)} ★ raw<br />
              <span style={{ fontSize: "0.7rem", color: "var(--ink-3)" }}>
                {aiCount} AI review{aiCount !== 1 ? "s" : ""} excluded
              </span>
            </div>
          )}
        </div>
      )}

      {/* Sentiment bar */}
      {(pos + mix + neg) > 0 && <SentimentBar pos={pos} mix={mix} neg={neg} />}

      {/* Theme pills */}
      {themes.length > 0 && (
        <div className="book-card-metrics" style={{ marginTop: "0.75rem" }}>
          {themes.map((t) => <span key={t} className="theme-tag">{t}</span>)}
        </div>
      )}

      <div className="book-card-footer">
        <span>{reviews.length} review{reviews.length !== 1 ? "s" : ""}</span>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          {actionableCount > 0 && <span className="badge-action badge" style={{ fontSize: "0.7rem" }}>⚡ {actionableCount} actions</span>}
          {job && (
            <span className={`badge ${job.status === "completed" ? "badge-job" : job.status === "running" ? "badge-job-running" : "badge-neutral"}`}>
              {job.status}
            </span>
          )}
        </div>
      </div>

      <div style={{ marginTop: "0.75rem", fontSize: "0.78rem", color: "var(--accent)", fontWeight: 600 }}>
        View deep-dive →
      </div>
    </article>
  );
}

export function CatalogView({ author, books, bookReviews, jobs, onSelectBook, lastVisit }: Props) {
  const allReviews = books.flatMap((b) => bookReviews[b.id] ?? []);
  const totalReviews = allReviews.length;
  const rawAvg = avgRating(allReviews);
  const trueAvg = trueRating(allReviews);
  const { pos, neg } = sentimentCounts(allReviews);
  const actionableTotal = allReviews.filter((r) => r.analysis?.actionable).length;
  const sentPct = totalReviews > 0 ? Math.round((pos / totalReviews) * 100) : 0;

  return (
    <div className="page">
      {/* Greeting */}
      <div style={{ marginBottom: "1.5rem" }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)", marginBottom: "0.25rem" }}>
          Author Intelligence Dashboard
        </div>
        <h1 style={{ fontSize: "1.55rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          Welcome back, {author?.name ?? "Author"}
        </h1>
        <p style={{ color: "var(--ink-2)", fontSize: "0.9rem", marginTop: "0.2rem" }}>
          {books.length} book{books.length !== 1 ? "s" : ""} in your catalog
          {totalReviews > 0 ? ` · ${totalReviews} reviews analyzed` : ""}
        </p>
      </div>

      {/* Stats row */}
      {totalReviews > 0 && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{totalReviews}</div>
            <div className="stat-label">Reviews analyzed</div>
          </div>
          {trueAvg != null && (
            <div className="stat-card" style={{ borderColor: "var(--accent)", background: "rgba(15,118,110,0.04)" }}>
              <div className="stat-value" style={{ color: "var(--accent)" }}>{trueAvg.toFixed(1)} ★</div>
              <div className="stat-label">Verified Rating</div>
              <div className="stat-sub">AI reviews excluded</div>
            </div>
          )}
          {rawAvg != null && (
            <div className="stat-card">
              <div className="stat-value">{rawAvg.toFixed(1)} ★</div>
              <div className="stat-label">Raw Avg Rating</div>
            </div>
          )}
          <div className="stat-card">
            <div className="stat-value" style={{ color: "var(--green)" }}>{sentPct}%</div>
            <div className="stat-label">Positive</div>
            <div className="stat-sub">{neg} negative</div>
          </div>
          {actionableTotal > 0 && (
            <div className="stat-card" style={{ borderColor: "#f59e0b" }}>
              <div className="stat-value" style={{ color: "var(--amber)" }}>{actionableTotal}</div>
              <div className="stat-label">Action Items</div>
              <div className="stat-sub">readers want a response</div>
            </div>
          )}
        </div>
      )}

      {/* What's New */}
      {totalReviews > 0 && (
        <WhatsNew books={books} bookReviews={bookReviews} lastVisit={lastVisit} />
      )}

      {/* Book grid */}
      <div className="section-head">
        <div className="section-title">Your Catalog</div>
        <div className="section-sub">{books.length} book{books.length !== 1 ? "s" : ""}</div>
      </div>

      {books.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📚</div>
          <div className="empty-title">No books yet</div>
          <div className="empty-desc">Go to Setup to add your first book and run analysis.</div>
        </div>
      ) : (
        <div className="book-grid">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              reviews={bookReviews[book.id] ?? []}
              job={jobs[book.id]}
              onSelect={() => onSelectBook(book)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
