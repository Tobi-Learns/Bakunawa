// Ladder-history series (1.9a/b): pool growth + per-rung implied payout over
// time, replayed server-side from the indexed position history.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { replaySeries } from "@/lib/replay";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "invalid id" }, { status: 400 });
  try {
    const market = await db.market.findUnique({ where: { id: BigInt(id) } });
    if (!market) return Response.json({ error: "not found" }, { status: 404 });
    const positions = await db.position.findMany({
      where: { marketId: BigInt(id) },
      orderBy: [{ ledger: "asc" }, { id: "asc" }],
    });
    const points = replaySeries(
      market.rungs,
      market.rakeBps,
      positions.map((p) => ({ side: p.side, rung: p.rung, stake: p.stake, at: p.at })),
    );
    return Response.json({
      sideA: market.sideA,
      sideB: market.sideB,
      rungs: market.rungs,
      oracle: market.oracle,
      closeTs: market.closeTs,
      points,
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
