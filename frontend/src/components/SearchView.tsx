import { useState } from "react";
import type { Author, Book, SearchHit } from "../types/domain";

type Props = {
  author: Author | null;
  books: Book[];
  hits: SearchHit[];
  busy: boolean;
  onSearch: (query: string) => Promise<void>;
};

const SUGGESTED = [
  "pacing and character development",
  "ending disappointed me",
  "worldbuilding and atmosphere",
  "main character arc",
  "cover design",
];

export function SearchView({ author, books, hits, busy, onSearch }: Props) {
  const [query, setQuery] = useState("");

  const bookMap = Object.fromEntries(books.map((b) => [b.id, b]));

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && query.trim()) onSearch(query.trim());
  }

  function useSuggestion(s: string) {
    setQuery(s);
    onSearch(s);
  }

  if (!author) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">No catalog loaded yet</div>
          <div className="empty-desc">Complete setup and run ingestion before searching.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <div style={{ fontSize: "0.72rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--accent)", marginBottom: "0.4rem" }}>
          Semantic Search
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          Search across your entire catalog
        </h1>
        <p style={{ color: "var(--ink-2)", fontSize: "0.9rem", marginTop: "0.35rem" }}>
          Powered by pgvector — finds reviews by meaning, not just keywords
        </p>
      </div>

      <div className="search-wrap">
        <span className="search-icon">🔍</span>
        <input
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. pacing and characters, ending disappointed me…"
          disabled={busy}
          autoFocus
        />
        <button
          className="btn search-btn-inline"
          disabled={busy || !query.trim()}
          onClick={() => onSearch(query.trim())}
        >
          {busy ? "…" : "Search"}
        </button>
      </div>

      {/* Suggested queries */}
      {hits.length === 0 && !busy && (
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: "0.6rem" }}>
            Try a search
          </div>
          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
            {SUGGESTED.map((s) => (
              <button key={s} className="filter-chip" onClick={() => useSuggestion(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {busy && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="search-result skeleton">
              <div className="sk-block" style={{ height: 14, width: "20%", marginBottom: 10 }} />
              <div className="sk-block" style={{ height: 12, width: "100%", marginBottom: 6 }} />
              <div className="sk-block" style={{ height: 12, width: "75%" }} />
            </div>
          ))}
        </div>
      )}

      {!busy && hits.length > 0 && (
        <>
          <div style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginBottom: "0.85rem" }}>
            {hits.length} results for "<strong style={{ color: "var(--ink)" }}>{query}</strong>"
            — ranked by semantic similarity
          </div>
          {hits.map((hit, i) => {
            const bookName = bookMap[hit.book_id]?.title;
            const pct = Math.round(hit.score * 100);
            return (
              <div key={`${i}-${hit.review_id}`} className="search-result">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <span className="search-score">{pct}% match</span>
                    {bookName && <span className="search-book-name">in "{bookName}"</span>}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>#{i + 1}</div>
                </div>
                <div className="search-snippet">"{hit.snippet}"</div>
              </div>
            );
          })}
        </>
      )}

      {!busy && hits.length === 0 && query && (
        <div className="empty">
          <div className="empty-icon">🤷</div>
          <div className="empty-title">No results found</div>
          <div className="empty-desc">Try a different query — semantic search works best with natural phrases.</div>
        </div>
      )}
    </div>
  );
}
