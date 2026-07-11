// Regular (Neutral) share totals per side (1.12c support). No contract view
// exposes RegularShares(id, side), so we reconstruct each side's blended price
// (reg_money / reg_shares) from the indexed mint history. The prediction slip
// needs it to value a Neutral position PER SHARE — the way `redeem` pays it —
// rather than per dollar (a DPM favorite's pricier shares win less). Estimate:
// float mirror of the contract's integer math; the contract is authoritative.

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { regularShareTotals } from "@/lib/replay";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "invalid id" }, { status: 400 });
  try {
    const positions = await db.position.findMany({
      where: { marketId: BigInt(id) },
      orderBy: [{ ledger: "asc" }, { id: "asc" }],
    });
    const totals = regularShareTotals(
      positions.map((p) => ({ side: p.side, rung: p.rung, stake: p.stake, at: p.at })),
    );
    return Response.json({
      regMoney: totals.map((t) => t.money),
      regShares: totals.map((t) => t.shares),
      // blended USDC/share per side; null when a side has no Neutral mints yet
      avgPrice: totals.map((t) => (t.shares > 0 ? t.money / t.shares : null)),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
