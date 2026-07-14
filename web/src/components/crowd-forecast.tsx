"use client";

// Crowd forecast (Phase 1.10, money-share model) — the PM-positioning
// headline. "The crowd says" = where the crowd's money sits, read live from
// on-chain pool state (lib/forecast.ts). The split bar is the side-vs-side
// share; each side's ladder breaks that side's money down by dominance level
// (Neutral tickets + each margin rung), summing to 100% per side. No inverted
// "likelihood" — just the crowd's actual composition.

import type { LadderRowView, MarketView } from "@/lib/bakunawa";
import { crowdForecast } from "@/lib/forecast";

function rungLabel(market: MarketView, rung: number): string {
  if (rung === 0) return "Neutral";
  return market.oracle === "Reflector"
    ? `by ≥ ${(rung / 100).toFixed(2)}%`
    : `by ≥ ${rung}`;
}

export function CrowdForecast({
  market,
  ladder,
}: {
  market: MarketView;
  ladder: LadderRowView[];
}) {
  const forecast = crowdForecast(ladder, market.rungs);
  if (!forecast) return null;
  const [a, b] = forecast.sides;
  const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);
  // headline: the side holding more of the pool + where that side's money leans
  const lead = a.pWin >= b.pWin ? a : b;
  const leadName = sideName(lead.side);
  const topBucket = [...lead.breakdown]
    .filter((x) => x.rung > 0 && x.p > 0)
    .sort((x, y) => y.p - x.p)[0];

  return (
    <section className="rounded-xl border border-line bg-panel/80 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-ink-secondary">Crowd forecast</h2>
        <span className="text-xs text-ink-subtle">share of the live pool · not fixed odds</span>
      </div>

      {/* Headline sentence */}
      <p className="mb-3 text-lg">
        The crowd says{" "}
        <b>
          {(lead.pWin * 100).toFixed(0)}% {leadName}
        </b>
        {topBucket && (
          <>
            {" "}
            · <b>{(topBucket.p * 100).toFixed(0)}%</b> of it {rungLabel(market, topBucket.rung)}
          </>
        )}
        .
      </p>

      {/* Side-vs-side split bar */}
      <div className="mb-1 flex h-6 overflow-hidden rounded">
        <div
          className="flex items-center justify-start bg-[#3987e5] px-2 text-xs font-medium text-white"
          style={{ width: `${a.pWin * 100}%` }}
        >
          {a.pWin >= 0.12 ? `${sideName(0)} ${(a.pWin * 100).toFixed(0)}%` : ""}
        </div>
        <div
          className="flex items-center justify-end bg-[#199e70] px-2 text-xs font-medium text-white"
          style={{ width: `${b.pWin * 100}%` }}
        >
          {b.pWin >= 0.12 ? `${sideName(1)} ${(b.pWin * 100).toFixed(0)}%` : ""}
        </div>
      </div>

      {/* Per-side breakdown — how each side's money splits across dominance */}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {forecast.sides.map((f) => (
          <div key={f.side}>
            <div className="mb-1 text-xs font-medium text-ink-muted">
              {sideName(f.side)} <span className="text-ink-subtle">· where its money sits</span>
            </div>
            <ul className="flex flex-col gap-0.5 text-sm">
              {f.breakdown.map((s) => (
                <li key={s.rung} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-ink-muted">
                    {rungLabel(market, s.rung)}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded bg-panel-muted">
                    <span
                      className={`block h-full rounded ${s.rung === 0 ? "bg-ink-subtle" : "bg-[#3987e5]"}`}
                      style={{ width: `${Math.min(s.p * 100, 100)}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-ink-secondary">
                    {(s.p * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
