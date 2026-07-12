"use client";

// Markets browse (1.4a): cards with pool size, status, and lock countdown,
// filterable by status and event type. Data source is the known-ids registry
// + per-market chain reads until the indexer (1.6) provides real browsing.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Countdown } from "@/components/countdown";
import { MarketCardSkeleton } from "@/components/skeleton";
import { StatusPill } from "@/components/status-pill";
import { getLadder, getMarket, type MarketView } from "@/lib/bakunawa";
import { formatUsdc } from "@/lib/config";
import { uiStatus, type UiStatus } from "@/lib/market-status";
import { knownMarketIds } from "@/lib/markets-registry";

interface Card {
  market: MarketView;
  pool: bigint;
  title?: string;
}

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
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("All");
  const [lookup, setLookup] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      // The market LIST + pool come from chain via the known-ids registry, so
      // browse always reflects the DEPLOYED contract. The DB (/api/markets) is
      // used only to ENRICH curator titles — it isn't scoped by contract, so it
      // can hold rows from a retired contract and must never drive the list.
      const titles: Record<string, string> = {};
      try {
        const res = await fetch("/api/markets");
        if (res.ok) {
          const { markets } = (await res.json()) as { markets?: Record<string, unknown>[] };
          for (const m of markets ?? []) {
            if (m.title) titles[String(m.id)] = m.title as string;
          }
        }
      } catch {
        // DB unavailable — titles fall back to the on-chain sides
      }
      const found: Card[] = [];
      await Promise.all(
        knownMarketIds().map(async (id) => {
          try {
            const [market, ladder] = await Promise.all([getMarket(id), getLadder(id)]);
            found.push({
              market,
              pool: ladder.reduce((a, r) => a + r.stake, 0n),
              title: titles[String(id)],
            });
          } catch {
            // unknown/removed id — skip
          }
        }),
      );
      if (live) {
        setCards(found.sort((a, b) => Number(b.market.id - a.market.id)));
        setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const filtered = useMemo(
    () =>
      cards.filter(({ market }) => {
        const s = uiStatus(market);
        if (statusFilter !== "All" && s !== statusFilter) return false;
        if (typeFilter === "Crypto" && market.oracle !== "Reflector") return false;
        if (typeFilter === "Curated" && market.oracle !== "Admin") return false;
        return true;
      }),
    [cards, statusFilter, typeFilter],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Markets</h1>
          <p className="mt-1 text-sm text-neutral-400">
            One shared pool per event · demand-priced · settled on-chain
          </p>
        </div>
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
            placeholder="Open market by id"
            className="w-44 rounded border border-neutral-700 bg-transparent px-3 py-1.5 text-sm"
          />
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-full border px-3 py-1 ${
              statusFilter === f
                ? "border-neutral-300 text-neutral-100"
                : "border-neutral-800 text-neutral-500 hover:border-neutral-600"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="mx-1 text-neutral-700">|</span>
        {TYPE_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            className={`rounded-full border px-3 py-1 ${
              typeFilter === f
                ? "border-neutral-300 text-neutral-100"
                : "border-neutral-800 text-neutral-500 hover:border-neutral-600"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-neutral-400">No markets match these filters.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ market, pool, title }) => {
            const s = uiStatus(market);
            return (
              <Link
                key={String(market.id)}
                href={`/markets/${market.id}`}
                className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-4 transition hover:border-neutral-600"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">
                    {title ??
                      (market.oracle === "Reflector"
                        ? `${market.asset} ${market.sideA}/${market.sideB}`
                        : `${market.sideA} vs ${market.sideB}`)}
                  </span>
                  <StatusPill status={s} />
                </div>
                <p className="text-xs text-neutral-500">
                  {market.oracle === "Reflector"
                    ? "% move from listing · Reflector-settled"
                    : "curated event · official result"}{" "}
                  · demand priced
                </p>
                <div className="mt-auto flex items-end justify-between text-sm">
                  <div>
                    <div className="text-xs text-neutral-500">Pool</div>
                    <div className="text-lg font-semibold">
                      {formatUsdc(pool)} <span className="text-xs font-normal">USDC</span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-neutral-400">
                    {s === "Open" ? (
                      <>
                        locks in <Countdown to={market.closeTs} />
                      </>
                    ) : s === "Locked" ? (
                      <>
                        settles in <Countdown to={market.settleTs} />
                      </>
                    ) : (
                      `#${market.id}`
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
