"use client";

// Crowd forecast (Phase 1.10b) — the PM-positioning headline. The pool's
// state inverted into "the crowd says X% chance SIDE wins by Y", client-side
// from live on-chain pool state (lib/forecast.ts). Per the design doc, the
// forecast — not the payout — is the headline number.

import type { LadderRowView, MarketView } from "@/lib/bakunawa";
import { crowdForecast } from "@/lib/forecast";

function rungLabel(market: MarketView, rung: number): string {
  if (rung === 0) return "wins";
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
  // headline: the more likely winner + its most-probable non-trivial margin call
  const lead = a.pWin >= b.pWin ? a : b;
  const leadName = sideName(lead.side);
  const deepest = [...lead.survival]
    .filter((s) => s.rung > 0 && s.p >= 0.2)
    .sort((x, y) => y.rung - x.rung)[0];

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-neutral-300">Crowd forecast</h2>
        <span className="text-xs text-neutral-600">inverted from the pool · not fixed odds</span>
      </div>

      {/* Headline sentence */}
      <p className="mb-3 text-lg">
        The crowd says{" "}
        <b>
          {(lead.pWin * 100).toFixed(0)}% {leadName}
        </b>
        {deepest && (
          <>
            {" "}
            · <b>{(deepest.p * 100).toFixed(0)}%</b> {leadName}{" "}
            {rungLabel(market, deepest.rung)}
          </>
        )}
        .
      </p>

      {/* Win-probability split bar */}
      <div className="mb-1 flex h-6 overflow-hidden rounded">
        <div
          className="flex items-center justify-start bg-sky-700 px-2 text-xs font-medium text-white"
          style={{ width: `${a.pWin * 100}%` }}
        >
          {a.pWin >= 0.12 ? `${sideName(0)} ${(a.pWin * 100).toFixed(0)}%` : ""}
        </div>
        <div
          className="flex items-center justify-end bg-neutral-700 px-2 text-xs font-medium text-white"
          style={{ width: `${b.pWin * 100}%` }}
        >
          {b.pWin >= 0.12 ? `${sideName(1)} ${(b.pWin * 100).toFixed(0)}%` : ""}
        </div>
      </div>

      {/* Margin ladder — survival probabilities per side */}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {forecast.sides.map((f) => (
          <div key={f.side}>
            <div className="mb-1 text-xs font-medium text-neutral-400">{sideName(f.side)}</div>
            <ul className="flex flex-col gap-0.5 text-sm">
              {f.survival
                .filter((s) => s.rung > 0)
                .map((s) => (
                  <li key={s.rung} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 text-neutral-500">
                      {rungLabel(market, s.rung)}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded bg-neutral-800">
                      <span
                        className="block h-full rounded bg-sky-600"
                        style={{ width: `${Math.min(s.p * 100, 100)}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-neutral-300">
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
