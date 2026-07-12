// 5b: per-address profile — the server-computed view over indexed chain
// events (5a). Everything here derives from on-chain mint/conviction/redeem/
// claim events; nothing is client-written (chain is the source of truth).
//
// Cost-basis semantics (honest labels):
// - neutral.avgPriceStroops: weighted-average $/share across the address's
//   indexed mints on that side (average-cost method, Polymarket-style).
//   DEX fills are NOT contract events, so shares bought on the DEX carry no
//   basis here — the same caveat the localStorage layer had.
// - realized P&L: redeem proceeds − avgCost×redeemedShares (only when a
//   basis exists) plus claim payouts − winning conviction stakes. Reported
//   per market with the components, so the client can label gaps honestly.

import { NextRequest } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";

function json(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    { status, headers: { "content-type": "application/json" } },
  );
}

export interface ProfileNeutral {
  side: number;
  dollars: bigint; // USDC stroops paid across indexed mints
  shares: bigint; // share stroops received
  redeemedShares: bigint;
  redeemProceeds: bigint;
}

export interface ProfileConviction {
  side: number;
  rung: number;
  stake: bigint;
  shares: bigint;
  at: Date;
  txHash: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!StrKey.isValidEd25519PublicKey(address)) {
    return json({ error: "invalid address" }, 400);
  }
  try {
    const [positions, exits] = await Promise.all([
      db.position.findMany({ where: { predictor: address }, orderBy: { at: "asc" } }),
      db.exit.findMany({ where: { holder: address }, orderBy: { at: "asc" } }),
    ]);
    const marketIds = [...new Set([...positions, ...exits].map((r) => r.marketId))];
    const markets = await db.market.findMany({ where: { id: { in: marketIds } } });
    const metaById = new Map(markets.map((m) => [m.id.toString(), m]));

    const out = marketIds.map((mid) => {
      const key = mid.toString();
      const meta = metaById.get(key);
      const pos = positions.filter((p) => p.marketId === mid);
      const ex = exits.filter((x) => x.marketId === mid);

      // Neutral (rung 0) aggregates per side; convictions itemized.
      const neutral: ProfileNeutral[] = [];
      for (const side of [0, 1]) {
        const mints = pos.filter((p) => p.rung === 0 && p.side === side);
        const redeems = ex.filter((x) => x.kind === "redeem" && x.side === side);
        if (mints.length === 0 && redeems.length === 0) continue;
        neutral.push({
          side,
          dollars: mints.reduce((a, p) => a + p.stake, 0n),
          shares: mints.reduce((a, p) => a + p.shares, 0n),
          redeemedShares: redeems.reduce((a, x) => a + (x.shares ?? 0n), 0n),
          redeemProceeds: redeems.reduce((a, x) => a + x.payout, 0n),
        });
      }
      const convictions: ProfileConviction[] = pos
        .filter((p) => p.rung > 0)
        .map((p) => ({
          side: p.side,
          rung: p.rung,
          stake: p.stake,
          shares: p.shares,
          at: p.at,
          txHash: p.txHash,
        }));
      const claims = ex
        .filter((x) => x.kind === "claim")
        .map((x) => ({ payout: x.payout, at: x.at, txHash: x.txHash }));

      return {
        marketId: mid,
        title: meta?.title ?? null,
        status: meta?.status ?? null,
        winner: meta?.winner ?? null,
        margin: meta?.margin ?? null,
        neutral,
        convictions,
        claims,
      };
    });

    return json({ address, markets: out });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
