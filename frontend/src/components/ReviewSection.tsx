import { memo } from "react";
import type { ReviewItem } from "../types/domain";

function sentimentBadge(sentiment?: string) {
  if (!sentiment) return "badge badge-neutral";
  if (sentiment === "positive") return "badge badge-positive";
  if (sentiment === "mixed") return "badge badge-mixed";
  return "badge badge-negative";
}

function ReviewSkeleton() {
  return (
    <div className="review-card skeleton">
      <div className="sk-line w-70" />
      <div className="sk-line w-90" />
      <div className="sk-line w-50" />
    </div>
  );
}

export const ReviewSection = memo(function ReviewSection({
  reviews,
  loading,
  onLoad,
  disabled,
}: {
  reviews: ReviewItem[];
  loading: boolean;
  onLoad: () => void;
  disabled: boolean;
}) {
  const total = reviews.length;
  const actionable = reviews.filter((r) => r.analysis?.actionable).length;
  const positive = reviews.filter((r) => r.analysis?.sentiment === "positive").length;

  return (
    <section className="card wide">
      <h2>5. Browse Reviews</h2>
      <p>Filter-ready stream for sentiment and actionable insights.</p>
      <div className="inline-actions">
        <button className="btn" disabled={disabled || loading} onClick={onLoad}>Load Reviews</button>
        <div className="stats-row">
          <span className="pill">total: {total}</span>
          <span className="pill">actionable: {actionable}</span>
          <span className="pill">positive: {positive}</span>
        </div>
      </div>

      <div className="review-grid">
        {loading && Array.from({ length: 6 }).map((_, i) => <ReviewSkeleton key={i} />)}
        {!loading && reviews.length === 0 && <div className="empty-note">No reviews loaded yet. Start an ingest job first.</div>}
        {!loading &&
          reviews.map((r) => (
            <article key={r.review_id} className="review-card">
              <div className="review-top">
                <h3>{r.title || "Untitled review"}</h3>
                <span className={sentimentBadge(r.analysis?.sentiment)}>{r.analysis?.sentiment || "unscored"}</span>
              </div>
              <p>{r.analysis?.summary || r.body.slice(0, 150)}</p>
              <div className="review-foot">
                <span>rating: {r.rating ?? "-"}</span>
                <span>{r.source}</span>
              </div>
            </article>
          ))}
      </div>
    </section>
  );
});
