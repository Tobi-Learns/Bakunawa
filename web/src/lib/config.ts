// Testnet configuration. Values are committed (testnet only — rotate for mainnet).
// Env vars override for deploys; NEXT_PUBLIC_ values are build-time inlined.

export const CONFIG = {
  contractId:
    process.env.NEXT_PUBLIC_BAKUNAWA_CONTRACT_ID ??
    "CABM224YYRE67THADIM7NPYKZWM6Q7EOHOVYSD2KRYLRW6BDLTCTL72R", // Phase 2 optimistic oracle (unified shares + $0.50 pricing); deployed 2026-07-14
  // Ticket assets are issued by the `issuer` identity (classic assets BK<id>A/B)
  ticketIssuer: "GDE4WALPGYAWMBBTYUUMRH5CLM3GJWQAUYXAT4HQ7WEXDMOOUGU33Q5B",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  // Stake asset: StellarPay test USDC SAC (issuer = platform identity)
  usdcSac: "CAKBCKBUE3ZRSNH6CDYAB62ZFWL7U7OX6NBZ6EUDFID22PRLICFJXHGS",
  usdcIssuer: "GAUK4F5RUHGD2SSEBS4EVB7FJSFWU65ITJBV5PYPQNVNTYB2BWCFICEY",
  // Reflector external CEX/DEX feed (testnet): 14 decimals, 300s resolution
  reflectorFeed: "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63",
  // Funded account used as the simulation source for read-only views
  readSource: "GAUK4F5RUHGD2SSEBS4EVB7FJSFWU65ITJBV5PYPQNVNTYB2BWCFICEY",
  // Contract admin (curator) — the `platform` identity; /admin gates on this
  adminAddress: "GAUK4F5RUHGD2SSEBS4EVB7FJSFWU65ITJBV5PYPQNVNTYB2BWCFICEY",
} as const;

export const USDC_DECIMALS = 7;

export function formatUsdc(stroops: bigint): string {
  const neg = stroops < 0n;
  const abs = neg ? -stroops : stroops;
  const whole = abs / 10_000_000n;
  const frac = (abs % 10_000_000n).toString().padStart(7, "0").slice(0, 2);
  return `${neg ? "-" : ""}${whole.toLocaleString()}${frac === "00" ? "" : "." + frac}`;
}

export function parseUsdc(v: string): bigint {
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole || "0") * 10_000_000n + BigInt(frac.padEnd(7, "0").slice(0, 7) || "0");
}

// --- Phase 2 optimistic oracle (Admin markets) ---

/** Global dispute-bond floor — mirrors the contract's DISPUTE_BOND_FLOOR
 *  (5 USDC in stroops). Locked in the 2a threat-model. */
export const DISPUTE_BOND_FLOOR = 50_000_000n;

/** Bond a disputer must escrow = max(FLOOR, dispute_bond_bps * pool / 10_000).
 *  Mirrors the contract's `dispute_bond()`; `poolAtPropose` is the frozen pool
 *  from the Proposal (stroops), `bps` is the market's `dispute_bond_bps`. */
export function disputeBond(poolAtPropose: bigint, bps: number): bigint {
  const proportional = (poolAtPropose * BigInt(bps)) / 10_000n;
  return proportional > DISPUTE_BOND_FLOOR ? proportional : DISPUTE_BOND_FLOOR;
}
