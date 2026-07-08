import { NextRequest } from "next/server";

/** App-secret auth for admin DB routes (metadata/sync). On-chain admin ops
 *  are separately protected by the contract's admin.require_auth(). */
export function adminAuthorized(req: NextRequest): boolean {
  const secret = process.env.BAKUNAWA_ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}
