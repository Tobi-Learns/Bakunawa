// Unified share model (Phase 1.13) — ported from sim/unified.py, the reference.
// Implied payouts are computed CLIENT-SIDE from on-chain pool state (the locked
// design rule). Every buy — regular OR conviction — is one DPM-priced share
// purchase; the pot distributes in ONE uniform share split.
//
//   price/share(side, rung) = C_i(rung) / Total   (money-share = crowd prob;
//                             $0.50 at 50/50, range $0.01–$0.99, Polymarket-style)
//   shares for $d           = d + (Total - C)*ln((C+d)/C)   (2*d if C<=0)
//   settle(winner, margin): winners = side==winner AND rung<=margin; they split
//     the raked losing pool by SHARE count. Regular shares are fungible so they
//     redeem the class-average money-backing per share; convictions return their
//     own stake — both plus shares/SumShares * dist.

export interface LadderRow {
  side: number;
  rung: number;
  stake: bigint; // money at (side, rung)
  shares: bigint; // DPM shares issued at (side, rung)
}

/** 1 USDC probe (stroops) for empty-pool display — keeps quotes finite. */
const EPS = 10_000_000;

const n = (v: bigint) => Number(v);

/** Total money in the pool (both sides, all rungs). */
export function poolTotal(rows: LadderRow[]): number {
  return rows.reduce((a, r) => a + n(r.stake), 0);
}

/** C_i(m): money on `side` at rungs >= m (m=0 => the side's whole stake). */
export function cumAtLeast(rows: LadderRow[], side: number, m: number): number {
  return rows
    .filter((r) => r.side === side && r.rung >= m)
    .reduce((a, r) => a + n(r.stake), 0);
}

/**
 * DPM shares minted for `dollars` at cumulative-at-least money `c` in a pool of
 * `total` (pre-buy). Reduces to the Neutral DPM at rung 0 (c = side total).
 * Cold rung (c<=0) bootstraps at par, matching the contract.
 */
export function mintShares(c: number, total: number, dollars: number): number {
  if (dollars <= 0) return 0;
  if (c <= 0) return dollars * 2; // par bootstrap: $0.50/share
  return dollars + (total - c) * Math.log((c + dollars) / c);
}

/** Live price per share for (side, rung): C_i(rung) / Total — the money-share
 *  (crowd probability); $0.50 at 50/50, range $0.01–$0.99. Par $0.50 if empty. */
export function sharePrice(rows: LadderRow[], side: number, rung: number): number {
  const total = poolTotal(rows);
  const c = cumAtLeast(rows, side, rung);
  return total > 0 && c > 0 ? c / total : 0.5;
}

/** Winner-side aggregates at a given margin (regular + winning convictions). */
function winnerAgg(rows: LadderRow[], winner: number, margin: number) {
  const win = rows.filter((r) => r.side === winner);
  let regMoney = 0,
    regShares = 0,
    winMoney = 0,
    sumShares = 0;
  for (const r of win) {
    if (r.rung === 0) {
      regMoney += n(r.stake);
      regShares += n(r.shares);
      winMoney += n(r.stake);
      sumShares += n(r.shares);
    } else if (r.rung <= margin) {
      winMoney += n(r.stake);
      sumShares += n(r.shares);
    }
  }
  return { regMoney, regShares, winMoney, sumShares };
}

/**
 * ROI for a position `(side, rung, stake, shares)` at outcome `(winner, margin)`,
 * where the position is ALREADY part of `rows`. Regular (rung 0) redeems the
 * class-average money-backing per share; a conviction returns its own stake —
 * both plus a uniform slice of the raked losing pool by share count. Returns -1
 * for a lost/banked position, null if the pool has no winning shares.
 */
export function settleRoi(
  rows: LadderRow[],
  pos: { side: number; rung: number; stake: number; shares: number },
  winner: number,
  margin: number,
  rakeBps: number,
): number | null {
  if (pos.side !== winner || pos.rung > margin) return -1;
  if (pos.stake <= 0) return null;
  const payout = settlePayout(rows, pos, winner, margin, rakeBps);
  return payout === null ? null : payout / pos.stake - 1;
}

/**
 * USDC payout for `pos` at outcome `(winner, margin)` — the redeem/claim value.
 * Use this for FUNGIBLE ticket holdings where the holder's cost basis (stake)
 * is unknown: pass `stake: 0` and read the payout directly. Returns 0 for a
 * lost/banked position, null if the pool has no winning shares.
 */
export function settlePayout(
  rows: LadderRow[],
  pos: { side: number; rung: number; shares: number; stake?: number },
  winner: number,
  margin: number,
  rakeBps: number,
): number | null {
  if (pos.side !== winner || pos.rung > margin) return 0;
  const { regMoney, regShares, winMoney, sumShares } = winnerAgg(rows, winner, margin);
  if (sumShares <= 0) return null;
  const total = poolTotal(rows);
  const dist = (total - winMoney) * (1 - rakeBps / 10_000);
  const slice = (pos.shares * dist) / sumShares;
  return pos.rung === 0
    ? (pos.shares * regMoney) / regShares + slice // fungible: class-average money-back
    : (pos.stake ?? 0) + slice; // locked: own stake back
}

