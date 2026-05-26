import type { Book, Job } from "../types/domain";

export function IngestCard({
  ingestCount,
  onIngestCount,
  onTrigger,
  busy,
  book,
  job,
  onDemoRun,
}: {
  ingestCount: number;
  onIngestCount: (n: number) => void;
  onTrigger: () => void;
  busy: boolean;
  book: Book | null;
  job: Job | null;
  onDemoRun: () => void;
}) {
  return (
    <article className="card">
      <h2>4. Trigger Ingestion</h2>
      <p>Generate synthetic reviews and run analysis + embedding pipeline.</p>
      <input
        type="number"
        min={1}
        max={150}
        value={ingestCount}
        onChange={(e) => onIngestCount(Number(e.target.value))}
        placeholder="synthetic review count"
      />
      <div className="inline-actions">
        <button className="btn" disabled={busy || !book} onClick={onTrigger}>Start Job</button>
        <button className="btn btn-alt" disabled={busy || !book} onClick={onDemoRun}>One-Click Demo</button>
      </div>
      {job ? (
        <div className="stats-row">
          <span className="pill">status: {job.status}</span>
          <span className="pill">inserted: {job.new_inserted}</span>
          <span className="pill">analyzed: {job.analyzed}</span>
        </div>
      ) : (
        <div className="empty-note">No job started yet.</div>
      )}
    </article>
  );
}
