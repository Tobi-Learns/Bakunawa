// Curator metadata (Phase 1.7): title/description/category + the S7 display
// curve. These columns are never touched by the indexer, and this route never
// touches chain-derived columns. Ends with a sync so the cache is fresh.

import { NextRequest } from "next/server";
import { adminAuthorized } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { syncMarket } from "@/lib/indexer";
import { Prisma } from "@prisma/client";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!adminAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "invalid id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as {
    title?: string;
    description?: string;
    category?: string;
    curve?: unknown;
  } | null;
  if (!body) return Response.json({ error: "invalid body" }, { status: 400 });

  try {
    // Market row may not exist yet (metadata set right after on-chain create) —
    // sync first so the row is present, then patch metadata.
    await syncMarket(BigInt(id));
    await db.market.update({
      where: { id: BigInt(id) },
      data: {
        ...(body.title !== undefined ? { title: body.title || null } : {}),
        ...(body.description !== undefined
          ? { description: body.description || null }
          : {}),
        ...(body.category !== undefined ? { category: body.category || null } : {}),
        ...(body.curve !== undefined
          ? { curve: (body.curve ?? Prisma.JsonNull) as Prisma.InputJsonValue }
          : {}),
      },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
