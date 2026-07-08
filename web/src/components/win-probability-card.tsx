"use client";

// The headline win-probability chart, lifted to the top of the market page —
// the easiest at-a-glance read (Polymarket's chart is the first thing you see).
// Self-fetches the replayed series; hides until a market has entries.

import { useEffect, useState } from "react";
import type { MarketView } from "@/lib/bakunawa";
import { WinProbabilityChart, type SeriesPointDto } from "./charts";

interface SeriesDto {
  sideA: string;
  sideB: string;
  points: SeriesPointDto[];
}

export function WinProbabilityCard({ market }: { market: MarketView }) {
  const [data, setData] = useState<SeriesDto | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/markets/${market.id}/series`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: SeriesDto) => live && setData(d))
      .catch(() => live && setHidden(true));
    return () => {
      live = false;
    };
  }, [market.id]);

  // additive: hide entirely until the cache has entries to plot
  if (hidden || (data && data.points.length === 0)) return null;

  return (
    <section className="rounded-lg border border-neutral-800 p-4">
      <h2 className="mb-2 text-sm font-medium text-neutral-300">
        Win probability{" "}
        <span className="font-normal text-neutral-600">· crowd forecast over time</span>
      </h2>
      {data ? (
        <WinProbabilityChart points={data.points} sideA={data.sideA} sideB={data.sideB} />
      ) : (
        <p className="text-xs text-neutral-600">Loading…</p>
      )}
    </section>
  );
}
