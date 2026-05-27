import { useState } from "react";
import { deleteBook } from "../api/reviewpulse";
import type { Book, ReviewItem } from "../types/domain";

type SentFilter = "all" | "positive" | "mixed" | "negative";

type Props = {
  book: Book;
  reviews: ReviewItem[];
  loading: boolean;
  authorId: string;
  onBack: () => void;
  onDelete: (bookId: string) => void;
};

/* ── helpers ─────────────────────────── */
function starsStr(n: number) {
  const r = Math.round(n);
  return "★".repeat(r) + "☆".repeat(Math.max(0, 5 - r));
}

function avg(reviews: ReviewItem[], onlyReal = false) {
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

function topThemes(reviews: ReviewItem[]) {
  const c: Record<string, number> = {};
  for (const r of reviews) for (const t of r.analysis?.themes ?? []) c[t] = (c[t] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

function totalCost(reviews: ReviewItem[]) {
  return reviews.reduce((s, r) => s + (r.analysis?.cost_usd ?? 0), 0);
}

/* ── F5: Weekly sentiment trend ─────── */
function weeklyTrend(reviews: ReviewItem[]) {
  const groups: Record<string, { pos: number; mix: number; neg: number }> = {};
  for (const r of reviews) {
    if (!r.review_date || !r.analysis) continue;
    const d = new Date(r.review_date);
    // Monday of that week as key
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const key = monday.toISOString().slice(0, 10);
    if (!groups[key]) groups[key] = { pos: 0, mix: 0, neg: 0 };
    if (r.analysis.sentiment === "positive") groups[key].pos++;
    else if (r.analysis.sentiment === "mixed") groups[key].mix++;
    else groups[key].neg++;
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-10)
    .map(([key, counts]) => ({
      label: new Date(key).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      ...counts,
      total: counts.pos + counts.mix + counts.neg,
    }));
}

/* ── Sentiment bar ───────────────────── */
function SentimentBar({ pos, mix, neg }: { pos: number; mix: number; neg: number }) {
  const total = pos + mix + neg || 1;
  return (
    <div className="sentiment-bar-wrap">
      <div className="sentiment-bar" style={{ height: 9 }}>
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

/* ── Review card ─────────────────────── */
function ReviewCard({ review }: { review: ReviewItem }) {
  const s = review.analysis?.sentiment;
  const cls = s === "positive" ? "rc-positive" : s === "mixed" ? "rc-mixed" : s === "negative" ? "rc-negative" : "";
  return (
    <article className={`review-card ${cls}`}>
      <div className="review-head">
        <div className="review-title">{review.title || "Untitled"}</div>
        {s && <span className={`badge badge-${s}`}>{s}</span>}
      </div>
      <div className="review-summary">
        {review.analysis?.summary || review.body.slice(0, 160)}
      </div>
      {(review.analysis?.themes?.length ?? 0) > 0 && (
        <div className="review-tags">
          {review.analysis!.themes.map((t) => <span key={t} className="theme-tag">{t}</span>)}
        </div>
      )}
      {review.analysis?.actionable && review.analysis.actionability_reason && (
        <div className="action-reason">⚡ {review.analysis.actionability_reason}</div>
      )}
      <div className="review-foot">
        <span className="stars" style={{ fontSize: "0.8rem" }}>
          {review.rating != null ? starsStr(review.rating) : "—"}
        </span>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          {review.analysis?.ai_generated_flag && (
            <span style={{ background: "var(--blue-light)", color: "#1e40af", borderRadius: 4, padding: "0.1rem 0.35rem", fontSize: "0.68rem", fontWeight: 700 }}>AI</span>
          )}
          {review.analysis?.actionable && (
            <span style={{ background: "#fff7ed", color: "#c2410c", borderRadius: 4, padding: "0.1rem 0.35rem", fontSize: "0.68rem", fontWeight: 700 }}>actionable</span>
          )}
        </div>
      </div>
    </article>
  );
}

/* ── Main ────────────────────────────── */
export function BookPage({ book, reviews, loading, authorId, onBack, onDelete }: Props) {
  const [sentFilter, setSentFilter] = useState<SentFilter>("all");
  const [actionableOnly, setActionableOnly] = useState(false);
  const [aiFlaggedOnly, setAiFlaggedOnly] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm(`Remove "${book.title}" and all its reviews? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteBook(book.id, authorId);
      onDelete(book.id);
    } finally {
      setDeleting(false);
    }
  }

  const rawAvg = avg(reviews);
  const trueR = avg(reviews, true);
  const { pos, mix, neg } = sentimentCounts(reviews);
  const themes = topThemes(reviews);
  const maxTheme = themes[0]?.[1] ?? 1;
  const aiCount = reviews.filter((r) => r.analysis?.ai_generated_flag).length;
  const actionableReviews = reviews.filter((r) => r.analysis?.actionable);
  const cost = totalCost(reviews);
  const trend = weeklyTrend(reviews);

  const filtered = reviews.filter((r) => {
    if (sentFilter !== "all" && r.analysis?.sentiment !== sentFilter) return false;
    if (actionableOnly && !r.analysis?.actionable) return false;
    if (aiFlaggedOnly && !r.analysis?.ai_generated_flag) return false;
    return true;
  });

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <button className="back-btn" onClick={onBack} style={{ margin: 0 }}>← My Books</button>
        <button
          className="btn btn-ghost"
          onClick={handleDelete}
          disabled={deleting}
          style={{ fontSize: "0.82rem", color: "var(--red)", borderColor: "var(--red)", padding: "0.35rem 0.85rem" }}
        >
          {deleting ? "Removing…" : "Remove Book"}
        </button>
      </div>

      {/* Book header */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1.25rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)", marginBottom: "0.2rem" }}>
              Book Deep Dive
            </div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "0.25rem" }}>
              {book.title}
            </h1>
            {book.isbn && <div style={{ fontSize: "0.74rem", color: "var(--ink-3)", marginBottom: "0.75rem" }}>ISBN {book.isbn}</div>}
            <SentimentBar pos={pos} mix={mix} neg={neg} />
            <div style={{ display: "flex", gap: "1.25rem", marginTop: "0.85rem", flexWrap: "wrap", fontSize: "0.83rem", color: "var(--ink-2)" }}>
              <span><strong style={{ color: "var(--ink)" }}>{reviews.length}</strong> reviews</span>
              {actionableReviews.length > 0 && (
                <span style={{ color: "var(--amber)" }}><strong>⚡ {actionableReviews.length}</strong> actionable</span>
              )}
              {aiCount > 0 && (
                <span style={{ color: "var(--blue)" }}><strong>🤖 {aiCount}</strong> AI-detected</span>
              )}
              {cost > 0 && (
                <span style={{ color: "var(--ink-3)" }}>Analysis cost: <strong>${cost.toFixed(4)}</strong></span>
              )}
            </div>
          </div>

          {/* True Rating */}
          {trueR != null && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
              <div className="true-rating">
                <div>
                  <div className="true-rating-score">{trueR.toFixed(2)} ★</div>
                  <div className="true-rating-label">Verified Rating</div>
                </div>
              </div>
              {rawAvg != null && (
                <div style={{ textAlign: "right", fontSize: "0.82rem", color: "var(--ink-2)" }}>
                  {rawAvg.toFixed(2)} ★ raw
                  {aiCount > 0 && Math.abs(rawAvg - trueR) > 0.05 && (
                    <div style={{ fontSize: "0.72rem", color: "var(--accent)", marginTop: "0.1rem" }}>
                      +{(trueR - rawAvg).toFixed(2)} after removing {aiCount} AI
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Two-column: Themes + Trend */}
      <div className="two-col" style={{ marginBottom: "1.5rem" }}>
        {/* Theme breakdown */}
        {themes.length > 0 && (
          <div className="card card-sm">
            <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: "0.85rem" }}>
              Theme Breakdown
            </div>
            <div className="theme-list">
              {themes.map(([name, count]) => (
                <div key={name} className="theme-row">
                  <div className="theme-name">{name}</div>
                  <div className="theme-bar-bg">
                    <div className="theme-bar-fill" style={{ width: `${(count / maxTheme) * 100}%` }} />
                  </div>
                  <div className="theme-count">{count}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* F5 Sentiment trend by week */}
        {trend.length >= 2 && (
          <div className="card card-sm">
            <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: "0.85rem" }}>
              Sentiment Trend · by Week
            </div>
            <div className="trend-chart">
              {trend.map(({ label, pos: p, mix: m, neg: n, total }) => (
                <div key={label} className="trend-row">
                  <div className="trend-label">{label}</div>
                  <div className="trend-bar-stack">
                    <div className="trend-pos" style={{ width: `${(p / total) * 100}%` }} />
                    <div className="trend-mix" style={{ width: `${(m / total) * 100}%` }} />
                    <div className="trend-neg" style={{ width: `${(n / total) * 100}%` }} />
                  </div>
                  <div className="trend-total">{total}</div>
                </div>
              ))}
            </div>
            <div className="sentiment-legend" style={{ marginTop: "0.65rem" }}>
              <span><span className="legend-dot ld-pos" />pos</span>
              <span><span className="legend-dot ld-mix" />mix</span>
              <span><span className="legend-dot ld-neg" />neg</span>
            </div>
          </div>
        )}
      </div>

      {/* Actionable spotlight */}
      {actionableReviews.length > 0 && (
        <div className="card card-sm" style={{ marginBottom: "1.5rem", borderLeft: "3px solid var(--amber)" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--amber)", marginBottom: "0.85rem" }}>
            ⚡ Action Items · {actionableReviews.length} Reviews
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {actionableReviews.slice(0, 3).map((r) => (
              <div key={r.review_id} style={{ borderLeft: "2px solid var(--amber)", paddingLeft: "0.7rem" }}>
                <div style={{ fontSize: "0.84rem", color: "var(--ink-2)", lineHeight: 1.5 }}>
                  "{r.analysis?.summary || r.body.slice(0, 120)}"
                </div>
                {r.analysis?.actionability_reason && (
                  <div style={{ fontSize: "0.74rem", color: "var(--amber)", marginTop: "0.2rem" }}>
                    {r.analysis.actionability_reason}
                  </div>
                )}
              </div>
            ))}
            {actionableReviews.length > 3 && (
              <div style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>
                + {actionableReviews.length - 3} more — filter by "Actionable" below
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reviews section */}
      <div className="section-head">
        <div className="section-title">All Reviews</div>
        <div className="section-sub">{filtered.length} of {reviews.length}</div>
      </div>

      <div className="filter-bar">
        {(["all", "positive", "mixed", "negative"] as SentFilter[]).map((f) => (
          <button
            key={f}
            className={`filter-chip ${
              sentFilter === f
                ? f === "negative" ? "fc-active" : f === "mixed" ? "fc-amber" : "fc-active"
                : ""
            }`}
            style={sentFilter === f && f === "negative" ? { background: "var(--red)", borderColor: "var(--red)", color: "#fff" } : {}}
            onClick={() => setSentFilter(f)}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
        <button
          className={`filter-chip ${actionableOnly ? "fc-amber" : ""}`}
          onClick={() => setActionableOnly((v) => !v)}
        >
          ⚡ Actionable
        </button>
        {aiCount > 0 && (
          <button
            className={`filter-chip ${aiFlaggedOnly ? "fc-blue" : ""}`}
            onClick={() => setAiFlaggedOnly((v) => !v)}
          >
            🤖 AI-Flagged
          </button>
        )}
      </div>

      {loading && (
        <div className="review-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="review-card skeleton">
              <div className="sk-block" style={{ height: 15, width: "65%", marginBottom: 8 }} />
              <div className="sk-block" style={{ height: 11, width: "90%", marginBottom: 6 }} />
              <div className="sk-block" style={{ height: 11, width: "55%" }} />
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="empty">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">No reviews match</div>
          <div className="empty-desc">Clear some filters to see more reviews.</div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="review-grid">
          {filtered.map((r) => <ReviewCard key={r.review_id} review={r} />)}
        </div>
      )}
    </div>
  );
}
