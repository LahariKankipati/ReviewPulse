import type { Book, ReviewItem, Session } from "../types/domain";

type Props = {
  session: Session;
  books: Book[];
  bookReviews: Record<string, ReviewItem[]>;
  loading: boolean;
  onSelectBook: (book: Book) => void;
};

/* ── helpers ─────────────────────────── */
function starsStr(n: number) {
  const r = Math.round(n);
  return "★".repeat(r) + "☆".repeat(Math.max(0, 5 - r));
}

function avgRating(reviews: ReviewItem[], onlyReal = false) {
  const rs = onlyReal ? reviews.filter((r) => !r.analysis?.ai_generated_flag) : reviews;
  const rated = rs.filter((r) => r.rating != null);
  if (!rated.length) return null;
  return rated.reduce((s, r) => s + r.rating!, 0) / rated.length;
}

function sentimentCounts(reviews: ReviewItem[]) {
  let pos = 0, mix = 0, neg = 0;
  for (const r of reviews) {
    if (r.analysis?.sentiment === "positive") pos++;
    else if (r.analysis?.sentiment === "mixed") mix++;
    else if (r.analysis?.sentiment === "negative") neg++;
  }
  return { pos, mix, neg };
}

function topThemes(reviews: ReviewItem[], n = 3) {
  const c: Record<string, number> = {};
  for (const r of reviews) for (const t of r.analysis?.themes ?? []) c[t] = (c[t] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
}

function totalCost(reviews: ReviewItem[]) {
  return reviews.reduce((s, r) => s + (r.analysis?.cost_usd ?? 0), 0);
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "your last visit";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ── Sentiment bar ───────────────────── */
function SentimentBar({ pos, mix, neg, height = 6 }: { pos: number; mix: number; neg: number; height?: number }) {
  const total = pos + mix + neg || 1;
  return (
    <div className="sentiment-bar-wrap">
      <div className="sentiment-bar" style={{ height }}>
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

/* ── New Since Login section ─────────── */
function NewSinceLogin({ reviews, lastLoginAt, books }: {
  reviews: ReviewItem[];
  lastLoginAt: string | null;
  books: Book[];
}) {
  const bookMap = Object.fromEntries(books.map((b) => [b.id, b]));
  const cutoff = lastLoginAt ? new Date(lastLoginAt) : null;

  // Use review_date against cutoff, or fall back to showing "recent" synthetics
  const newRevs = cutoff
    ? reviews.filter((r) => r.review_date && new Date(r.review_date) > cutoff)
    : [];

  // Count by type
  const neg = newRevs.filter((r) => r.analysis?.sentiment === "negative");
  const actionable = newRevs.filter((r) => r.analysis?.actionable);
  const ai = newRevs.filter((r) => r.analysis?.ai_generated_flag);

  if (!cutoff || newRevs.length === 0) {
    return (
      <div className="new-since-wrap" style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontSize: "1.2rem" }}>✓</span>
        <div>
          <div style={{ color: "#5eead4", fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            All caught up
          </div>
          <div style={{ color: "#d6d3d1", fontSize: "0.9rem", marginTop: "0.15rem" }}>
            No new reviews since {formatDate(lastLoginAt)}.
          </div>
        </div>
      </div>
    );
  }

  // Show at most 6 cards, prioritise negative + actionable
  const priority = [
    ...neg.slice(0, 2),
    ...actionable.filter((r) => !neg.includes(r)).slice(0, 2),
    ...newRevs.filter((r) => !neg.includes(r) && !actionable.includes(r)).slice(0, 2),
  ].slice(0, 6);

  return (
    <div className="new-since-wrap">
      <div className="new-since-kicker">New since {formatDate(lastLoginAt)}</div>
      <div className="new-since-head">
        {newRevs.length} new review{newRevs.length !== 1 ? "s" : ""} arrived while you were away
      </div>

      <div className="new-since-counts">
        <div className="new-since-count-item">
          <div className="nsc-dot" style={{ background: "#6ee7b7" }} />
          <span className="nsc-val">{newRevs.length}</span>
          <span className="nsc-label">total</span>
        </div>
        {neg.length > 0 && (
          <div className="new-since-count-item">
            <div className="nsc-dot" style={{ background: "#f87171" }} />
            <span className="nsc-val">{neg.length}</span>
            <span className="nsc-label">negative</span>
          </div>
        )}
        {actionable.length > 0 && (
          <div className="new-since-count-item">
            <div className="nsc-dot" style={{ background: "#fcd34d" }} />
            <span className="nsc-val">{actionable.length}</span>
            <span className="nsc-label">actionable</span>
          </div>
        )}
        {ai.length > 0 && (
          <div className="new-since-count-item">
            <div className="nsc-dot" style={{ background: "#93c5fd" }} />
            <span className="nsc-val">{ai.length}</span>
            <span className="nsc-label">likely AI</span>
          </div>
        )}
      </div>

      <div className="new-since-reviews">
        {priority.map((r) => {
          const isNeg = r.analysis?.sentiment === "negative";
          const isAction = r.analysis?.actionable;
          const cls = isNeg ? "nsc-negative" : isAction ? "nsc-actionable" : "nsc-positive";
          const bookTitle = Object.values(bookMap).find((b) =>
            (r as ReviewItem & { book_id?: string }).book_id === b.id
          )?.title;
          return (
            <div key={r.review_id} className={`new-since-card ${cls}`}>
              <div className="new-since-card-title">{r.title || "Untitled review"}</div>
              <div className="new-since-card-body">
                {r.analysis?.summary || r.body.slice(0, 120)}
              </div>
              <div className="new-since-card-foot">
                {r.analysis?.sentiment && (
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: isNeg ? "#f87171" : isAction ? "#fcd34d" : "#6ee7b7", textTransform: "capitalize" }}>
                    {r.analysis.sentiment}
                  </span>
                )}
                {isAction && <span style={{ fontSize: "0.72rem", color: "#fcd34d" }}>⚡ actionable</span>}
                {bookTitle && <span style={{ fontSize: "0.7rem", color: "#57534e" }}>{bookTitle}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Book card ───────────────────────── */
function BookCard({ book, reviews, onSelect }: { book: Book; reviews: ReviewItem[]; onSelect: () => void }) {
  const raw = avgRating(reviews);
  const trueR = avgRating(reviews, true);
  const { pos, mix, neg } = sentimentCounts(reviews);
  const themes = topThemes(reviews);
  const aiCount = reviews.filter((r) => r.analysis?.ai_generated_flag).length;
  const actionableCount = reviews.filter((r) => r.analysis?.actionable).length;
  const cost = totalCost(reviews);

  return (
    <article className="book-card" onClick={onSelect} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect()}>
      <div className="book-card-title">{book.title}</div>
      <div className="book-card-isbn">{book.isbn ? `ISBN ${book.isbn}` : " "}</div>

      {trueR != null && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "0.85rem" }}>
          <div className="true-rating">
            <div>
              <div className="true-rating-score">{trueR.toFixed(1)} <span className="stars" style={{ fontSize: "0.85rem" }}>★</span></div>
              <div className="true-rating-label">Verified</div>
            </div>
          </div>
          {raw != null && (
            <div style={{ fontSize: "0.8rem", color: "var(--ink-2)" }}>
              {raw.toFixed(1)} ★ raw
              {aiCount > 0 && (
                <div style={{ fontSize: "0.7rem", color: "var(--ink-3)" }}>{aiCount} AI excluded</div>
              )}
            </div>
          )}
        </div>
      )}

      {(pos + mix + neg) > 0 && <SentimentBar pos={pos} mix={mix} neg={neg} />}

      {themes.length > 0 && (
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          {themes.map((t) => <span key={t} className="theme-tag">{t}</span>)}
        </div>
      )}

      <div className="book-card-footer">
        <span>{reviews.length} review{reviews.length !== 1 ? "s" : ""}</span>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          {actionableCount > 0 && (
            <span className="badge badge-action" style={{ fontSize: "0.7rem" }}>⚡ {actionableCount}</span>
          )}
          {cost > 0 && (
            <span style={{ fontSize: "0.7rem", color: "var(--ink-3)" }}>${cost.toFixed(3)}</span>
          )}
        </div>
      </div>
      <div style={{ marginTop: "0.75rem", fontSize: "0.78rem", color: "var(--accent)", fontWeight: 600 }}>
        View reviews →
      </div>
    </article>
  );
}

/* ── Cross-book comparison (F6) ──────── */
function CrossBookComparison({ books, bookReviews }: { books: Book[]; bookReviews: Record<string, ReviewItem[]> }) {
  const booksWithData = books.filter((b) => (bookReviews[b.id]?.length ?? 0) > 0);
  if (booksWithData.length < 2) return null;

  return (
    <div className="card" style={{ marginTop: "2rem" }}>
      <div className="section-head" style={{ marginBottom: "0" }}>
        <div className="section-title">Book Comparison</div>
        <div className="section-sub">side-by-side across your catalog</div>
      </div>
      <div style={{ overflowX: "auto", marginTop: "1rem" }}>
        <table className="compare-table">
          <thead>
            <tr>
              <th></th>
              {booksWithData.map((b) => <th key={b.id}>{b.title}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Verified Rating</td>
              {booksWithData.map((b) => {
                const r = avgRating(bookReviews[b.id] ?? [], true);
                return <td key={b.id} className="ct-highlight">{r != null ? `${r.toFixed(1)} ★` : "—"}</td>;
              })}
            </tr>
            <tr>
              <td>Raw Rating</td>
              {booksWithData.map((b) => {
                const r = avgRating(bookReviews[b.id] ?? []);
                return <td key={b.id}>{r != null ? `${r.toFixed(1)} ★` : "—"}</td>;
              })}
            </tr>
            <tr>
              <td>Positive Reviews</td>
              {booksWithData.map((b) => {
                const revs = bookReviews[b.id] ?? [];
                const pos = revs.filter((r) => r.analysis?.sentiment === "positive").length;
                const pct = revs.length > 0 ? Math.round((pos / revs.length) * 100) : 0;
                return <td key={b.id}>{pct}% ({pos})</td>;
              })}
            </tr>
            <tr>
              <td>Actionable</td>
              {booksWithData.map((b) => {
                const cnt = (bookReviews[b.id] ?? []).filter((r) => r.analysis?.actionable).length;
                return <td key={b.id}>{cnt > 0 ? `⚡ ${cnt}` : "0"}</td>;
              })}
            </tr>
            <tr>
              <td>AI-Detected</td>
              {booksWithData.map((b) => {
                const cnt = (bookReviews[b.id] ?? []).filter((r) => r.analysis?.ai_generated_flag).length;
                return <td key={b.id}>{cnt > 0 ? `🤖 ${cnt} excluded` : "none"}</td>;
              })}
            </tr>
            <tr>
              <td>Total Reviews</td>
              {booksWithData.map((b) => <td key={b.id}>{bookReviews[b.id]?.length ?? 0}</td>)}
            </tr>
            <tr>
              <td>Analysis Cost</td>
              {booksWithData.map((b) => {
                const cost = totalCost(bookReviews[b.id] ?? []);
                return <td key={b.id}>{cost > 0 ? `$${cost.toFixed(4)}` : "—"}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Main ────────────────────────────── */
export function DashboardPage({ session, books, bookReviews, loading, onSelectBook }: Props) {
  const allReviews = books.flatMap((b) => bookReviews[b.id] ?? []);
  const trueAvg = avgRating(allReviews, true);
  const rawAvg = avgRating(allReviews);
  const { pos, neg } = sentimentCounts(allReviews);
  const actionableTotal = allReviews.filter((r) => r.analysis?.actionable).length;
  const sentPct = allReviews.length > 0 ? Math.round((pos / allReviews.length) * 100) : 0;
  const totalCostAll = totalCost(allReviews);
  const aiTotal = allReviews.filter((r) => r.analysis?.ai_generated_flag).length;

  if (loading && books.length === 0) {
    return (
      <div className="page">
        <div style={{ display: "flex", gap: "0.75rem", flexDirection: "column" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="card skeleton">
              <div className="sk-block" style={{ height: 18, width: "40%", marginBottom: 12 }} />
              <div className="sk-block" style={{ height: 12, width: "70%" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Page header */}
      <div style={{ marginBottom: "1.75rem" }}>
        <div style={{ fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)", marginBottom: "0.2rem" }}>
          Author Dashboard
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          Hi, {session.name ?? session.email.split("@")[0]}
        </h1>
        {books.length > 0 && allReviews.length > 0 && (
          <p style={{ color: "var(--ink-2)", fontSize: "0.88rem", marginTop: "0.2rem" }}>
            {books.length} book{books.length !== 1 ? "s" : ""} · {allReviews.length} reviews analyzed
          </p>
        )}
      </div>

      {/* New since login — always first */}
      {allReviews.length > 0 && (
        <NewSinceLogin
          reviews={allReviews}
          lastLoginAt={session.last_login_at}
          books={books}
        />
      )}

      {/* Stats strip */}
      {allReviews.length > 0 && (
        <div className="stats-row">
          {trueAvg != null && (
            <div className="stat-card" style={{ borderColor: "var(--accent)", background: "rgba(15,118,110,0.03)" }}>
              <div className="stat-value" style={{ color: "var(--accent)" }}>{trueAvg.toFixed(1)} ★</div>
              <div className="stat-label">Verified Rating</div>
              {aiTotal > 0 && <div className="stat-sub">{aiTotal} AI excluded</div>}
            </div>
          )}
          {rawAvg != null && (
            <div className="stat-card">
              <div className="stat-value">{rawAvg.toFixed(1)} ★</div>
              <div className="stat-label">Raw Rating</div>
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
              <div className="stat-sub">readers flagged these</div>
            </div>
          )}
          {totalCostAll > 0 && (
            <div className="stat-card">
              <div className="stat-value" style={{ fontSize: "1.2rem" }}>${totalCostAll.toFixed(4)}</div>
              <div className="stat-label">Analysis Cost</div>
              <div className="stat-sub">total LLM spend</div>
            </div>
          )}
        </div>
      )}

      {/* Books */}
      <div className="section-head">
        <div className="section-title">Your Books</div>
        <div className="section-sub">{books.length} in catalog</div>
      </div>

      {books.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📚</div>
          <div className="empty-title">No books yet</div>
          <div className="empty-desc">Use "Add Book" to add your first title and run analysis.</div>
        </div>
      ) : (
        <div className="book-grid">
          {books.map((b) => (
            <BookCard
              key={b.id}
              book={b}
              reviews={bookReviews[b.id] ?? []}
              onSelect={() => onSelectBook(b)}
            />
          ))}
        </div>
      )}

      {/* Cross-book comparison (F6) */}
      <CrossBookComparison books={books} bookReviews={bookReviews} />
    </div>
  );
}
