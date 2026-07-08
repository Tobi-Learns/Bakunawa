// Crowd-implied margin distribution (Phase 1.10) — the PM-positioning
// information product. Inverts on-chain pool state into "the crowd says X%
// chance SIDE wins by >= m", client-side, mirroring sim/forecast.py (Q4
// validated it: winner forecast ~1pp calibrated, margin ladder ~5pp).
//
// A rung-m position wins iff side wins by >= m; at the minimal winning
// outcome a marginal $1 earns R = 1 + mult(m)*(total - cumstake[m])/cumw[m],
// so P(side wins by >= m) = 1/R. The DemandMult is what makes the survival
// function fall with m. Winner legs (mult 1) normalize to sum to 1.

import type { LadderRow } from "./parimutuel";

export interface SideForecast {
  side: number;
  pWin: number; // P(side wins) — the two sides sum to ~1
  survival: { rung: number; p: number }[]; // P(side wins by >= rung), rung 0 = win
}

export interface Forecast {
  sides: [SideForecast, SideForecast];
}

// Marginal probe (1 USDC in stroops): added to S(rung) so an UNPOPULATED deep
// rung yields a huge mult -> huge return -> ~0 implied probability (a lone
// dollar that deep would earn a spectacular multiplier), rather than a
// divide-by-zero that reads as "100% chance". Negligible on populated rungs.
const EPS = 10_000_000;

/** DemandMult for (side, rung): SideStake / (S(rung)+eps); 1.0 for winner-only. */
function mult(rows: LadderRow[], side: number, rung: number): number {
  const sideRows = rows.filter((r) => r.side === side);
  const sideStake = Number(sideRows.reduce((a, r) => a + r.stake, 0n));
  if (sideStake <= 0) return 0;
  const s = Number(sideRows.filter((r) => r.rung >= rung).reduce((a, r) => a + r.stake, 0n));
  return sideStake / (s + (rung === 0 ? 0 : EPS));
}

export function crowdForecast(rows: LadderRow[], rungs: number[]): Forecast | null {
  const total = Number(rows.reduce((a, r) => a + r.stake, 0n));
  if (total <= 0) return null;
  const allRungs = [0, ...rungs];

  const rawSide = (side: number) => {
    const sideRows = rows.filter((r) => r.side === side);
    const raw: Record<number, number> = {};
    for (const rung of allRungs) {
      const m = Math.max(rung, 1);
      // winners at outcome margin == m: rows with rung <= m
      const winRows = sideRows.filter((r) => r.rung <= m);
      const cumw = winRows.reduce((a, r) => a + Number(r.stake) * mult(rows, side, r.rung), 0);
      const cumstake = Number(winRows.reduce((a, r) => a + r.stake, 0n));
      if (cumw <= 0) {
        raw[rung] = 0;
        continue;
      }
      const losing = total - cumstake;
      const R = 1 + mult(rows, side, rung) * (losing / cumw);
      raw[rung] = 1 / R;
    }
    return raw;
  };

  const raw0 = rawSide(0);
  const raw1 = rawSide(1);
  const z = raw0[0] + raw1[0];
  if (z <= 0) return null;

  const build = (side: number, raw: Record<number, number>): SideForecast => {
    const pWin = raw[0] / z;
    const factor = raw[0] > 0 ? pWin / raw[0] : 0;
    // survival must be non-increasing in rung and bounded by pWin
    let ceil = pWin;
    const survival = allRungs.map((rung) => {
      const p = Math.min(raw[rung] * factor, ceil);
      ceil = p;
      return { rung, p };
    });
    return { side, pWin, survival };
  };

  return { sides: [build(0, raw0), build(1, raw1)] };
}
