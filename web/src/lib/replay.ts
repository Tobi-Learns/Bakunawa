// Position-replay engine (1.9a): reconstruct the ladder at each entry event
// from the indexer's position history and derive the time series the charts
// plot — pool size and per-rung implied payout from listing to lock. Pure
// function over DB rows; reuses the same parimutuel math the live UI shows.

import { impliedRoi, type LadderRow } from "./parimutuel";

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
}

const MAX_POINTS = 300;

export function replaySeries(
  rungs: number[],
  rakeBps: number,
  events: ReplayEvent[],
): SeriesPoint[] {
  const allRungs = [0, ...rungs];
  const ladder = new Map<string, bigint>();
  for (const side of [0, 1]) {
    for (const r of allRungs) ladder.set(`${side}-${r}`, 0n);
  }
  const rows = (): LadderRow[] =>
    [...ladder.entries()].map(([k, stake]) => {
      const [side, rung] = k.split("-").map(Number);
      return { side, rung, stake };
    });

  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const points: SeriesPoint[] = [];
  for (const e of sorted) {
    const key = `${e.side}-${e.rung}`;
    ladder.set(key, (ladder.get(key) ?? 0n) + e.stake);
    const snapshot = rows();
    const pool = snapshot.reduce((a, r) => a + r.stake, 0n);
    points.push({
      t: Math.floor(e.at.getTime() / 1000),
      pool: pool.toString(),
      quotes: allRungs.flatMap((rung) =>
        [0, 1].map((side) => ({
          side,
          rung,
          roi: impliedRoi(snapshot, side, rung, rakeBps),
        })),
      ),
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
