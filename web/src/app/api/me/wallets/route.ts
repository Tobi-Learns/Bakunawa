// 5d: the wallet binder. Bind-on-connect (Phase 5 decision 4): the client
// may only bind a wallet it has connected via Freighter — enforced socially,
// not cryptographically (no signature ceremony; binding grants no privileges
// over the wallet, it only groups public on-chain positions in a portfolio).
// Session-gated: only the signed-in user can edit their own bindings.

import { NextRequest } from "next/server";
import { StrKey } from "@stellar/stellar-sdk";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function parseAddress(req: NextRequest): Promise<string | null> {
  try {
    const body = (await req.json()) as { address?: unknown };
    const address = typeof body.address === "string" ? body.address.trim() : "";
    return StrKey.isValidEd25519PublicKey(address) ? address : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "not signed in" }, 401);
    const address = await parseAddress(req);
    if (!address) return json({ error: "invalid address" }, 400);
    await db.profileWallet.upsert({
      where: { userId_address: { userId: user.id, address } },
      update: {},
      create: { userId: user.id, address },
    });
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "not signed in" }, 401);
    const address = await parseAddress(req);
    if (!address) return json({ error: "invalid address" }, 400);
    await db.profileWallet.deleteMany({ where: { userId: user.id, address } });
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
