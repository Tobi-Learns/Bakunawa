// Curator/admin contract calls (Phase 1.7). All XDR is built here and signed
// by the CONNECTED wallet — the admin pages gate on wallet == CONFIG.adminAddress
// (contract enforces admin.require_auth() regardless; the gate is just UX).
// No admin secret key ever touches this app.

import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { buildTxXdr } from "./bakunawa";
import { CONFIG } from "./config";

export interface CreateMarketParams {
  id: bigint;
  sideA: string;
  sideB: string;
  rungs: number[];
  closeTs: number;
  settleTs: number;
  oracle: "Admin" | "Reflector";
  asset: string; // Reflector symbol, e.g. "BTC" (ignored for Admin)
  rakeBps: number;
  minPool: bigint;
  /** v4: per-side ticket SACs — classic assets pre-minted into the contract's
   *  custody BEFORE create_market (scripts/list-market.mjs does the whole
   *  sequence; the form accepts the SAC addresses it prints). */
  ticketA: string;
  ticketB: string;
  /** Phase 2 optimistic oracle (Admin markets): dispute window + pool-proportional
   *  bond. Optional here — default to the 2a-locked 24h / 100 bps; 2e surfaces
   *  proper inputs. Reflector markets ignore them (window forced to 0). */
  disputeSecs?: number;
  disputeBondBps?: number;
}

/** MarketParams struct ScVal — entries MUST be sorted by field name (XDR map). */
function marketParamsScVal(p: CreateMarketParams): xdr.ScVal {
  const feed = p.oracle === "Reflector" ? CONFIG.reflectorFeed : CONFIG.contractId;
  const entry = (key: string, val: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
  return xdr.ScVal.scvMap([
    entry("asset", xdr.ScVal.scvSymbol(p.oracle === "Reflector" ? p.asset : "NA")),
    entry("close_ts", nativeToScVal(BigInt(p.closeTs), { type: "u64" })),
    entry("dispute_bond_bps", nativeToScVal(p.disputeBondBps ?? 100, { type: "u32" })),
    entry(
      "dispute_secs",
      nativeToScVal(BigInt(p.oracle === "Reflector" ? 0 : (p.disputeSecs ?? 86400)), { type: "u64" }),
    ),
    entry("feed", new Address(feed).toScVal()),
    entry("id", nativeToScVal(p.id, { type: "u64" })),
    entry("min_pool", nativeToScVal(p.minPool, { type: "i128" })),
    entry("oracle", xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(p.oracle)])),
    entry("rake_bps", nativeToScVal(p.rakeBps, { type: "u32" })),
    entry(
      "rungs",
      xdr.ScVal.scvVec(p.rungs.map((r) => nativeToScVal(r, { type: "u32" }))),
    ),
    entry("settle_ts", nativeToScVal(BigInt(p.settleTs), { type: "u64" })),
    entry("side_a", xdr.ScVal.scvSymbol(p.sideA)),
    entry("side_b", xdr.ScVal.scvSymbol(p.sideB)),
    entry("ticket_a", new Address(p.ticketA).toScVal()),
    entry("ticket_b", new Address(p.ticketB).toScVal()),
  ]);
}

export function buildCreateMarketXdr(
  admin: string,
  params: CreateMarketParams,
): Promise<string> {
  return buildTxXdr(admin, "create_market", marketParamsScVal(params));
}

// --- Phase 2 optimistic oracle (Admin markets) ---
// The old instant `settle_admin` was removed at the 2d redeploy. Admin markets
// now settle in two phases: propose_result -> [dispute -> resolve_dispute] ->
// finalize. Reflector markets are unaffected (settle_oracle, instant).

/** Admin posts the result and opens the dispute window (status -> Proposed).
 *  Does NOT settle; claims/redeems stay frozen until `finalize`. */
export function buildProposeResultXdr(
  admin: string,
  id: bigint,
  winner: number,
  margin: number,
): Promise<string> {
  return buildTxXdr(
    admin,
    "propose_result",
    nativeToScVal(id, { type: "u64" }),
    nativeToScVal(winner, { type: "u32" }),
    nativeToScVal(margin, { type: "u32" }),
  );
}

/** Permissionless — anyone escrows the pool-proportional bond to dispute a
 *  posted result (blocks finalize until the admin resolves it). */
export function buildDisputeXdr(disputer: string, id: bigint): Promise<string> {
  return buildTxXdr(
    disputer,
    "dispute",
    nativeToScVal(id, { type: "u64" }),
    new Address(disputer).toScVal(),
  );
}

/** Admin resolves the open dispute. `uphold=true`: result stands, bond ->
 *  treasury, window continues. `uphold=false`: correct to (winner, margin),
 *  bond refunded, window restarts. */
export function buildResolveDisputeXdr(
  admin: string,
  id: bigint,
  uphold: boolean,
  winner: number,
  margin: number,
): Promise<string> {
  return buildTxXdr(
    admin,
    "resolve_dispute",
    nativeToScVal(id, { type: "u64" }),
    xdr.ScVal.scvBool(uphold),
    nativeToScVal(winner, { type: "u32" }),
    nativeToScVal(margin, { type: "u32" }),
  );
}

/** Permissionless — finalize a posted result once its window elapses with no
 *  open dispute. Runs the existing parimutuel settlement (unchanged). */
export function buildFinalizeXdr(source: string, id: bigint): Promise<string> {
  return buildTxXdr(source, "finalize", nativeToScVal(id, { type: "u64" }));
}

/** Permissionless — any connected wallet can trigger a Reflector settlement. */
export function buildSettleOracleXdr(source: string, id: bigint): Promise<string> {
  return buildTxXdr(source, "settle_oracle", nativeToScVal(id, { type: "u64" }));
}

export function buildCancelMarketXdr(admin: string, id: bigint): Promise<string> {
  return buildTxXdr(admin, "cancel_market", nativeToScVal(id, { type: "u64" }));
}

// --- Admin metadata API client (DB writes; app-secret auth) ---

const SECRET_KEY = "bakunawa:admin-secret";

export function getAdminSecret(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(SECRET_KEY) ?? "";
}

export function setAdminSecret(secret: string) {
  sessionStorage.setItem(SECRET_KEY, secret);
}

export async function patchMarketMeta(
  id: bigint | number,
  meta: {
    title?: string;
    description?: string;
    category?: string;
    curve?: unknown;
  },
): Promise<void> {
  const res = await fetch(`/api/admin/markets/${id}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getAdminSecret()}`,
    },
    body: JSON.stringify(meta),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `metadata update failed (${res.status})`);
  }
}

export async function syncMarketNow(id: bigint | number): Promise<void> {
  const res = await fetch(`/api/admin/sync/${id}`, {
    method: "POST",
    headers: { authorization: `Bearer ${getAdminSecret()}` },
  });
  if (!res.ok) throw new Error(`sync failed (${res.status})`);
}
