import { useEffect, useState } from "react";
import { checkHealth, listBookReviews, listBooks, semanticSearch } from "./api/reviewpulse";
import { AddBookPage } from "./components/AddBookPage";
import { AuthPage } from "./components/AuthPage";
import { BookPage } from "./components/BookPage";
import { DashboardPage } from "./components/DashboardPage";
import { DigestView } from "./components/DigestView";
import { SearchView } from "./components/SearchView";
import { MobileTopbar, Sidebar, type AppView } from "./components/Sidebar";
import type { Book, ReviewItem, SearchHit, Session } from "./types/domain";

const SESSION_KEY = "rp_session";

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [view, setView] = useState<AppView>("dashboard");
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);

  const [books, setBooks] = useState<Book[]>([]);
  const [bookReviews, setBookReviews] = useState<Record<string, ReviewItem[]>>({});
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load author's books on login
  useEffect(() => {
    if (!session) return;
    setLoadingBooks(true);
    listBooks(session.id)
      .then(({ items }) => {
        setBooks(items);
        // Load reviews for each book
        return Promise.all(
          items.map((b) =>
            listBookReviews(b.id, session.id).then((data) => ({
              bookId: b.id,
              items: data.items,
            }))
          )
        );
      })
      .then((results) => {
        const map: Record<string, ReviewItem[]> = {};
        for (const { bookId, items } of results) map[bookId] = items;
        setBookReviews(map);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load books"))
      .finally(() => setLoadingBooks(false));
  }, [session?.id]);

  // Ping health silently
  useEffect(() => {
    checkHealth().catch(() => {});
  }, []);

  function handleAuth(s: Session) {
    setSession(s);
    setView("dashboard");
    setBooks([]);
    setBookReviews({});
    setSelectedBook(null);
  }

  function handleDeleteBook(bookId: string) {
    setBooks((prev) => prev.filter((b) => b.id !== bookId));
    setBookReviews((prev) => { const next = { ...prev }; delete next[bookId]; return next; });
    setSelectedBook(null);
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setBooks([]);
    setBookReviews({});
    setSelectedBook(null);
    setSearchHits([]);
    setError(null);
  }

  function handleNav(v: AppView) {
    setView(v);
    setSelectedBook(null);
    setError(null);
  }

  async function handleSelectBook(book: Book) {
    setSelectedBook(book);
    setView("dashboard");
    if (!session) return;
    setLoadingReviews(true);
    try {
      const data = await listBookReviews(book.id, session.id, 100);
      setBookReviews((prev) => ({ ...prev, [book.id]: data.items }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load reviews");
    } finally {
      setLoadingReviews(false);
    }
  }

  function handleBookAdded(book: Book, reviews: ReviewItem[]) {
    setBooks((prev) => {
      if (prev.find((b) => b.id === book.id)) return prev;
      return [...prev, book];
    });
    if (reviews.length > 0) {
      setBookReviews((prev) => ({ ...prev, [book.id]: reviews }));
    }
    setSelectedBook(book);
    setView("dashboard");
  }

  async function handleSearch(query: string) {
    if (!session) return;
    setSearchBusy(true);
    try {
      const data = await semanticSearch(session.id, query);
      setSearchHits(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearchBusy(false);
    }
  }

  /* ── Auth gate ──────────────────────── */
  if (!session) return <AuthPage onAuth={handleAuth} />;

  const author = { id: session.id, auth_user_id: session.auth_user_id, email: session.email, name: session.name };

  /* ── Determine what the main area shows ── */
  const showBookDetail = view === "dashboard" && selectedBook !== null;

  return (
    <div className="app-root">
      <Sidebar session={session} view={view} onNav={handleNav} onLogout={handleLogout} />
      <MobileTopbar session={session} view={view} onNav={handleNav} onLogout={handleLogout} />

      <main className="main-content">
        {view === "dashboard" && !showBookDetail && (
          <DashboardPage
            session={session}
            books={books}
            bookReviews={bookReviews}
            loading={loadingBooks}
            onSelectBook={handleSelectBook}
          />
        )}

        {showBookDetail && selectedBook && (
          <BookPage
            book={selectedBook}
            reviews={bookReviews[selectedBook.id] ?? []}
            loading={loadingReviews}
            authorId={session.id}
            onBack={() => setSelectedBook(null)}
            onDelete={handleDeleteBook}
          />
        )}

        {view === "add-book" && (
          <AddBookPage session={session} onBookAdded={handleBookAdded} />
        )}

        {view === "search" && (
          <SearchView
            author={author}
            books={books}
            hits={searchHits}
            busy={searchBusy}
            onSearch={handleSearch}
          />
        )}

        {view === "digest" && (
          <DigestView
            author={author}
            books={books}
            bookReviews={bookReviews}
          />
        )}

        {error && (
          <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 1.75rem" }}>
            <div className="error-bar" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{error}</span>
              <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 700 }}>✕</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
