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
import { DisputePanel } from "@/components/dispute-panel";
import { MarketCharts } from "@/components/market-charts";
import { PredictionSlip } from "@/components/prediction-slip";
import { WinProbabilityCard } from "@/components/win-probability-card";
import { HonestyTip } from "@/components/honesty-tip";
import { Ladder } from "@/components/ladder";
import { StatusPill } from "@/components/status-pill";
import { formatUsdc } from "@/lib/config";
import { uiStatus } from "@/lib/market-status";
import { rememberMarketId } from "@/lib/markets-registry";
import { bankedAmount } from "@/lib/parimutuel";
import { settlementSourceFor } from "@/lib/settlement-sources";
import { useMarket } from "@/lib/use-market";

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { market, ladder, outcome, move, proposal, dispute, error, loading } = useMarket(id);
  const [selected, setSelected] = useState({ side: 0, rung: 0 });
  const [placedAt, setPlacedAt] = useState(0); // bumps to force a poll-refresh feel
  // Curator metadata (DB) — the category pins the settlement authority (2g).
  const [meta, setMeta] = useState<{ category?: string; description?: string } | null>(null);
  // re-derive the phase every 30s so countdown expiry flips the UI
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (market) rememberMarketId(Number(market.id));
  }, [market]);

  useEffect(() => {
    fetch(`/api/markets/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMeta(d?.market ?? null))
      .catch(() => {});
  }, [id]);

  if (error && !market)
    return (
      <p className="text-sm text-danger">
        Could not load market #{id}: {error}
      </p>
    );
  if (loading || !market)
    return <p className="text-sm text-ink-muted">Reading market #{id} from chain…</p>;

  const status = uiStatus(market);
  const total = ladder.reduce((a, r) => a + r.stake, 0n);
  const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);
  const source = settlementSourceFor(meta?.category); // 2g: category-pinned authority
  const liveBanked =
    move && move.winningSide !== null && (status === "Locked" || status === "Settling")
      ? bankedAmount(ladder, move.winningSide, move.units)
      : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {market.oracle === "Reflector"
                ? `${market.asset}: ${market.sideA} vs ${market.sideB}`
                : `${market.sideA} vs ${market.sideB}`}
            </h1>
            <StatusPill status={status} />
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
            {market.oracle === "Reflector"
              ? `% move from the listing snapshot · settled trustlessly by Reflector`
              : `curated event · result posted from ${source ? source.authority : "the named official source"}`}{" "}
            · demand priced · fee {market.rakeBps / 100}% · <HonestyTip />
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-subtle">Total pool</div>
          <div className="text-2xl font-semibold tabular-nums">
            {formatUsdc(total)} <span className="text-sm font-normal">USDC</span>
          </div>
        </div>
      </div>

      {/* Settlement authority (2g) — the sole named source, pinned by category */}
      {(source || meta?.description) && (
        <div className="rounded-lg border border-line bg-panel/60 px-4 py-2.5 text-xs leading-relaxed text-ink-secondary">
          <span className="font-medium text-ink">Settlement authority:</span>{" "}
          {source ? source.authority : "the named official source (see terms)"}
          {source?.note ? ` — ${source.note}` : ""}
          {meta?.description ? (
            <div className="mt-1 text-ink-muted">{meta.description}</div>
          ) : null}
        </div>
      )}

      {/* Phase banner */}
      {status === "Open" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-positive/35 bg-positive/8 px-4 py-3 text-sm">
          <span>
            Predictions open — closes in{" "}
            <b>
              <Countdown to={market.closeTs} />
            </b>{" "}
            ({new Date(market.closeTs * 1000).toLocaleString()})
          </span>
          <span className="text-ink-muted">
            settles {new Date(market.settleTs * 1000).toLocaleString()}
          </span>
        </div>
      )}
      {(status === "Locked" || status === "Settling") && (
        <div className="rounded-xl border border-action/35 bg-action/8 px-4 py-3 text-sm">
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
            <p className="mt-2 text-warning">
              🌒 {formatUsdc(liveBanked)} USDC of failed convictions swallowed by the
              pool, if settled now.
            </p>
          )}
        </div>
      )}
      {status === "Proposed" && proposal && (
        <DisputePanel
          market={market}
          proposal={proposal}
          dispute={dispute}
          authority={source?.authority ?? null}
          onDone={() => setPlacedAt(Date.now())}
        />
      )}
      {status === "Settled" && outcome && (
        <div className="rounded-xl border border-info/35 bg-info/8 px-4 py-3 text-sm">
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
        <div className="rounded-xl border border-line-strong bg-panel-muted px-4 py-3 text-sm">
          Market cancelled — all stakes refundable in full, no fee. Claim from{" "}
          <Link href="/portfolio" className="underline">
            portfolio
          </Link>
          .
        </div>
      )}

      {/* Polymarket-style split: main content left, sticky trade sidebar right
          (Open only). Non-Open markets flow single-column. */}
      <div
        className={
          status === "Open"
            ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
            : "flex flex-col gap-6"
        }
      >
        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-6">
          {/* Win probability over time — the headline visual */}
          <WinProbabilityCard market={market} ladder={ladder} />

          {/* Crowd forecast — current snapshot from pool state. On OPEN markets
              this replaces the ladder tables (same per-side breakdown). */}
          {ladder.length > 0 && <CrowdForecast market={market} ladder={ladder} />}

          {/* Ladder tables only post-lock, where they show unique states
              (if-settled-now / final ROI / banked) the forecast card can't. */}
          {status !== "Open" && (
            <div className="grid items-start gap-6 md:grid-cols-2" key={placedAt}>
              {[0, 1].map((side) => (
                <Ladder
                  key={side}
                  market={market}
                  ladder={ladder}
                  outcome={outcome}
                  move={move}
                  status={status}
                  side={side}
                  selected={null}
                  onSelect={undefined}
                />
              ))}
            </div>
          )}

          <MarketCharts market={market} />

          <p className="text-xs leading-relaxed text-ink-subtle">
            Every number on this page is computed in your browser from on-chain pool state
            (polled ~12s). Implied payouts include your stake — piling on a rung prices it
            down. Pick a side and dominance margin in the Trade panel.
          </p>
        </div>

        {/* Trade sidebar — prediction slip + sell shares (Open only, sticky) */}
        {status === "Open" && (
          <aside className="lg:sticky lg:top-6">
            <PredictionSlip
              market={market}
              ladder={ladder}
              selected={selected}
              onSelect={(s, r) => setSelected({ side: s, rung: r })}
              onPlaced={() => setPlacedAt(Date.now())}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
