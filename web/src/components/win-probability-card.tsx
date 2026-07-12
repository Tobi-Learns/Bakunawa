"use client";

// The headline win-probability chart, lifted to the top of the market page —
// the easiest at-a-glance read (Polymarket's chart is the first thing you see).
// Self-fetches the replayed series; hides until a market has entries.

import { useEffect, useMemo, useState } from "react";
import type { LadderRowView, MarketView } from "@/lib/bakunawa";
import { crowdForecast } from "@/lib/forecast";
import { ChartSkeleton } from "./skeleton";
import { WinProbabilityChart, type SeriesPointDto } from "./charts";

interface SeriesDto {
  sideA: string;
  sideB: string;
  points: SeriesPointDto[];
}

// How far past the last indexed event the live "now" point may sit, in
// seconds. Bounds the x-axis so a stale demo market (indexed in a burst days
// ago) doesn't stretch flat — the appended point is the CURRENT value, only
// its position is capped. On an actively-traded market the last event is
// recent, so this is a no-op.
const LIVE_TAIL_CAP = 30;

export function WinProbabilityCard({
  market,
  ladder,
}: {
  market: MarketView;
  ladder: LadderRowView[];
}) {
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

  // The replayed series is the DB cache (indexer-lagged); the live on-chain
  // ladder is authoritative and drives the CrowdForecast card right below.
  // Append a live "now" point from that SAME source so the headline line ends
  // on the current money-share and the two agree — timestamped just past the
  // last indexed event (capped) so the step structure stays readable.
  const points = useMemo(() => {
    const base = data?.points ?? [];
    const twoSided = [0, 1].every((s) =>
      ladder.some((r) => r.side === s && r.stake > 0n),
    );
    const fc = twoSided ? crowdForecast(ladder, market.rungs) : null;
    if (!fc) return base;
    const live = fc.sides.map((s) => ({ side: s.side, p: s.pWin }));
    const last = base[base.length - 1];
    // skip if the cache is already current (nothing new to show)
    if (last && live.every((w) => w.p === last.win.find((x) => x.side === w.side)?.p))
      return base;
    const nowSec = Math.floor(Date.now() / 1000);
    const t = last ? Math.min(nowSec, last.t + LIVE_TAIL_CAP) : nowSec;
    return [...base, { t, pool: "0", quotes: [], win: live }];
  }, [data, ladder, market.rungs]);

  // additive: hide entirely until there is anything to plot
  if (hidden || (data && points.length === 0)) return null;

  return (
    <section className="rounded-lg border border-neutral-800 p-4">
      <h2 className="mb-2 text-sm font-medium text-neutral-300">
        Win probability{" "}
        <span className="font-normal text-neutral-600">· crowd forecast over time</span>
      </h2>
      {data ? (
        <WinProbabilityChart points={points} sideA={data.sideA} sideB={data.sideB} />
      ) : (
        <ChartSkeleton />
      )}
    </section>
  );
}
