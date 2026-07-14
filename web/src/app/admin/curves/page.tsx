"use client";

// Metadata & curve registry (1.7b). Per S7 the curve is DISPLAY/CONTEXT +
// house-seed guidance only — settlement is always demand-weighted. Format:
// JSON array of { side: 0|1, rung: number, mult: number } (from the sim's
// committable CSVs, e.g. sim/out/curve_nba_example.csv).

import { useEffect, useState } from "react";
import { AdminGate } from "@/components/admin-gate";
import { patchMarketMeta } from "@/lib/admin";

interface Row {
  id: string;
  title?: string;
  sideA: string;
  sideB: string;
  category?: string;
  description?: string;
  curve?: unknown;
}

export default function CurvesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [sel, setSel] = useState<Row | null>(null);
  const [form, setForm] = useState({ title: "", description: "", category: "", curve: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/markets")
      .then((r) => r.json())
      .then((d) => setRows(d.markets ?? []));
  }, []);

  function pick(r: Row) {
    setSel(r);
    setMsg(null);
    setForm({
      title: r.title ?? "",
      description: r.description ?? "",
      category: r.category ?? "",
      curve: r.curve ? JSON.stringify(r.curve, null, 2) : "",
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!sel) return;
    setMsg(null);
    try {
      let curve: unknown = undefined;
      if (form.curve.trim() !== "") {
        curve = JSON.parse(form.curve);
        if (!Array.isArray(curve)) throw new Error("curve must be a JSON array");
      } else {
        curve = null;
      }
      await patchMarketMeta(BigInt(sel.id), {
        title: form.title,
        description: form.description,
        category: form.category,
        curve,
      });
      setMsg({ ok: true, text: `Saved metadata for #${sel.id}` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <AdminGate>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h1 className="mb-4 text-2xl font-semibold">Metadata & curves</h1>
          <ul className="flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => pick(r)}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${
                    sel?.id === r.id
                      ? "border-action bg-action/8"
                      : "border-line hover:border-line-strong"
                  }`}
                >
                  {r.title ?? `${r.sideA} vs ${r.sideB}`}{" "}
                  <span className="text-ink-subtle">#{r.id}</span>
                  {r.curve != null && <span className="ml-2 text-xs text-info">curve ✓</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {sel && (
          <form onSubmit={save} className="flex flex-col gap-3">
            <h2 className="font-semibold">#{sel.id}</h2>
            <input
              className="min-h-11 rounded-md border border-line-strong bg-panel px-3 text-sm text-ink"
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <textarea
              className="min-h-11 rounded-md border border-line-strong bg-panel px-3 text-sm text-ink"
              placeholder="Description / settlement terms"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <input
              className="min-h-11 rounded-md border border-line-strong bg-panel px-3 text-sm text-ink"
              placeholder="Category (crypto / nba / …)"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
            <textarea
              className="min-h-11 rounded-md border border-line-strong bg-panel px-3 font-mono text-xs text-ink"
              placeholder='Display curve JSON: [{"side":0,"rung":5,"mult":1.67}, …] — empty to clear'
              rows={10}
              value={form.curve}
              onChange={(e) => setForm((f) => ({ ...f, curve: e.target.value }))}
            />
            <button className="min-h-11 rounded-md bg-action text-sm font-semibold text-action-ink hover:bg-action-hover">
              Save metadata
            </button>
            {msg && (
              <p className={`text-sm ${msg.ok ? "text-positive" : "text-danger"}`}>
                {msg.text}
              </p>
            )}
          </form>
        )}
      </div>
    </AdminGate>
  );
}
