import { useState } from "react";
import type { Book, ReviewItem } from "../types/domain";

type SentFilter = "all" | "positive" | "mixed" | "negative";

type Props = {
  book: Book;
  reviews: ReviewItem[];
  loading: boolean;
  onBack: () => void;
};

function starsStr(n: number) {
  const full = Math.round(n);
  return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
}

function avgOf(reviews: ReviewItem[], predicate?: (r: ReviewItem) => boolean) {
  const rs = predicate ? reviews.filter(predicate) : reviews;
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
  const counts: Record<string, number> = {};
  for (const r of reviews) {
    for (const t of r.analysis?.themes ?? []) {
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
}

function SentimentBar({ pos, mix, neg }: { pos: number; mix: number; neg: number }) {
  const total = pos + mix + neg || 1;
  return (
    <div className="sentiment-bar-wrap">
      <div className="sentiment-bar" style={{ height: "10px" }}>
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

function ReviewCard({ review }: { review: ReviewItem }) {
  const s = review.analysis?.sentiment;
  const borderClass = s === "positive" ? "rc-positive" : s === "mixed" ? "rc-mixed" : s === "negative" ? "rc-negative" : "";
  return (
    <article className={`review-card ${borderClass}`}>
      <div className="review-head">
        <div className="review-title">{review.title || "Untitled"}</div>
        {s && (
          <span className={`badge badge-${s}`}>{s}</span>
        )}
      </div>
      <div className="review-summary">
        {review.analysis?.summary || review.body.slice(0, 160)}
      </div>
      {review.analysis?.themes && review.analysis.themes.length > 0 && (
        <div className="review-tags">
          {review.analysis.themes.map((t) => <span key={t} className="theme-tag">{t}</span>)}
        </div>
      )}
      {review.analysis?.actionable && review.analysis.actionability_reason && (
        <div className="action-reason">⚡ {review.analysis.actionability_reason}</div>
      )}
      <div className="review-foot">
        <span className="stars" style={{ fontSize: "0.82rem" }}>
          {review.rating != null ? starsStr(review.rating) : "—"}
        </span>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          {review.analysis?.ai_generated_flag && <span className="ai-flag">AI</span>}
          {review.analysis?.actionable && <span className="action-flag">actionable</span>}
        </div>
      </div>
    </article>
  );
}

export function BookDetailView({ book, reviews, loading, onBack }: Props) {
  const [sentFilter, setSentFilter] = useState<SentFilter>("all");
  const [actionableOnly, setActionableOnly] = useState(false);
  const [aiFlaggedOnly, setAiFlaggedOnly] = useState(false);

  const raw = avgOf(reviews);
  const trueR = avgOf(reviews, (r) => !r.analysis?.ai_generated_flag);
  const { pos, mix, neg } = sentimentCounts(reviews);
  const themes = topThemes(reviews);
  const maxThemeCount = themes[0]?.[1] ?? 1;
  const aiCount = reviews.filter((r) => r.analysis?.ai_generated_flag).length;
  const actionableCount = reviews.filter((r) => r.analysis?.actionable).length;

  const filtered = reviews.filter((r) => {
    if (sentFilter !== "all" && r.analysis?.sentiment !== sentFilter) return false;
    if (actionableOnly && !r.analysis?.actionable) return false;
    if (aiFlaggedOnly && !r.analysis?.ai_generated_flag) return false;
    return true;
  });

  return (
    <div className="page">
      <button className="back-btn" onClick={onBack}>← Back to Catalog</button>

      {/* Book header */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)", marginBottom: "0.25rem" }}>
              Per-Book Analysis
            </div>
            <h1 style={{ fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "0.25rem" }}>
              {book.title}
            </h1>
            {book.isbn && <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginBottom: "0.75rem" }}>ISBN {book.isbn}</div>}
            <SentimentBar pos={pos} mix={mix} neg={neg} />
          </div>

          {/* True Rating + Raw */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", alignItems: "flex-end" }}>
            {trueR != null && (
              <div className="true-rating">
                <div>
                  <div className="true-rating-score">{trueR.toFixed(2)} ★</div>
                  <div className="true-rating-label">Verified Rating</div>
                </div>
              </div>
            )}
            {raw != null && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--ink-2)" }}>{raw.toFixed(2)} ★ raw</div>
                {trueR != null && Math.abs(raw - trueR) > 0.05 && (
                  <div style={{ fontSize: "0.74rem", color: aiCount > 0 ? "var(--red)" : "var(--green)", marginTop: "0.1rem" }}>
                    {aiCount > 0
                      ? `↑ ${(trueR - raw).toFixed(2)} after removing ${aiCount} AI review${aiCount !== 1 ? "s" : ""}`
                      : "No AI reviews detected"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick stats */}
        <div style={{ display: "flex", gap: "1rem", marginTop: "1.25rem", flexWrap: "wrap" }}>
          <div style={{ fontSize: "0.82rem", color: "var(--ink-2)" }}><strong style={{ color: "var(--ink)" }}>{reviews.length}</strong> total reviews</div>
          {actionableCount > 0 && <div style={{ fontSize: "0.82rem", color: "var(--amber)" }}><strong>⚡ {actionableCount}</strong> actionable</div>}
          {aiCount > 0 && <div style={{ fontSize: "0.82rem", color: "var(--blue)" }}><strong>🤖 {aiCount}</strong> likely AI-generated</div>}
        </div>
      </div>

      <div className="two-col" style={{ marginBottom: "1.5rem" }}>
        {/* Theme breakdown */}
        {themes.length > 0 && (
          <div className="card card-sm">
            <div style={{ fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: "1rem" }}>
              Theme Breakdown
            </div>
            <div className="theme-list">
              {themes.map(([name, count]) => (
                <div key={name} className="theme-row">
                  <div className="theme-name">{name}</div>
                  <div className="theme-bar-bg">
                    <div className="theme-bar-fill" style={{ width: `${(count / maxThemeCount) * 100}%` }} />
                  </div>
                  <div className="theme-count">{count}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actionable summary */}
        {actionableCount > 0 && (
          <div className="card card-sm">
            <div style={{ fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: "1rem" }}>
              Action Items · {actionableCount} Reviews
            </div>
            <div className="gap-row">
              {reviews
                .filter((r) => r.analysis?.actionable)
                .slice(0, 4)
                .map((r) => (
                  <div
                    key={r.review_id}
                    style={{ borderLeft: "3px solid var(--amber)", paddingLeft: "0.75rem", paddingTop: "0.1rem", paddingBottom: "0.1rem" }}
                  >
                    <div style={{ fontSize: "0.84rem", color: "var(--ink-2)", lineHeight: 1.5 }}>
                      "{r.analysis?.summary || r.body.slice(0, 100)}"
                    </div>
                    {r.analysis?.actionability_reason && (
                      <div style={{ fontSize: "0.75rem", color: "var(--amber)", marginTop: "0.2rem" }}>
                        {r.analysis.actionability_reason}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Reviews section */}
      <div className="section-head">
        <div className="section-title">Reviews</div>
        <div className="section-sub">{filtered.length} of {reviews.length}</div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        {(["all", "positive", "mixed", "negative"] as SentFilter[]).map((f) => (
          <button
            key={f}
            className={`filter-chip ${sentFilter === f ? (f === "all" ? "fc-active" : f === "positive" ? "fc-active" : f === "mixed" ? "fc-amber" : "fc-active") : ""}`}
            style={sentFilter === f && f === "negative" ? { background: "var(--red)", borderColor: "var(--red)", color: "#fff" } : {}}
            onClick={() => setSentFilter(f)}
          >
            {f === "all" ? "All" : f === "positive" ? "✓ Positive" : f === "mixed" ? "~ Mixed" : "✗ Negative"}
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
              <div className="sk-block" style={{ height: 16, width: "70%", marginBottom: 8 }} />
              <div className="sk-block" style={{ height: 12, width: "90%", marginBottom: 6 }} />
              <div className="sk-block" style={{ height: 12, width: "60%" }} />
            </div>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="empty">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">No reviews match this filter</div>
          <div className="empty-desc">Try removing some filters.</div>
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
