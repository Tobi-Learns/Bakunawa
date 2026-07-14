"use client";

import { useEffect, useMemo, useState } from "react";
import { MarketCard, type CatalogMarket } from "@/components/market-card";
import { MarketCardSkeleton } from "@/components/skeleton";
import type { MarketView } from "@/lib/bakunawa";
import { uiStatus, type UiStatus } from "@/lib/market-status";
import { knownMarketIds } from "@/lib/markets-registry";
import { ui } from "@/lib/ui";

const STATUS_FILTERS: ("All" | UiStatus)[] = [
  "All",
  "Open",
  "Locked",
  "Settling",
  "Settled",
  "Cancelled",
];
const TYPE_FILTERS = ["All", "Crypto", "Curated"] as const;

export default function MarketsPage() {
  const [markets, setMarkets] = useState<CatalogMarket[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("All");
  const [lookup, setLookup] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const deployedIds = new Set(knownMarketIds().map(String));
    fetch("/api/markets", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Catalog request failed");
        return response.json() as Promise<{ markets?: CatalogMarket[] }>;
      })
      .then((data) => setMarkets((data.markets ?? []).filter((market) => deployedIds.has(String(market.id)))))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const filtered = useMemo(
    () =>
      (markets ?? []).filter((market) => {
        const status = uiStatus(market as unknown as MarketView);
        if (statusFilter !== "All" && status !== statusFilter) return false;
        if (typeFilter === "Crypto" && market.oracle !== "Reflector") return false;
        if (typeFilter === "Curated" && market.oracle !== "Admin") return false;
        return true;
      }),
    [markets, statusFilter, typeFilter],
  );

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <span className={ui.eyebrow}>Explore</span>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Markets</h1>
          <p className="mt-2 text-sm text-ink-muted">
            One shared pool per event · probability-priced shares · settled on-chain
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (lookup) window.location.href = `/markets/${lookup}`;
          }}
        >
          <label className="sr-only" htmlFor="market-id">Open market by id</label>
          <input
            id="market-id"
            inputMode="numeric"
            value={lookup}
            onChange={(event) => setLookup(event.target.value.replace(/\D/g, ""))}
            placeholder="Open market by id"
            className={`${ui.input} w-48 text-sm`}
          />
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Market filters">
        {STATUS_FILTERS.map((filter) => (
          <button
            type="button"
            key={filter}
            onClick={() => setStatusFilter(filter)}
            aria-pressed={statusFilter === filter}
            className={`inline-flex min-h-11 items-center rounded-full border px-3 transition ${
              statusFilter === filter
                ? "border-action/60 bg-action/10 text-action-hover"
                : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            {filter}
          </button>
        ))}
        <span className="mx-1 hidden text-line-strong sm:inline" aria-hidden="true">|</span>
        {TYPE_FILTERS.map((filter) => (
          <button
            type="button"
            key={filter}
            onClick={() => setTypeFilter(filter)}
            aria-pressed={typeFilter === filter}
            className={`inline-flex min-h-11 items-center rounded-full border px-3 transition ${
              typeFilter === filter
                ? "border-action/60 bg-action/10 text-action-hover"
                : "border-line text-ink-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {markets === null && !failed ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <MarketCardSkeleton key={i} />)}
        </div>
      ) : failed ? (
        <div className={`${ui.card} border-danger/35 p-8 text-center text-sm text-ink-secondary`}>
          Market forecasts could not be loaded. Refresh to try again.
        </div>
      ) : filtered.length === 0 ? (
        <div className={`${ui.card} border-dashed p-8 text-center text-sm text-ink-muted`}>
          No markets match these filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((market) => <MarketCard key={market.id} market={market} />)}
        </div>
      )}
    </div>
  );
}
