import type { SearchHit } from "../types/domain";

export function SearchSection({
  query,
  onQuery,
  onSearch,
  hits,
  busy,
  disabled,
}: {
  query: string;
  onQuery: (q: string) => void;
  onSearch: () => void;
  hits: SearchHit[];
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <section className="card wide">
      <h2>6. Semantic Search</h2>
      <p>Search meaning across all reviews in this author catalog.</p>
      <div className="search-row">
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="e.g. pacing and characters" />
        <button className="btn" disabled={busy || disabled} onClick={onSearch}>Search</button>
      </div>
      <div className="search-results">
        {hits.length === 0 ? (
          <div className="empty-note">No search results yet. Run search after ingestion.</div>
        ) : (
          hits.map((item, idx) => (
            <div key={`${idx}-${item.score}`} className="search-item">
              <strong>{item.score.toFixed(3)}</strong>
              <p>{item.snippet}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
