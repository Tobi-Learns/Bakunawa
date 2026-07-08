// Client-side Reflector feed reads (via RPC simulation) — powers the live
// "% move from baseline" display on open/locked crypto markets. Mirrors the
// contract's margin math exactly (hundredths of a percent, rounded half-up).

import { xdr } from "@stellar/stellar-sdk";
import { simulateRead } from "./bakunawa";
import { CONFIG } from "./config";

export interface LiveMove {
  /** |% move| in hundredths of a percent, rounded like the contract */
  units: number;
  /** 0 = side_a (UP) currently winning, 1 = side_b (DOWN), null = flat */
  winningSide: 0 | 1 | null;
  lastPrice: bigint;
  timestamp: number;
}

const assetScVal = (symbol: string) =>
  xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Other"), xdr.ScVal.scvSymbol(symbol)]);

export interface PricePoint {
  price: bigint;
  timestamp: number;
}

/** Latest feed price for an asset (raw). */
export async function getLastPrice(asset: string): Promise<PricePoint | null> {
  const res = (await simulateRead(
    CONFIG.reflectorFeed,
    "lastprice",
    assetScVal(asset),
  )) as { price: bigint; timestamp: bigint } | null;
  return res ? { price: res.price, timestamp: Number(res.timestamp) } : null;
}

/** Historical feed price at a resolution-aligned timestamp (retention-bound). */
export async function getPriceAt(asset: string, ts: number): Promise<PricePoint | null> {
  const res = (await simulateRead(
    CONFIG.reflectorFeed,
    "price",
    assetScVal(asset),
    xdr.ScVal.scvU64(new xdr.Uint64(BigInt(ts))),
  )) as { price: bigint; timestamp: bigint } | null;
  return res ? { price: res.price, timestamp: Number(res.timestamp) } : null;
}

export const FEED_RESOLUTION = 300; // seconds (verified on the testnet feed)

export async function getLiveMove(
  asset: string,
  baseline: bigint,
): Promise<LiveMove | null> {
  const res = (await simulateRead(
    CONFIG.reflectorFeed,
    "lastprice",
    assetScVal(asset),
  )) as { price: bigint; timestamp: bigint } | null;
  if (!res || baseline <= 0n) return null;
  const diff = res.price - baseline;
  const abs = diff < 0n ? -diff : diff;
  const units = Number((abs * 10_000n + baseline / 2n) / baseline);
  return {
    units,
    winningSide: units === 0 ? null : diff > 0n ? 0 : 1,
    lastPrice: res.price,
    timestamp: Number(res.timestamp),
  };
}
