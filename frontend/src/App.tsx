import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export default function App() {
  const [status, setStatus] = useState<string>("checking...");

  useEffect(() => {
    fetch(`${API}/health`)
      .then((r) => r.json())
      .then((d) => setStatus(`backend says: ${d.status} (${d.env})`))
      .catch(() => setStatus("backend unreachable"));
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="rounded-xl border border-neutral-200 bg-white px-8 py-6 shadow-sm">
        <h1 className="text-xl font-medium text-neutral-900">ReviewPulse</h1>
        <p className="mt-2 text-sm text-neutral-500">{status}</p>
      </div>
    </main>
  );
}
