"use client";

// Market detail — the core surface. This scaffold version proves the RPC read
// path: on-chain market state + stake ladder + client-side implied payouts
// (the locked rule: the number that matters is computed from chain state in
// the browser). The real ladder UI, live polling, and bet slip are 1.4/1.5.

import { use, useEffect, useState } from "react";
import {
  getLadder,
  getMarket,
  getOutcome,
  type LadderRowView,
  type MarketView,
  type OutcomeView,
} from "@/lib/bakunawa";
import { impliedRoi } from "@/lib/parimutuel";
import { formatUsdc } from "@/lib/config";

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [market, setMarket] = useState<MarketView | null>(null);
  const [ladder, setLadder] = useState<LadderRowView[]>([]);
  const [outcome, setOutcome] = useState<OutcomeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [m, l, o] = await Promise.all([
          getMarket(BigInt(id)),
          getLadder(BigInt(id)),
          getOutcome(BigInt(id)),
        ]);
        if (!live) return;
        setMarket(m);
        setLadder(l);
        setOutcome(o);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);

  if (error)
    return <p className="text-sm text-red-400">Could not load market #{id}: {error}</p>;
  if (!market) return <p className="text-sm text-neutral-500">Loading market #{id}…</p>;

  const total = ladder.reduce((a, r) => a + r.stake, 0n);
  const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Market #{id} — {market.sideA} vs {market.sideB}
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          {market.oracle === "Reflector"
            ? `${market.asset} % move from listing baseline · settles via Reflector`
            : "curated event · admin oracle"}{" "}
          · pricing: demand (crowd) · rake {market.rakeBps / 100}% ·{" "}
          <span
            className={
              market.status === "Open"
                ? "text-emerald-400"
                : market.status === "Settled"
                  ? "text-sky-400"
                  : "text-amber-400"
            }
          >
            {market.status}
          </span>
        </p>
        <p className="mt-1 text-sm text-neutral-400">
          Pool: <span className="text-neutral-100">{formatUsdc(total)} USDC</span> · lock:{" "}
          {new Date(market.closeTs * 1000).toLocaleString()} · settle:{" "}
          {new Date(market.settleTs * 1000).toLocaleString()}
        </p>
      </div>

      {outcome && (
        <div className="rounded border border-sky-900 bg-sky-950/40 px-4 py-3 text-sm">
          Settled: <b>{sideName(outcome.winner)}</b> by margin {outcome.margin} · losing
          pool {formatUsdc(outcome.losingPool)} USDC · rake{" "}
          {formatUsdc(outcome.rakeAmount)} USDC
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {[0, 1].map((side) => (
          <div key={side} className="rounded border border-neutral-800">
            <div className="border-b border-neutral-800 px-4 py-2 font-medium">
              {sideName(side)}
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-2 font-normal">Rung</th>
                  <th className="px-4 py-2 font-normal">Staked</th>
                  <th className="px-4 py-2 font-normal">If settled now</th>
                </tr>
              </thead>
              <tbody>
                {ladder
                  .filter((r) => r.side === side)
                  .map((r) => {
                    const roi =
                      market.status === "Open"
                        ? impliedRoi(ladder, side, r.rung, market.rakeBps)
                        : null;
                    return (
                      <tr key={r.rung} className="border-t border-neutral-900">
                        <td className="px-4 py-2">
                          {r.rung === 0 ? "Winner only" : `≥ ${r.rung}`}
                        </td>
                        <td className="px-4 py-2">{formatUsdc(r.stake)} USDC</td>
                        <td className="px-4 py-2 text-neutral-300">
                          {roi === null ? "—" : `+${(roi * 100).toFixed(0)}%`}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <p className="text-xs text-neutral-600">
        Implied payouts are computed in your browser from on-chain pool state. A
        multiplier is a relative weight, never a fixed-odds promise. Bet slip lands in
        Phase 1.5.
      </p>
    </div>
  );
}
