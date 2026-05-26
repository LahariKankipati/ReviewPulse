import type { Author, Book, ReviewItem } from "../types/domain";

type Props = {
  author: Author | null;
  books: Book[];
  bookReviews: Record<string, ReviewItem[]>;
};

function avgRating(reviews: ReviewItem[], filter?: (r: ReviewItem) => boolean) {
  const rs = filter ? reviews.filter(filter) : reviews;
  const rated = rs.filter((r) => r.rating != null);
  if (!rated.length) return null;
  return rated.reduce((s, r) => s + r.rating!, 0) / rated.length;
}

function topThemes(reviews: ReviewItem[], n = 5) {
  const counts: Record<string, number> = {};
  for (const r of reviews) {
    for (const t of r.analysis?.themes ?? []) {
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function starsStr(n: number) {
  const full = Math.round(n);
  return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
}

export function DigestView({ author, books, bookReviews }: Props) {
  const allReviews = books.flatMap((b) => bookReviews[b.id] ?? []);

  if (!author || allReviews.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon">📧</div>
          <div className="empty-title">No data for digest yet</div>
          <div className="empty-desc">Complete setup and run ingestion to generate your weekly digest preview.</div>
        </div>
      </div>
    );
  }

  const rawAvg = avgRating(allReviews);
  const trueAvg = avgRating(allReviews, (r) => !r.analysis?.ai_generated_flag);
  const themes = topThemes(allReviews);
  const maxThemeCount = themes[0]?.[1] ?? 1;

  const positiveReviews = allReviews.filter((r) => r.analysis?.sentiment === "positive");
  const negativeReviews = allReviews.filter((r) => r.analysis?.sentiment === "negative");
  const actionableReviews = allReviews.filter((r) => r.analysis?.actionable);
  const aiReviews = allReviews.filter((r) => r.analysis?.ai_generated_flag);

  const sentPct = allReviews.length > 0 ? Math.round((positiveReviews.length / allReviews.length) * 100) : 0;

  // Best positive review — most confident
  const highlight = [...positiveReviews]
    .sort((a, b) => (b.analysis?.sentiment_confidence ?? 0) - (a.analysis?.sentiment_confidence ?? 0))[0];

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const primaryBook = books[0];

  return (
    <div className="page" style={{ maxWidth: 700, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)", marginBottom: "0.4rem" }}>
          Weekly Digest Preview
        </div>
        <h1 style={{ fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          The email your readers would receive
        </h1>
        <p style={{ color: "var(--ink-2)", fontSize: "0.88rem", marginTop: "0.3rem" }}>
          This is a live preview — no actual email sent. Real send would use SendGrid or Resend.
        </p>
      </div>

      <div className="digest-email">
        {/* Email header */}
        <div className="digest-email-header">
          <div className="digest-email-logo">ReviewPulse·</div>
          <div className="digest-email-title">Your Weekly Review Intelligence</div>
          <div className="digest-email-date">{today}</div>
          {primaryBook && (
            <div style={{ marginTop: "0.75rem" }}>
              <span style={{ background: "rgba(94,234,212,0.15)", border: "1px solid rgba(94,234,212,0.3)", borderRadius: "999px", padding: "0.25rem 0.75rem", fontSize: "0.78rem", color: "#5eead4" }}>
                {primaryBook.title}
                {books.length > 1 ? ` + ${books.length - 1} more` : ""}
              </span>
            </div>
          )}
        </div>

        <div className="digest-body">
          {/* Snapshot */}
          <div className="digest-section">
            <div className="digest-section-head">This Week's Snapshot</div>
            <div className="digest-snapshot">
              <div>
                <div className="digest-snap-val">{allReviews.length}</div>
                <div className="digest-snap-label">Reviews analyzed</div>
              </div>
              <div>
                <div className="digest-snap-val" style={{ color: "var(--green)" }}>{sentPct}%</div>
                <div className="digest-snap-label">Positive</div>
              </div>
              <div>
                <div className="digest-snap-val">{rawAvg?.toFixed(1) ?? "—"} ★</div>
                <div className="digest-snap-label">Avg Rating</div>
              </div>
            </div>
          </div>

          {/* True Rating feature */}
          {trueAvg != null && rawAvg != null && (
            <div className="digest-section">
              <div className="digest-section-head">True Rating · AI Reviews Filtered</div>
              <div className="digest-true-rating">
                <div className="dtr-val">
                  <div className="dtr-score">{rawAvg.toFixed(1)} ★</div>
                  <div className="dtr-label">Raw Average</div>
                </div>
                <div className="dtr-arrow">→</div>
                <div className="dtr-val">
                  <div className="dtr-score" style={{ color: "var(--accent)" }}>{trueAvg.toFixed(1)} ★</div>
                  <div className="dtr-label">Verified (excl. {aiReviews.length} AI)</div>
                </div>
              </div>
              {aiReviews.length > 0 && (
                <p style={{ fontSize: "0.8rem", color: "var(--ink-3)", marginTop: "0.6rem", textAlign: "center" }}>
                  {aiReviews.length} review{aiReviews.length !== 1 ? "s" : ""} flagged as likely AI-generated and excluded from your verified score.
                </p>
              )}
            </div>
          )}

          {/* Reader highlight */}
          {highlight && (
            <div className="digest-section">
              <div className="digest-section-head">Reader Highlight</div>
              <div className="digest-highlight">
                "{highlight.analysis?.summary || highlight.body.slice(0, 200)}"
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginTop: "0.5rem" }}>
                <span className="stars">{starsStr(highlight.rating ?? 5)}</span>
                {" · "}{highlight.source}
              </div>
            </div>
          )}

          {/* Action items */}
          {actionableReviews.length > 0 && (
            <div className="digest-section">
              <div className="digest-section-head">Action Items · {actionableReviews.length} Reviews</div>
              {actionableReviews.slice(0, 3).map((r) => (
                <div key={r.review_id} className="digest-action-item">
                  <div style={{ fontSize: "0.88rem", color: "var(--ink-2)", lineHeight: 1.5 }}>
                    "{r.analysis?.summary || r.body.slice(0, 140)}"
                  </div>
                  {r.analysis?.actionability_reason && (
                    <div className="digest-action-label">{r.analysis.actionability_reason}</div>
                  )}
                </div>
              ))}
              {actionableReviews.length > 3 && (
                <p style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginTop: "0.5rem" }}>
                  + {actionableReviews.length - 3} more action items in your dashboard
                </p>
              )}
            </div>
          )}

          {/* Theme report */}
          {themes.length > 0 && (
            <div className="digest-section">
              <div className="digest-section-head">Top Themes This Period</div>
              {themes.map(([name, count]) => (
                <div key={name} className="digest-theme-row">
                  <div className="digest-theme-name">{name}</div>
                  <div className="digest-theme-bar">
                    <div className="digest-theme-fill" style={{ width: `${(count / maxThemeCount) * 100}%` }} />
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", width: 28, textAlign: "right", flexShrink: 0 }}>{count}</div>
                </div>
              ))}
            </div>
          )}

          {/* Negative reviews signal */}
          {negativeReviews.length > 0 && (
            <div className="digest-section">
              <div className="digest-section-head">Needs Attention · {negativeReviews.length} Negative Reviews</div>
              {negativeReviews.slice(0, 2).map((r) => (
                <div key={r.review_id} style={{ borderLeft: "3px solid var(--red)", paddingLeft: "0.8rem", marginBottom: "0.6rem" }}>
                  <div style={{ fontSize: "0.85rem", color: "var(--ink-2)" }}>
                    "{r.analysis?.summary || r.body.slice(0, 120)}"
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "var(--ink-3)", marginTop: "0.2rem" }}>
                    <span className="stars">{starsStr(r.rating ?? 1)}</span>
                    {" · "}{r.source}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="digest-footer">
          ReviewPulse · Review Intelligence for Independent Authors
          <br />
          <span style={{ color: "var(--accent)" }}>Unsubscribe</span> · <span style={{ color: "var(--accent)" }}>Manage preferences</span> · Sent to {author.email}
        </div>
      </div>

      <p style={{ textAlign: "center", fontSize: "0.8rem", color: "var(--ink-3)", marginTop: "1.25rem" }}>
        Real delivery would use SendGrid or Resend with this exact HTML template.
        Author receives this every Monday at 8am.
      </p>
    </div>
  );
}
