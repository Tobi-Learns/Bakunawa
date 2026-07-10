// Crowd sentiment (Phase 1.10, money-share model) — the PM-positioning
// information product. "The crowd says" = where the crowd's money actually
// sits, read straight off on-chain pool state. No inversion, no implied
// "likelihood" we haven't statistically grounded: pure money shares.
//
// - pWin  = each side's share of the TOTAL pool (tickets + convictions);
//           the two sides sum to 1. This is the headline side-vs-side split.
// - breakdown = within a side, each rung's share of THAT side's money
//           (rung 0 = Neutral tickets, then each dominance rung). Exclusive
//           by construction (a conviction sits at exactly one rung), so a
//           side's rows sum to 1 — a clean composition, not overlapping tails.

import type { LadderRow } from "./parimutuel";

export interface SideForecast {
  side: number;
  pWin: number; // side's share of the total pool (the two sides sum to ~1)
  breakdown: { rung: number; p: number }[]; // rung's share of this side's money (rung 0 = Neutral); sums to ~1
}

export interface Forecast {
  sides: [SideForecast, SideForecast];
}

export function crowdForecast(rows: LadderRow[], rungs: number[]): Forecast | null {
  const total = Number(rows.reduce((a, r) => a + r.stake, 0n));
  if (total <= 0) return null;
  const allRungs = [0, ...rungs];

  const build = (side: number): SideForecast => {
    const sideRows = rows.filter((r) => r.side === side);
    const sideStake = Number(sideRows.reduce((a, r) => a + r.stake, 0n));
    const breakdown = allRungs.map((rung) => {
      const at = Number(
        sideRows.filter((r) => r.rung === rung).reduce((a, r) => a + r.stake, 0n),
      );
      return { rung, p: sideStake > 0 ? at / sideStake : 0 };
    });
    return { side, pWin: sideStake / total, breakdown };
  };

  return { sides: [build(0), build(1)] };
}