export interface ImpliedRange {
  min: number; // worst: side wins by the largest listed rung (all convictions land)
  max: number; // best: side wins by exactly this rung (deeper convictions bank)
}

/**
 * Implied-payout RANGE for a position that is ALREADY in the pool (portfolio /
 * settled-not-yet). Settles at the two boundary margins. Collapses to a point
 * for the top rung / no deeper convictions.
 */
export function impliedRange(
  rows: LadderRow[],
  pos: { side: number; rung: number; stake: number; shares: number },
  rungs: number[],
  rakeBps: number,
): ImpliedRange | null {
  const maxRung = rungs.length ? Math.max(pos.rung, ...rungs) : pos.rung;
  const best = settleRoi(rows, pos, pos.side, pos.rung, rakeBps);
  const worst = settleRoi(rows, pos, pos.side, maxRung, rakeBps);
  if (best === null || worst === null) return null;
  return { min: Math.min(best, worst), max: Math.max(best, worst) };
}

export interface BuyQuote {
  shares: number; // DPM shares this $ buys
  pricePerShare: number; // dollars / shares
  range: ImpliedRange | null; // self-priced implied ROI (probe included in the pool)
}

/**
 * Quote a PROSPECTIVE buy of `dollars` at (side, rung): the shares it mints and
 * the self-priced implied-payout range (the probe is added to the pool so a big
 * buy prices itself down). `dollars` in stroops; pass EPS for a marginal quote.
 */
export function quoteBuy(
  rows: LadderRow[],
  side: number,
  rung: number,
  dollars: number,
  rungs: number[],
  rakeBps: number,
): BuyQuote {
  const total = poolTotal(rows);
  const c = cumAtLeast(rows, side, rung);
  const shares = mintShares(c, total, Math.max(dollars, 1));
  // add the probe to a shallow copy of the ladder so it self-prices
  const probed = addToPool(rows, side, rung, dollars, shares);
  const pos = { side, rung, stake: dollars, shares };
  const maxRung = rungs.length ? Math.max(rung, ...rungs) : rung;
  const best = settleRoi(probed, pos, side, rung, rakeBps);
  const worst = settleRoi(probed, pos, side, maxRung, rakeBps);
  const range =
    best === null || worst === null ? null : { min: Math.min(best, worst), max: Math.max(best, worst) };
  return { shares, pricePerShare: shares > 0 ? dollars / shares : 1, range };
}

/** Return a copy of `rows` with `(dollars, shares)` added to (side, rung). */
function addToPool(
  rows: LadderRow[],
  side: number,
  rung: number,
  dollars: number,
  shares: number,
): LadderRow[] {
  const out = rows.map((r) => ({ ...r }));
  const hit = out.find((r) => r.side === side && r.rung === rung);
  if (hit) {
    hit.stake += BigInt(Math.round(dollars));
    hit.shares += BigInt(Math.round(shares));
  } else {
    out.push({ side, rung, stake: BigInt(Math.round(dollars)), shares: BigInt(Math.round(shares)) });
  }
  return out;
}

export type RungState =
  | { state: "won"; roi: number }
  | { state: "banked" }
  | { state: "lost" };

/**
 * Concrete per-position result at a known outcome (live "if settled now" or the
 * final settled breakdown) — same math the contract runs. `pos` is in the pool.
 */
export function outcomeRung(
  rows: LadderRow[],
  winner: number,
  margin: number,
  pos: { side: number; rung: number; stake: number; shares: number },
  rakeBps: number,
): RungState {
  if (pos.side !== winner) return { state: "lost" };
  if (pos.rung > margin) return { state: "banked" };
  const roi = settleRoi(rows, pos, winner, margin, rakeBps);
  if (roi === null) return { state: "banked" };
  return { state: "won", roi };
}

/**
 * Per-rung state for a marginal `dollars` probe at a KNOWN outcome — the
 * ladder's "if settled now" / final-result cell. Mints the probe's shares,
 * adds it to the pool (self-pricing) and settles at (winner, margin).
 */
export function probeOutcome(
  rows: LadderRow[],
  side: number,
  rung: number,
  winner: number,
  margin: number,
  rakeBps: number,
  dollars: number = EPS,
): RungState {
  const total = poolTotal(rows);
  const c = cumAtLeast(rows, side, rung);
  const shares = mintShares(c, total, dollars);
  const probed = addToPool(rows, side, rung, dollars, shares);
  return outcomeRung(probed, winner, margin, { side, rung, stake: dollars, shares }, rakeBps);
}

/** Total winning-side money that would bank into the pool at this outcome. */
export function bankedAmount(rows: LadderRow[], winner: number, margin: number): bigint {
  return rows
    .filter((r) => r.side === winner && r.rung > margin)
    .reduce((a, r) => a + r.stake, 0n);
}

export { EPS };
