"use client";

// Markets browse. Until the indexer/DB lands (Phase 1.6) there is no on-chain
// enumeration — this scaffold lists known demo market ids and offers a lookup.

import Link from "next/link";
import { useState } from "react";

const DEMO_MARKET_IDS = [1001, 1002];

export default function MarketsPage() {
  const [lookup, setLookup] = useState("");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Markets</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Browse, filters, and live pool cards arrive with the indexer (1.6).
          Demo markets from the contract smoke test:
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {DEMO_MARKET_IDS.map((id) => (
          <li key={id}>
            <Link
              href={`/markets/${id}`}
              className="block rounded border border-neutral-800 px-4 py-3 hover:border-neutral-600"
            >
              Market #{id}
            </Link>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (lookup) window.location.href = `/markets/${lookup}`;
        }}
      >
        <input
          value={lookup}
          onChange={(e) => setLookup(e.target.value.replace(/\D/g, ""))}
          placeholder="Look up market by id"
          className="w-56 rounded border border-neutral-700 bg-transparent px-3 py-2 text-sm"
        />
        <button className="rounded border border-neutral-700 px-3 py-2 text-sm hover:border-neutral-500">
          Open
        </button>
      </form>
    </div>
  );
}
