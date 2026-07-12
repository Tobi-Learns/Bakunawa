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

// Neutral (regular) shares are FUNGIBLE, so the contract can't track a
// per-holder cost basis. We record each in-app mint's dollars + shares here and
// aggregate to a weighted-average bought-at for the portfolio. Limitation: DEX
// buys and other browsers aren't captured (they show no basis) — the same
// fungible-average caveat Polymarket has.

interface NeutralEntry {
  marketId: number;
  side: number;
  dollars: string; // USDC stroops paid
  shares: string; // share stroops received
  at: number;
}

const NKEY = "bakunawa:neutral-entries";

export function recordNeutralEntry(e: NeutralEntry) {
  try {
    const all: NeutralEntry[] = JSON.parse(localStorage.getItem(NKEY) ?? "[]");
    localStorage.setItem(NKEY, JSON.stringify([e, ...all].slice(0, 500)));
  } catch {
    /* best-effort */
  }
}

/** Weighted-average $/share across this wallet's in-app Neutral mints on a side. */
export function neutralBasis(
  marketId: number,
  side: number,
): { avgPrice: number; shares: bigint } | null {
  try {
    const all: NeutralEntry[] = JSON.parse(localStorage.getItem(NKEY) ?? "[]");
    let dollars = 0n;
    let shares = 0n;
    for (const e of all) {
      if (e.marketId === marketId && e.side === side) {
        dollars += BigInt(e.dollars);
        shares += BigInt(e.shares);
      }
    }
    if (shares <= 0n) return null;
    return { avgPrice: Number(dollars) / Number(shares), shares };
  } catch {
    return null;
  }
}
