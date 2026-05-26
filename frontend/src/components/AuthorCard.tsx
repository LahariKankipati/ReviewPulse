import type { Author } from "../types/domain";
import type { AuthorForm } from "../types/forms";

export function AuthorCard({
  form,
  onChange,
  onSubmit,
  busy,
  author,
}: {
  form: AuthorForm;
  onChange: (next: AuthorForm) => void;
  onSubmit: () => void;
  busy: boolean;
  author: Author | null;
}) {
  return (
    <article className="card">
      <h2>2. Create Author</h2>
      <p>Creates one tenant account used to isolate all catalog data.</p>
      <input value={form.auth_user_id} onChange={(e) => onChange({ ...form, auth_user_id: e.target.value })} placeholder="auth user id" />
      <input value={form.email} onChange={(e) => onChange({ ...form, email: e.target.value })} placeholder="email" />
      <input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} placeholder="display name" />
      <button className="btn" disabled={busy} onClick={onSubmit}>Save Author</button>
      {author && <div className="meta">Active author: {author.name || author.email}</div>}
    </article>
  );
}
