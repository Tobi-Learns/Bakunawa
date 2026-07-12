// 5c: session-scoped account state for the client (header chip, /profile).
// GET returns { configured, user | null }; PATCH updates the display name.
// Session comes from the Auth.js JWT cookie — no client-writable identity.

import { NextRequest } from "next/server";
import { authConfigured, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET() {
  try {
    const user = await currentUser();
    return json({
      configured: authConfigured,
      user: user
        ? {
            email: user.email,
            name: user.name,
            image: user.image,
            displayName: user.displayName,
            wallets: user.wallets.map((w) => ({
              address: w.address,
              label: w.label,
              boundAt: w.boundAt,
            })),
          }
        : null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) return json({ error: "not signed in" }, 401);
    const body = (await req.json()) as { displayName?: unknown };
    if (typeof body.displayName !== "string" || body.displayName.length > 40) {
      return json({ error: "displayName must be a string (max 40 chars)" }, 400);
    }
    const displayName = body.displayName.trim() || null;
    await db.user.update({ where: { id: user.id }, data: { displayName } });
    return json({ ok: true, displayName });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
