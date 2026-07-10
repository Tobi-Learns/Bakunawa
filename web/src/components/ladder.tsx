"use client";

// The margin ladder — the core product surface. One column per side; each
// rung shows staked amount, a stake-share bar, and the honest number for the
// market's current phase:
//   Open      -> live implied payout for a marginal $1 ("if settled now")
//   Locked    -> outcome-at-current-move per rung (winning / banked / losing)
//   Settled   -> final ROI breakdown / banked / lost
// All computed client-side from on-chain ladder state (lib/parimutuel.ts).

import type { LadderRowView, MarketView, OutcomeView } from "@/lib/bakunawa";
import { formatUsdc } from "@/lib/config";
import type { UiStatus } from "@/lib/market-status";
import { impliedRange, outcomeRung, type RungState } from "@/lib/parimutuel";
import type { LiveMove } from "@/lib/reflector";

function fmtRoi(roi: number): string {
  return `+${(roi * 100).toFixed(roi >= 10 ? 0 : 1)}%`;
}

function rungLabel(market: MarketView, rung: number): string {
  if (rung === 0) return "Neutral · shares";
  if (market.oracle === "Reflector") return `≥ ${(rung / 100).toFixed(2)}%`;
  return `≥ ${rung}`;
}

function StateCell({ rs }: { rs: RungState }) {
  if (rs.state === "won")
    return <span className="text-emerald-400">{fmtRoi(rs.roi)}</span>;
  if (rs.state === "banked")
    return <span className="text-amber-400">banked into pool</span>;
  return <span className="text-neutral-600">loses</span>;
}

export function Ladder({
  market,
  ladder,
  outcome,
  move,
  status,
  side,
  selected,
  onSelect,
}: {
  market: MarketView;
  ladder: LadderRowView[];
  outcome: OutcomeView | null;
  move: LiveMove | null;
  status: UiStatus;
  side: number;
  /** optional prediction-slip integration: currently selected rung */
  selected?: { side: number; rung: number } | null;
  onSelect?: (side: number, rung: number) => void;
}) {
  const sideName = side === 0 ? market.sideA : market.sideB;
  const rows = ladder.filter((r) => r.side === side);
  const sideTotal = rows.reduce((a, r) => a + r.stake, 0n);
  const maxStake = rows.reduce((a, r) => (r.stake > a ? r.stake : a), 0n);

  const thirdColumn = (rung: number, stake: bigint) => {
    if (status === "Cancelled")
      return <span className="text-neutral-500">refunded</span>;
    if (status === "Settled" && outcome)
      return stake > 0n ? (
        <StateCell
          rs={outcomeRung(ladder, outcome.winner, outcome.margin, side, rung, market.rakeBps)}
        />
      ) : (
        <span className="text-neutral-700">—</span>
      );
    if ((status === "Locked" || status === "Settling") && move && move.winningSide !== null)
      return stake > 0n ? (
        <StateCell
          rs={outcomeRung(ladder, move.winningSide, move.units, side, rung, market.rakeBps)}
        />
      ) : (
        <span className="text-neutral-700">—</span>
      );
    // Open (or locked without a live feed): the implied-payout RANGE — a
    // position's return depends on how many same-side convictions land vs die.
    const range = impliedRange(ladder, side, rung, market.rungs, market.rakeBps);
    if (range === null) return <span className="text-neutral-700">—</span>;
    const point = Math.abs(range.max - range.min) < 0.005;
    return (
      <span className="text-neutral-200 tabular-nums">
        {point ? fmtRoi(range.max) : `${fmtRoi(range.min)} – ${fmtRoi(range.max)}`}
      </span>
    );
  };

  return (
    <div className="rounded-lg border border-neutral-800">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
        <span className="font-semibold">{sideName}</span>
        <span className="text-sm text-neutral-400">{formatUsdc(sideTotal)} USDC</span>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-neutral-500">
          <tr>
            <th className="px-4 py-2 font-normal">Rung</th>
            <th className="px-4 py-2 font-normal">Staked</th>
            <th className="px-4 py-2 font-normal">
              {status === "Settled"
                ? "Result"
                : status === "Locked" || status === "Settling"
                  ? "If settled now"
                  : "Implied payout for $1"}
            </th>
          </tr>
        </thead>
        <tbody>
          {[0, ...market.rungs].map((rung) => {
            const stake = rows.find((r) => r.rung === rung)?.stake ?? 0n;
            const pct = maxStake > 0n ? Number((stake * 100n) / maxStake) : 0;
            const isSelected = selected?.side === side && selected?.rung === rung;
            const selectable = onSelect && status === "Open";
            return (
              <tr
                key={rung}
                onClick={selectable ? () => onSelect(side, rung) : undefined}
                className={`border-t border-neutral-900 ${
                  selectable ? "cursor-pointer hover:bg-neutral-900/60" : ""
                } ${isSelected ? "bg-neutral-900" : ""}`}
              >
                <td className="px-4 py-2.5">{rungLabel(market, rung)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 tabular-nums">
                      ${formatUsdc(stake)}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded bg-neutral-900">
                      <span
                        className="block h-full rounded bg-neutral-600"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2.5">{thirdColumn(rung, stake)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
