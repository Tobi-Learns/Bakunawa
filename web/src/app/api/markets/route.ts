// Read API (Phase 1.6c): fast market browsing from the DB cache.
// The ladder's live numbers deliberately do NOT come from here — implied
// payouts are computed client-side from chain state (locked design rule).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";

function json(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    { status, headers: { "content-type": "application/json" } },
  );
}

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status"); // on-chain status
  const category = req.nextUrl.searchParams.get("category");
  const oracle = req.nextUrl.searchParams.get("oracle");
  try {
    const markets = await db.market.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
        ...(oracle ? { oracle } : {}),
      },
      orderBy: { id: "desc" },
      take: 100,
    });
    return json({ markets });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
