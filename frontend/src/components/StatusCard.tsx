export function StatusCard({
  health,
  onCheck,
  busy,
}: {
  health: string;
  onCheck: () => void;
  busy: boolean;
}) {
  return (
    <article className="card">
      <h2>1. Service Check</h2>
      <p>Confirm backend connectivity before running pipeline actions.</p>
      <button className="btn" disabled={busy} onClick={onCheck}>
        Check Backend
      </button>
      <div className="status-line">{health}</div>
    </article>
  );
}
