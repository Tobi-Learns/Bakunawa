// Parimutuel math, ported from sim/engine.py (the reference implementation).
// Implied payouts are computed CLIENT-SIDE from on-chain pool state — the
// locked design rule: no trust in our backend for the number that matters.
//
// DemandMult(m) = SideStake / S(m); Weight = Stake x Mult;
// Payout_i = Stake_i + Weight_i / SumW x (LosingPool - Rake).

export interface LadderRow {
  side: number;
  rung: number;
  stake: bigint;
}

/** DemandMult for (side, rung) given the current ladder. 1.0 for winner-only. */
export function demandMult(rows: LadderRow[], side: number, rung: number): number {
  const sideRows = rows.filter((r) => r.side === side);
  const sideStake = Number(sideRows.reduce((a, r) => a + r.stake, 0n));
  const s = Number(
    sideRows.filter((r) => r.rung >= rung).reduce((a, r) => a + r.stake, 0n),
  );
  if (s <= 0 || sideStake <= 0) return 0;
  return sideStake / s;
}

/**
 * "If settled now" ROI for a $1 bet on (side, rung), assuming the outcome is
 * side winning by exactly `rung` (the minimal outcome where this rung wins).
 * Returns null when the rung has no defined price yet (empty pool states).
 */
export function impliedRoi(
  rows: LadderRow[],
  side: number,
  rung: number,
  rakeBps: number,
): number | null {
  const total = Number(rows.reduce((a, r) => a + r.stake, 0n));
  const sideRows = rows.filter((r) => r.side === side);
  const sideStake = Number(sideRows.reduce((a, r) => a + r.stake, 0n));
  if (total <= 0 || sideStake <= 0) return null;

  const winners = sideRows.filter((r) => r.rung <= rung);
  const winnersStake = Number(winners.reduce((a, r) => a + r.stake, 0n));
  const losingPool = total - winnersStake;
  const dist = losingPool * (1 - rakeBps / 10_000);

  // Marginal $1: include it in S(m)/SideStake so the display self-prices
  // (the sniper-dilution property from the sim).
  const s = (m: number) =>
    Number(sideRows.filter((r) => r.rung >= m).reduce((a, r) => a + r.stake, 0n));
  const myMult = (sideStake + 1) / (s(rung) + 1);
  let sumW = 1 * myMult;
  for (const w of winners) {
    sumW += Number(w.stake) * ((sideStake + 1) / (s(w.rung) + 1));
  }
  if (sumW <= 0) return null;
  return (myMult * dist) / sumW;
}
