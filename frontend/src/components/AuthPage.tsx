import { useState } from "react";
import { loginAuthor, registerAuthor } from "../api/reviewpulse";
import type { Session } from "../types/domain";

type Props = { onAuth: (session: Session) => void };

export function AuthPage({ onAuth }: Props) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let author;
      if (tab === "login") {
        author = await loginAuthor(email.trim());
      } else {
        if (!name.trim()) { setError("Please enter your name."); setBusy(false); return; }
        author = await registerAuthor({
          auth_user_id: `author-${email.trim().replace(/[^a-z0-9]/gi, "-")}-${Date.now()}`,
          email: email.trim(),
          name: name.trim(),
        });
      }
      const session: Session = {
        id: author.id,
        auth_user_id: author.auth_user_id,
        email: author.email,
        name: author.name,
        last_login_at: author.last_login_at ?? null,
      };
      localStorage.setItem("rp_session", JSON.stringify(session));
      onAuth(session);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (tab === "login" && msg.includes("404")) {
        setError("No account found with that email. Try registering instead.");
      } else if (tab === "register" && msg.includes("409")) {
        setError("An account with this email already exists. Try logging in.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-root">
      <div className="auth-card">
        <div className="auth-logo">
          ReviewPulse<span className="auth-logo-dot">·</span>
        </div>
        <div className="auth-tagline">Review intelligence for independent authors</div>

        <div className="auth-tabs">
          <button className={`auth-tab ${tab === "login" ? "active" : ""}`} onClick={() => { setTab("login"); setError(null); }}>
            Sign in
          </button>
          <button className={`auth-tab ${tab === "register" ? "active" : ""}`} onClick={() => { setTab("register"); setError(null); }}>
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {tab === "register" && (
            <div className="input-group">
              <label className="input-label">Your Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane Austen" autoFocus={tab === "register"} />
            </div>
          )}
          <div className="input-group">
            <label className="input-label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus={tab === "login"}
              required
            />
          </div>

          {error && <div className="error-bar" style={{ marginBottom: "0.75rem", marginTop: 0 }}>{error}</div>}

          <button className="btn btn-lg" style={{ width: "100%" }} type="submit" disabled={busy || !email.trim()}>
            {busy ? (tab === "login" ? "Signing in…" : "Creating account…") : (tab === "login" ? "Sign in" : "Create account")}
          </button>
        </form>

        <p className="auth-note">
          {tab === "login"
            ? "Don't have an account? Switch to Create account above."
            : "Already have an account? Switch to Sign in above."}
          <br />
          <span style={{ color: "var(--ink-3)", fontSize: "0.72rem" }}>
            Demo: email is your identity · Supabase Auth JWT in production
          </span>
        </p>
      </div>
    </div>
  );
}
