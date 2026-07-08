// Testnet configuration. Values are committed (testnet only — rotate for mainnet).
// Env vars override for deploys; NEXT_PUBLIC_ values are build-time inlined.

export const CONFIG = {
  contractId:
    process.env.NEXT_PUBLIC_BAKUNAWA_CONTRACT_ID ??
    "CDH2FL75ARKYA2VRZIJ26JXWB743JG4C4DKUPRSQWMTTDI6WLJ7MXHFY",
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
