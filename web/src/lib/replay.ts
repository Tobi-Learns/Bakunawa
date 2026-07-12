// Position-replay engine (1.9a): reconstruct the ladder at each entry event
// from the indexer's position history and derive the time series the charts
// plot — pool size and per-rung implied payout from listing to lock. Pure
// function over DB rows; reuses the same parimutuel math the live UI shows.

import { quoteBuy, mintShares, EPS, type LadderRow } from "./parimutuel";
import { crowdForecast } from "./forecast";
import { sharesForDollars } from "./dpm";

export interface ReplayEvent {
  side: number;
  rung: number; // 0 = regular (ticket mint)
  stake: bigint;
  at: Date;
}

export interface SeriesQuote {
  side: number;
  rung: number;
  roi: number | null;
}

export interface SeriesPoint {
  t: number; // unix seconds
  pool: string; // stroops, stringified
  quotes: SeriesQuote[];
  win: { side: number; p: number }[]; // crowd-implied P(side wins), sums to ~1
}

const MAX_POINTS = 300;

// Display cap on the replayed per-rung ROI, matching the sim's ×50 tail cap.
// A marginal-$1 quote on a thinly-backed rung is a real parimutuel boundary
// (nearly the sole winner takes most of the losing pool) but explodes to
// thousands of % and pins the chart's y-axis. The mature ladder tops out well
// under ×50, so the cap clips only the unstable thin-rung spikes. Profit per
// unit, so ×50 payout = +4900% ROI = 49.
const ROI_CAP = 49;

export function replaySeries(
  rungs: number[],
  rakeBps: number,
  events: ReplayEvent[],
): SeriesPoint[] {
  const allRungs = [0, ...rungs];
  const money = new Map<string, bigint>();
  const shareMap = new Map<string, bigint>();
  for (const side of [0, 1]) {
    for (const r of allRungs) {
      money.set(`${side}-${r}`, 0n);
      shareMap.set(`${side}-${r}`, 0n);
    }
  }
  const rows = (): LadderRow[] =>
    [...money.entries()].map(([k, stake]) => {
      const [side, rung] = k.split("-").map(Number);
      return { side, rung, stake, shares: shareMap.get(k) ?? 0n };
    });

  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const points: SeriesPoint[] = [];
  for (const e of sorted) {
    const key = `${e.side}-${e.rung}`;
    // DPM shares this entry mints, priced against the pre-event pool (C_i(rung)).
    const pre = rows();
    const total = Number(pre.reduce((a, r) => a + r.stake, 0n));
    const c = pre
      .filter((r) => r.side === e.side && r.rung >= e.rung)
      .reduce((a, r) => a + Number(r.stake), 0);
    const minted = mintShares(c, total, Number(e.stake));
    money.set(key, (money.get(key) ?? 0n) + e.stake);
    shareMap.set(key, (shareMap.get(key) ?? 0n) + BigInt(Math.round(minted)));
    const snapshot = rows();
    const pool = snapshot.reduce((a, r) => a + r.stake, 0n);
    const fc = crowdForecast(snapshot, rungs);
    // Until both sides have stake there is no two-sided crowd — a one-sided
    // seed snapshot would read 100/0. Show a neutral 50/50 baseline instead,
    // so the sentiment line starts balanced and only diverges once both sides
    // are funded (Polymarket-style fresh-market start).
    const twoSided = [0, 1].every((side) =>
      snapshot.some((r) => r.side === side && r.stake > 0n),
    );
    points.push({
      t: Math.floor(e.at.getTime() / 1000),
      pool: pool.toString(),
      quotes: allRungs.flatMap((rung) =>
        [0, 1].map((side) => {
          // Two guards make this chart honest and readable:
          // (1) Use the conservative (min) end of the implied-payout RANGE, not
          //     the lone optimistic figure. The optimistic quote assumes the
          //     side wins by a hair so every deeper same-side conviction dies
          //     and banks — on a conviction-heavy pool that sends a marginal-$1
          //     Neutral quote to +80,000%+ (bug B2 / same family as B1). The
          //     min end (all same-side convictions land and take their cut) is
          //     a true lower bound.
          // (2) Skip a rung with no same-side stake at rung-and-deeper (the
          //     quote would be a pure probe artifact), and cap the rest at the
          //     sim's ×50 tail cap so a thinly-backed deep rung can't pin the
          //     axis at hundreds of thousands of %.
          const sReal = snapshot
            .filter((r) => r.side === side && r.rung >= rung)
            .reduce((a, r) => a + r.stake, 0n);
          if (sReal <= 0n) return { side, rung, roi: null };
          const min = quoteBuy(snapshot, side, rung, EPS, rungs, rakeBps).range?.min;
          return {
            side,
            rung,
            roi: min == null ? null : Math.min(min, ROI_CAP),
          };
        }),
      ),
      win:
        twoSided && fc
          ? fc.sides.map((s) => ({ side: s.side, p: s.pWin }))
          : [
              { side: 0, p: 0.5 },
              { side: 1, p: 0.5 },
            ],
    });
  }
  // thin long histories evenly, always keeping the last point
  if (points.length > MAX_POINTS) {
    const step = points.length / MAX_POINTS;
    const thinned: SeriesPoint[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) thinned.push(points[Math.floor(i * step)]);
    thinned.push(points[points.length - 1]);
    return thinned;
  }
  return points;
}

/**
 * Reconstruct each side's total Neutral (regular) money and DPM share count by
 * replaying the indexed mint history. The contract mints
 * `dpm_shares(side_stake(side), side_stake(other), amount)` per mint and tracks
 * `RegularShares(id, side)` — which no view exposes — so the slip can't read it.
 * It needs the side's blended price (reg_money / reg_shares) to value a Neutral
 * position the way `redeem` pays it: per SHARE, not per dollar (the favorite's
 * pricier shares must win less than the underdog's for the same stake).
 * Float mirror of the contract's integer math — an estimate, like the rest of
 * the slip's live quote; the contract stays authoritative on submit.
 */
export function regularShareTotals(
  events: ReplayEvent[],
): { money: number; shares: number }[] {
  const sideTotal = [0, 0]; // running total side stake (USDC) — the DPM basis
  const money = [0, 0];
  const shares = [0, 0];
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const e of sorted) {
    const amt = Number(e.stake) / 1e7;
    if (e.rung === 0) {
      // rung 0 = a Neutral mint: shares priced off the side stakes BEFORE it
      shares[e.side] += sharesForDollars(sideTotal[e.side], sideTotal[1 - e.side], amt);
      money[e.side] += amt;
    }
    sideTotal[e.side] += amt; // convictions grow the DPM basis but mint no shares
  }
  return [
    { money: money[0], shares: shares[0] },
    { money: money[1], shares: shares[1] },
  ];
}
