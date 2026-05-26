import type { Author, Book } from "../types/domain";
import type { BookForm } from "../types/forms";

export function BookCard({
  form,
  onChange,
  onSubmit,
  busy,
  author,
  book,
}: {
  form: BookForm;
  onChange: (next: BookForm) => void;
  onSubmit: () => void;
  busy: boolean;
  author: Author | null;
  book: Book | null;
}) {
  return (
    <article className="card">
      <h2>3. Add Book</h2>
      <p>Add a title under the active author catalog.</p>
      <input value={form.title} onChange={(e) => onChange({ ...form, title: e.target.value })} placeholder="book title" />
      <input value={form.isbn} onChange={(e) => onChange({ ...form, isbn: e.target.value })} placeholder="isbn" />
      <input value={form.source_url} onChange={(e) => onChange({ ...form, source_url: e.target.value })} placeholder="source url (optional)" />
      <button className="btn" disabled={busy || !author} onClick={onSubmit}>Add Book</button>
      {book && <div className="meta">Book ready: {book.title}</div>}
    </article>
  );
}
