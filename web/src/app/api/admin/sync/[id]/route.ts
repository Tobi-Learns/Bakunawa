// Force-sync one market from chain (curator hits this after signed actions).

import { NextRequest } from "next/server";
import { adminAuthorized } from "@/lib/admin-auth";
import { syncMarket } from "@/lib/indexer";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!adminAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "invalid id" }, { status: 400 });
  try {
    await syncMarket(BigInt(id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
