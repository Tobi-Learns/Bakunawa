"use client";

// Live-markets strip on the landing page: biggest open pools first, then
// recent settlements — read from the indexer cache with skeletons and an
// empty state.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Countdown } from "@/components/countdown";
import { MarketCardSkeleton } from "@/components/skeleton";
import { StatusPill } from "@/components/status-pill";
import type { MarketView } from "@/lib/bakunawa";
import { formatUsdc } from "@/lib/config";
import { uiStatus } from "@/lib/market-status";

interface Row {
  id: string;
  title?: string;
  asset?: string;
  sideA: string;
  sideB: string;
  oracle: string;
  status: string;
  closeTs: number;
  settleTs: number;
  pool: string;
  winner?: number | null;
  margin?: number | null;
}

const rank = (r: Row) => {
  const s = uiStatus({ status: r.status, closeTs: r.closeTs, settleTs: r.settleTs } as MarketView);
  const order: Record<string, number> = { Open: 0, Locked: 1, Settling: 2, Settled: 3, Cancelled: 4 };
  return order[s] ?? 5;
};

export function LandingMarkets() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/markets")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRows(d.markets ?? []))
      .catch(() => setRows([]));
  }, []);

  if (rows === null)
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <MarketCardSkeleton key={i} />
        ))}
      </div>
    );

  if (rows.length === 0)
    return (
      <div className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
        No markets listed yet. The curator opens events from{" "}
        <Link href="/admin" className="underline">
          the admin console
        </Link>
        .
      </div>
    );

  const sorted = [...rows]
    .sort((a, b) => rank(a) - rank(b) || Number(BigInt(b.pool) - BigInt(a.pool)))
    .slice(0, 6);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((m) => {
        const s = uiStatus({ status: m.status, closeTs: m.closeTs, settleTs: m.settleTs } as MarketView);
        const name = m.title ?? (m.oracle === "Reflector" ? `${m.asset} ${m.sideA}/${m.sideB}` : `${m.sideA} vs ${m.sideB}`);
        return (
          <Link
            key={m.id}
            href={`/markets/${m.id}`}
            className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-4 transition hover:border-neutral-600"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold">{name}</span>
              <StatusPill status={s} />
            </div>
            <div className="mt-auto flex items-end justify-between text-sm">
              <div>
                <div className="text-xs text-neutral-500">Pool</div>
                <div className="text-lg font-semibold">
                  {formatUsdc(BigInt(m.pool))} <span className="text-xs font-normal">USDC</span>
                </div>
              </div>
              <div className="text-right text-xs text-neutral-400">
                {s === "Open" ? (
                  <>locks in <Countdown to={m.closeTs} /></>
                ) : s === "Locked" ? (
                  <>settles in <Countdown to={m.settleTs} /></>
                ) : s === "Settled" && m.winner != null ? (
                  `${m.winner === 0 ? m.sideA : m.sideB} won`
                ) : (
                  s
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
