import { NextRequest } from "next/server";
import { db } from "@/lib/db";

function json(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    { status, headers: { "content-type": "application/json" } },
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return json({ error: "invalid id" }, 400);
  try {
    const market = await db.market.findUnique({
      where: { id: BigInt(id) },
      include: { positions: { orderBy: { at: "desc" }, take: 100 } },
    });
    if (!market) return json({ error: "not found" }, 404);
    return json({ market });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
