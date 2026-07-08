// Parimutuel math, ported from sim/engine.py (the reference implementation).
// Implied payouts are computed CLIENT-SIDE from on-chain pool state — the
// locked design rule: no trust in our backend for the number that matters.
//
// DemandMult(m) = SideStake / S(m); Weight = Stake x Mult;
// Payout_i = Stake_i + Weight_i / SumW x (LosingPool - Fee).

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

/** Marginal probe stake for implied-payout display: 1 USDC in stroops.
 *  Including it in S(m)/SideStake makes the display self-price (the
 *  sniper-dilution property from the sim) and keeps empty rungs finite. */
const EPS = 10_000_000;

/**
 * "If settled now" ROI for a probe stake on (side, rung), assuming the outcome
 * is side winning by exactly `rung` (the minimal outcome where this rung
 * wins). The probe is included in S(m)/SideStake, so quoting a big stake
 * prices itself down — the prediction slip passes the user's actual stake here.
 * Returns null when the pool has no defined price yet.
 */
export function impliedRoi(
  rows: LadderRow[],
  side: number,
  rung: number,
  rakeBps: number,
  probe: bigint = BigInt(EPS),
): number | null {
  const probeN = Math.max(Number(probe), 1);
  const total = Number(rows.reduce((a, r) => a + r.stake, 0n)) + probeN;
  const sideRows = rows.filter((r) => r.side === side);
  const sideStake = Number(sideRows.reduce((a, r) => a + r.stake, 0n)) + probeN;
  if (total <= probeN) return null;

  const winners = sideRows.filter((r) => r.rung <= rung);
  const winnersStake = Number(winners.reduce((a, r) => a + r.stake, 0n)) + probeN;
  const losingPool = total - winnersStake;
  const dist = losingPool * (1 - rakeBps / 10_000);

  const s = (m: number) =>
    Number(sideRows.filter((r) => r.rung >= m).reduce((a, r) => a + r.stake, 0n)) +
    (m <= rung ? probeN : 0);
  const myMult = sideStake / s(rung);
  let sumW = probeN * myMult;
  for (const w of winners) {
    if (w.stake > 0n) sumW += Number(w.stake) * (sideStake / s(w.rung));
  }
  if (sumW <= 0) return null;
  return (myMult * dist) / sumW; // profit per unit of probe stake
}

export type RungState =
  | { state: "won"; roi: number } // winning side, rung met — ROI on stake
  | { state: "banked" } // winning side, rung unmet — swallowed by the pool
  | { state: "lost" }; // wrong side

/**
 * Per-rung result for a concrete outcome (side `winner` wins by `margin`).
 * Used both live ("if settled now", from the current oracle move) and for
 * the final settled breakdown — same math the contract runs.
 */
export function outcomeRung(
  rows: LadderRow[],
  winner: number,
  margin: number,
  side: number,
  rung: number,
  rakeBps: number,
): RungState {
  if (side !== winner) return { state: "lost" };
  if (rung > margin) return { state: "banked" };
  const total = Number(rows.reduce((a, r) => a + r.stake, 0n));
  const winRows = rows.filter((r) => r.side === winner);
  const winnerStake = Number(winRows.reduce((a, r) => a + r.stake, 0n));
  const s = (m: number) =>
    Number(winRows.filter((r) => r.rung >= m).reduce((a, r) => a + r.stake, 0n));
  const winners = winRows.filter((r) => r.rung <= margin && r.stake > 0n);
  const winnersStake = Number(winners.reduce((a, r) => a + r.stake, 0n));
  const dist = (total - winnersStake) * (1 - rakeBps / 10_000);
  const sumW = winners.reduce(
    (a, r) => a + Number(r.stake) * (winnerStake / s(r.rung)),
    0,
  );
  if (sumW <= 0) return { state: "banked" };
  const myMult = winnerStake / (s(rung) || Number.MAX_SAFE_INTEGER);
  return { state: "won", roi: (myMult * dist) / sumW };
}

/** Total winning-side dominance stake that would bank into the pool at this outcome. */
export function bankedAmount(rows: LadderRow[], winner: number, margin: number): bigint {
  return rows
    .filter((r) => r.side === winner && r.rung > margin)
    .reduce((a, r) => a + r.stake, 0n);
}
