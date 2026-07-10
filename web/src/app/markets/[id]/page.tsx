"use client";

// Market detail (1.4b/c/d) — the core surface. Live margin ladder with
// implied payouts polled from chain, lock countdown, live-move banner for
// crypto markets after lock (dominance deaths banking "if settled now" —
// the Bakunawa moment), settled breakdown, cancelled refunds notice.
// Prediction slip attaches here (the ladder already exposes onSelect).

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Countdown } from "@/components/countdown";
import { CrowdForecast } from "@/components/crowd-forecast";
import { MarketCharts } from "@/components/market-charts";
import { PredictionSlip } from "@/components/prediction-slip";
import { TradeWidget } from "@/components/trade-widget";
import { WinProbabilityCard } from "@/components/win-probability-card";
import { HonestyTip } from "@/components/honesty-tip";
import { Ladder } from "@/components/ladder";
import { StatusPill } from "@/components/status-pill";
import { formatUsdc } from "@/lib/config";
import { uiStatus } from "@/lib/market-status";
import { rememberMarketId } from "@/lib/markets-registry";
import { bankedAmount } from "@/lib/parimutuel";
import { useMarket } from "@/lib/use-market";

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { market, ladder, outcome, move, error, loading } = useMarket(id);
  const [selected, setSelected] = useState({ side: 0, rung: 0 });
  const [placedAt, setPlacedAt] = useState(0); // bumps to force a poll-refresh feel
  // re-derive the phase every 30s so countdown expiry flips the UI
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (market) rememberMarketId(Number(market.id));
  }, [market]);

  if (error && !market)
    return (
      <p className="text-sm text-red-400">
        Could not load market #{id}: {error}
      </p>
    );
  if (loading || !market)
    return <p className="text-sm text-neutral-500">Reading market #{id} from chain…</p>;

  const status = uiStatus(market);
  const total = ladder.reduce((a, r) => a + r.stake, 0n);
  const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);
  const liveBanked =
    move && move.winningSide !== null && (status === "Locked" || status === "Settling")
      ? bankedAmount(ladder, move.winningSide, move.units)
      : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">
              {market.oracle === "Reflector"
                ? `${market.asset}: ${market.sideA} vs ${market.sideB}`
                : `${market.sideA} vs ${market.sideB}`}
            </h1>
            <StatusPill status={status} />
          </div>
          <p className="mt-1 text-sm text-neutral-400">
            {market.oracle === "Reflector"
              ? `% move from the listing snapshot · settled trustlessly by Reflector`
              : "curated event · result posted from the named official source"}{" "}
            · demand priced · fee {market.rakeBps / 100}% · <HonestyTip />
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-neutral-500">Total pool</div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatUsdc(total)} <span className="text-sm font-normal">USDC</span>
          </div>
        </div>
      </div>

      {/* Phase banner */}
      {status === "Open" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm">
          <span>
            Predictions open — closes in{" "}
            <b>
              <Countdown to={market.closeTs} />
            </b>{" "}
            ({new Date(market.closeTs * 1000).toLocaleString()})
          </span>
          <span className="text-neutral-400">
            settles {new Date(market.settleTs * 1000).toLocaleString()}
          </span>
        </div>
      )}
      {(status === "Locked" || status === "Settling") && (
        <div className="rounded-lg border border-violet-900 bg-violet-950/30 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Predictions locked —{" "}
              {status === "Settling" ? (
                "awaiting oracle settlement"
              ) : (
                <>
                  settles in{" "}
                  <b>
                    <Countdown to={market.settleTs} />
                  </b>
                </>
              )}
            </span>
            {move && (
              <span>
                {market.asset} now:{" "}
                <b>
                  {move.winningSide === null
                    ? "flat 0.00%"
                    : `${sideName(move.winningSide)} ${(move.units / 100).toFixed(2)}%`}
                </b>
              </span>
            )}
          </div>
          {liveBanked !== null && liveBanked > 0n && (
            <p className="mt-2 text-amber-400">
              🌒 {formatUsdc(liveBanked)} USDC of failed convictions swallowed by the
              pool, if settled now.
            </p>
          )}
        </div>
      )}
      {status === "Settled" && outcome && (
        <div className="rounded-lg border border-sky-900 bg-sky-950/40 px-4 py-3 text-sm">
          Settled: <b>{sideName(outcome.winner)}</b> by{" "}
          <b>
            {market.oracle === "Reflector"
              ? `${(outcome.margin / 100).toFixed(2)}%`
              : outcome.margin}
          </b>{" "}
          · losing pool {formatUsdc(outcome.losingPool)} USDC · fee{" "}
          {formatUsdc(outcome.rakeAmount)} USDC · winners claim from{" "}
          <Link href="/portfolio" className="underline">
            portfolio
          </Link>
        </div>
      )}
      {status === "Cancelled" && (
        <div className="rounded-lg border border-neutral-700 bg-neutral-900/60 px-4 py-3 text-sm">
          Market cancelled — all stakes refundable in full, no fee. Claim from{" "}
          <Link href="/portfolio" className="underline">
            portfolio
          </Link>
          .
        </div>
      )}

      {/* Win probability over time — the headline visual, top of the page */}
      <WinProbabilityCard market={market} ladder={ladder} />

      {/* Crowd forecast — current snapshot (inverted from pool state) */}
      {ladder.length > 0 && <CrowdForecast market={market} ladder={ladder} />}

      {/* Ladder + prediction slip */}
      <div
        className={`grid gap-6 ${status === "Open" ? "lg:grid-cols-3" : "md:grid-cols-2"}`}
        key={placedAt}
      >
        {[0, 1].map((side) => (
          <Ladder
            key={side}
            market={market}
            ladder={ladder}
            outcome={outcome}
            move={move}
            status={status}
            side={side}
            selected={status === "Open" ? selected : null}
            onSelect={
              status === "Open" ? (s, r) => setSelected({ side: s, rung: r }) : undefined
            }
          />
        ))}
        {status === "Open" && (
          <PredictionSlip
            market={market}
            ladder={ladder}
            selected={selected}
            onSelect={(s, r) => setSelected({ side: s, rung: r })}
            onPlaced={() => setPlacedAt(Date.now())}
          />
        )}
      </div>

      {status === "Open" && (
        <div className="md:max-w-md">
          <TradeWidget market={market} />
        </div>
      )}

      <MarketCharts market={market} />

      <p className="text-xs text-neutral-600">
        Every number on this page is computed in your browser from on-chain pool state
        (polled ~12s). Implied payouts include your stake — piling on a rung prices it
        down. Click a ladder row to load it into the slip.
      </p>
    </div>
  );
}
