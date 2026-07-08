// Price series for crypto markets (1.9c): DB samples + a bounded on-demand
// backfill from Reflector's price(ts) history (retention-limited). Returns
// raw feed prices; the chart derives % move from the market's baseline
// client-side, mirroring the contract's margin math.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { FEED_RESOLUTION, getPriceAt } from "@/lib/reflector";

const BACKFILL_STEP = 900; // 15-min grid for backfill (feed keeps 5-min)
const BACKFILL_MAX = 24; // bounded RPC reads per request

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "invalid id" }, { status: 400 });
  try {
    const market = await db.market.findUnique({ where: { id: BigInt(id) } });
    if (!market) return Response.json({ error: "not found" }, { status: 404 });
    if (market.oracle !== "Reflector" || !market.asset) {
      return Response.json({ error: "not a price market" }, { status: 400 });
    }
    const listedAt = Math.floor(market.createdAt.getTime() / 1000);
    const now = Math.floor(Date.now() / 1000);
    const windowEnd = Math.min(now, market.settleTs);
    const windowStart = Math.max(listedAt - FEED_RESOLUTION, windowEnd - 86_400);

    let samples = await db.priceSample.findMany({
      where: { asset: market.asset, ts: { gte: windowStart, lte: windowEnd } },
      orderBy: { ts: "asc" },
    });

    // Bounded backfill of gaps from the feed's own history.
    const have = new Set(samples.map((s) => s.ts));
    const firstGrid = windowStart - (windowStart % BACKFILL_STEP) + BACKFILL_STEP;
    let reads = 0;
    for (let ts = firstGrid; ts <= windowEnd && reads < BACKFILL_MAX; ts += BACKFILL_STEP) {
      const aligned = ts - (ts % FEED_RESOLUTION);
      if (have.has(aligned)) continue;
      reads++;
      const p = await getPriceAt(market.asset, aligned).catch(() => null);
      if (!p) continue;
      await db.priceSample
        .upsert({
          where: { id: `${market.asset}-${aligned}` },
          update: {},
          create: { id: `${market.asset}-${aligned}`, asset: market.asset, ts: aligned, price: p.price.toString() },
        })
        .catch(() => {});
      have.add(aligned);
    }
    if (reads > 0) {
      samples = await db.priceSample.findMany({
        where: { asset: market.asset, ts: { gte: windowStart, lte: windowEnd } },
        orderBy: { ts: "asc" },
      });
    }

    return Response.json({
      asset: market.asset,
      baseline: market.baseline,
      rungs: market.rungs,
      sideA: market.sideA,
      sideB: market.sideB,
      settleTs: market.settleTs,
      closeTs: market.closeTs,
      samples: samples.map((s) => ({ ts: s.ts, price: s.price })),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
