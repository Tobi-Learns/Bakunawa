// Write-through entry metadata for positions (localStorage). The contract
// stores only (side, rung, stake, claimed); the entry-time implied ROI and tx
// hash exist only at entry time, so the prediction slip records them here for the
// portfolio's "at entry vs now" display. Positions placed outside this
// browser simply show no entry data.

export interface PositionMeta {
  marketId: number;
  side: number;
  rung: number;
  stake: string; // stroops, stringified bigint
  entryRoi: number; // implied ROI quoted at entry
  txHash: string;
  at: number; // unix ms
}

const KEY = "bakunawa:position-meta";

export function recordPositionMeta(meta: PositionMeta) {
  try {
    const all: PositionMeta[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    localStorage.setItem(KEY, JSON.stringify([meta, ...all].slice(0, 200)));
  } catch {
    /* best-effort */
  }
}

export function findPositionMeta(
  marketId: number,
  side: number,
  rung: number,
  stake: bigint,
): PositionMeta | undefined {
  try {
    const all: PositionMeta[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return all.find(
      (m) =>
        m.marketId === marketId &&
        m.side === side &&
        m.rung === rung &&
        m.stake === stake.toString(),
    );
  } catch {
    return undefined;
  }
}
