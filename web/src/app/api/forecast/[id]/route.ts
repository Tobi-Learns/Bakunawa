// Public forecast API (Phase 1.10c) — the PM-positioning information product.
// The crowd-implied margin distribution, inverted from ON-CHAIN pool state
// (trustless: read straight from the contract, not the DB cache). CORS-open
// so anyone can consume the forecast.

import { NextRequest } from "next/server";
import { getLadder, getMarket } from "@/lib/bakunawa";
import { crowdForecast } from "@/lib/forecast";

const CORS = { "access-control-allow-origin": "*" };

export function OPTIONS() {
  return new Response(null, { headers: CORS });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id))
    return Response.json({ error: "invalid id" }, { status: 400, headers: CORS });
  try {
    const market = await getMarket(BigInt(id));
    const ladder = await getLadder(BigInt(id));
    const forecast = crowdForecast(ladder, market.rungs);
    if (!forecast)
      return Response.json(
        { error: "no pool yet — forecast undefined" },
        { status: 409, headers: CORS },
      );

    const marginUnit = market.oracle === "Reflector" ? "percent_x100" : "points";
    const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);
    return Response.json(
      {
        market: id,
        asset: market.oracle === "Reflector" ? market.asset : null,
        marginUnit,
        status: market.status,
        closeTs: market.closeTs,
        settleTs: market.settleTs,
        generatedAt: Math.floor(Date.now() / 1000),
        note: "Crowd-implied margin distribution inverted from on-chain pool state. Not fixed odds.",
        sides: forecast.sides.map((f) => ({
          side: f.side,
          name: sideName(f.side),
          pWin: Number(f.pWin.toFixed(4)),
          survival: f.survival.map((s) => ({
            margin: s.rung,
            label:
              s.rung === 0
                ? "wins"
                : marginUnit === "percent_x100"
                  ? `by >= ${(s.rung / 100).toFixed(2)}%`
                  : `by >= ${s.rung}`,
            p: Number(s.p.toFixed(4)),
          })),
        })),
      },
      { headers: CORS },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500, headers: CORS },
    );
  }
}
