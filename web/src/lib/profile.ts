// 5b client: read the per-address profile (indexer-derived, chain-truth) and
// expose the Neutral cost basis the portfolio shows. Server-first with the
// localStorage write-through (positions-meta) as the optimistic fallback for
// mints the indexer cron hasn't caught up to yet.

import { neutralBasis } from "./positions-meta";

interface ApiNeutral {
  side: number;
  dollars: string;
  shares: string;
  redeemedShares: string;
  redeemProceeds: string;
}

export interface ProfileMarket {
  marketId: string;
  title: string | null;
  status: string | null;
  winner: number | null;
  margin: number | null;
  neutral: ApiNeutral[];
  convictions: { side: number; rung: number; stake: string; shares: string; at: string; txHash: string }[];
  claims: { payout: string; at: string; txHash: string }[];
}

export interface ProfileData {
  address: string;
  markets: ProfileMarket[];
}

export async function fetchProfile(address: string): Promise<ProfileData | null> {
  try {
    const res = await fetch(`/api/profile/${address}`);
    if (!res.ok) return null;
    return (await res.json()) as ProfileData;
  } catch {
    return null;
  }
}

/** Weighted-average $/share for a side's Neutral mints: server (all devices,
 *  CLI included) first, localStorage (this browser, pre-index optimistic)
 *  fallback. Returns null when no basis exists anywhere (e.g. pure DEX buys). */
export function neutralBasisFrom(
  profile: ProfileData | null,
  marketId: number,
  side: number,
  // localStorage entries aren't wallet-keyed, so the fallback is only valid
  // for the wallet connected in THIS browser — pass false for bound wallets.
  allowLocalFallback = true,
): { avgPrice: number; shares: bigint } | null {
  const m = profile?.markets.find((x) => x.marketId === marketId.toString());
  const n = m?.neutral.find((x) => x.side === side);
  if (n && BigInt(n.shares) > 0n) {
    return {
      avgPrice: Number(BigInt(n.dollars)) / Number(BigInt(n.shares)),
      shares: BigInt(n.shares),
    };
  }
  return allowLocalFallback ? neutralBasis(marketId, side) : null;
}
