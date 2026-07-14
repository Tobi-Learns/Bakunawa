"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MarketCard, type CatalogMarket } from "@/components/market-card";
import { MarketCardSkeleton } from "@/components/skeleton";
import type { MarketView } from "@/lib/bakunawa";
import { uiStatus } from "@/lib/market-status";
import { ui } from "@/lib/ui";

type CatalogState =
  | { kind: "loading" }
  | { kind: "ready"; rows: CatalogMarket[] }
  | { kind: "error" };

const rank = (market: CatalogMarket) => {
  const status = uiStatus({
    status: market.status,
    closeTs: market.closeTs,
    settleTs: market.settleTs,
  } as MarketView);
  const order: Record<string, number> = { Open: 0, Locked: 1, Settling: 2, Settled: 3, Cancelled: 4 };
  return order[status] ?? 5;
};

export function LandingMarkets() {
  const [state, setState] = useState<CatalogState>({ kind: "loading" });

  async function load() {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/markets");
      if (!response.ok) throw new Error("Catalog request failed");
      const data = (await response.json()) as { markets?: CatalogMarket[] };
      setState({ kind: "ready", rows: data.markets ?? [] });
    } catch {
      setState({ kind: "error" });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/markets", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Catalog request failed");
        return response.json() as Promise<{ markets?: CatalogMarket[] }>;
      })
      .then((data) => setState({ kind: "ready", rows: data.markets ?? [] }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ kind: "error" });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading markets">
        {[0, 1, 2].map((i) => <MarketCardSkeleton key={i} />)}
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={`${ui.card} flex flex-col items-center gap-3 border-danger/35 p-8 text-center`}>
        <p className="text-sm text-ink-secondary">Market forecasts could not be loaded.</p>
        <button type="button" onClick={() => void load()} className={`${ui.buttonSecondary} text-sm`}>
          Try again
        </button>
      </div>
    );
  }

  if (state.rows.length === 0) {
    return (
      <div className={`${ui.card} border-dashed p-8 text-center text-sm text-ink-muted`}>
        <p>New forecasts are being prepared.</p>
        <Link href="/how-it-works" className="mt-3 inline-flex min-h-11 items-center text-action hover:text-action-hover">
          See how Bakunawa works →
        </Link>
      </div>
    );
  }

  const sorted = [...state.rows]
    .sort((a, b) => rank(a) - rank(b) || Number(BigInt(b.pool) - BigInt(a.pool)))
    .slice(0, 6);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((market) => <MarketCard key={market.id} market={market} />)}
    </div>
  );
}
