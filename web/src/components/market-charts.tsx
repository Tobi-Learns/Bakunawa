"use client";

// Charts section on the market page (1.9): pool growth + per-rung implied
// payout history (replayed from indexed entries) and, for crypto markets,
// the live price vs rung thresholds. Series come from the read API; the
// numbers they plot are derived with the same math as the live ladder.

import { useEffect, useState } from "react";
import type { MarketView } from "@/lib/bakunawa";
import {
  PoolChart,
  PriceChart,
  RungHistoryChart,
  type SeriesPointDto,
} from "./charts";

interface SeriesDto {
  sideA: string;
  sideB: string;
  rungs: number[];
  oracle: string;
  points: SeriesPointDto[];
}

interface PricesDto {
  baseline: string;
  rungs: number[];
  sideA: string;
  sideB: string;
  samples: { ts: number; price: string }[];
}

export function MarketCharts({ market }: { market: MarketView }) {
  const [series, setSeries] = useState<SeriesDto | null>(null);
  const [prices, setPrices] = useState<PricesDto | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/markets/${market.id}/series`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => live && setSeries(d))
      .catch(() => live && setFailed(true));
    if (market.oracle === "Reflector") {
      fetch(`/api/markets/${market.id}/prices`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => live && setPrices(d))
        .catch(() => {
          /* price chart is optional */
        });
    }
    return () => {
      live = false;
    };
  }, [market.id, market.oracle]);

  if (failed) return null; // cache not indexed yet — charts are additive

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">Charts</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 p-4">
          <h3 className="mb-2 text-sm font-medium text-neutral-300">Pool growth</h3>
          {series ? (
            <PoolChart points={series.points} />
          ) : (
            <p className="text-xs text-neutral-600">Loading…</p>
          )}
        </div>
        <div className="rounded-lg border border-neutral-800 p-4">
          <h3 className="mb-2 text-sm font-medium text-neutral-300">
            Implied payout by rung
          </h3>
          {series ? (
            <RungHistoryChart
              points={series.points}
              rungs={series.rungs}
              sideA={series.sideA}
              sideB={series.sideB}
              oracle={series.oracle}
            />
          ) : (
            <p className="text-xs text-neutral-600">Loading…</p>
          )}
        </div>
        {market.oracle === "Reflector" && (
          <div className="rounded-lg border border-neutral-800 p-4 lg:col-span-2">
            <h3 className="mb-2 text-sm font-medium text-neutral-300">
              {market.asset} move vs rung thresholds
            </h3>
            {prices ? (
              <PriceChart
                samples={prices.samples}
                baseline={prices.baseline}
                rungs={prices.rungs}
                sideA={prices.sideA}
                sideB={prices.sideB}
              />
            ) : (
              <p className="text-xs text-neutral-600">Loading…</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
