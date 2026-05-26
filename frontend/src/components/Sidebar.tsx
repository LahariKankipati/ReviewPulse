import type { Session } from "../types/domain";

export type AppView = "dashboard" | "add-book" | "search" | "digest";

type Props = {
  session: Session;
  view: AppView;
  onNav: (v: AppView) => void;
  onLogout: () => void;
};

const NAV_ITEMS: { view: AppView; icon: string; label: string }[] = [
  { view: "dashboard", icon: "⬛", label: "My Books" },
  { view: "add-book", icon: "＋", label: "Add Book" },
  { view: "search", icon: "⌕", label: "Search Reviews" },
  { view: "digest", icon: "✉", label: "Weekly Digest" },
];

export function Sidebar({ session, view, onNav, onLogout }: Props) {
  const initials = (session.name ?? session.email)
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-text">
          ReviewPulse<span className="sidebar-logo-dot">·</span>
        </div>
        <div style={{ fontSize: "0.68rem", color: "#57534e", marginTop: "0.15rem" }}>
          Review Intelligence
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ view: v, icon, label }) => (
          <button
            key={v}
            className={`sidebar-link ${view === v ? "sl-active" : ""}`}
            onClick={() => onNav(v)}
          >
            <span className="sidebar-link-icon">{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-author">
          <div className="sidebar-avatar">{initials}</div>
          <div>
            <div className="sidebar-author-name">{session.name ?? "Author"}</div>
            <div className="sidebar-author-email">{session.email}</div>
          </div>
        </div>
        <button className="sidebar-logout" onClick={onLogout}>
          <span style={{ fontSize: "0.82rem" }}>↩</span> Sign out
        </button>
      </div>
    </aside>
  );
}

/* Mobile top bar shown on small screens */
export function MobileTopbar({ session, view, onNav, onLogout }: Props) {
  return (
    <div className="mobile-topbar">
      <div className="mobile-logo">ReviewPulse·</div>
      <div style={{ display: "flex", gap: "0.35rem" }}>
        {NAV_ITEMS.map(({ view: v, icon }) => (
          <button
            key={v}
            onClick={() => onNav(v)}
            style={{
              background: view === v ? "rgba(255,255,255,0.12)" : "none",
              border: "none", color: view === v ? "#fff" : "#a8a29e",
              padding: "0.4rem 0.5rem", borderRadius: "6px", cursor: "pointer", fontSize: "1rem",
            }}
            title={NAV_ITEMS.find((n) => n.view === v)?.label}
          >
            {icon}
          </button>
        ))}
        <button onClick={onLogout} style={{ background: "none", border: "none", color: "#78716c", cursor: "pointer", fontSize: "0.82rem", padding: "0.4rem" }}>
          ↩
        </button>
      </div>
    </div>
  );
}
