// Indexer trigger (Phase 1.6b). Scheduler lesson from StellarPay: point a
// cron-job.org job here (GET, every ~5 min, Authorization: Bearer
// BAKUNAWA_CRON_SECRET) — not GitHub Actions schedule, not Vercel Hobby cron.
// ?ids=1001,1002 forces an explicit sync (backfill / self-heal).

import { NextRequest } from "next/server";
import { runIndexer } from "@/lib/indexer";

export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.BAKUNAWA_CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: NextRequest): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const idsParam = req.nextUrl.searchParams.get("ids");
  const ids = idsParam
    ? idsParam
        .split(",")
        .filter((s) => /^\d+$/.test(s))
        .map((s) => BigInt(s))
    : [];
  try {
    const result = await runIndexer(ids);
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
