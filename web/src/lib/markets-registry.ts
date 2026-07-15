// Known market ids. There is deliberately no on-chain enumeration — the
// indexer/DB (Phase 1.6) becomes the real browse source; until then the
// registry is built-in demo ids plus any id successfully opened locally.

import { CONFIG } from "./config";

// Demo catalog on the 1.13 unified-shares contract (CBQC2M3D…). Earlier ids
// (1xxx–5xxx) lived on retired contracts (5xxx = the D2 contract retired
// 2026-07-12 for the unified share model + money-share pricing).
const BUILTIN: number[] = [7015, 7012, 7011, 7010]; // 7015 = Phase-2 dispute QA market (temporary; remove when retired)
// Scope remembered ids to the deployed contract — a redeploy starts fresh
// instead of carrying dead ids (whose get_market fails on the new contract).
const KEY = `bakunawa:known-markets:${CONFIG.contractId.slice(0, 10)}`;

export function knownMarketIds(): number[] {
  if (typeof window === "undefined") return BUILTIN;
  try {
    const extra: number[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return [...new Set([...extra, ...BUILTIN])].sort((a, b) => b - a);
  } catch {
    return BUILTIN;
  }
}

export function rememberMarketId(id: number) {
  if (typeof window === "undefined" || BUILTIN.includes(id)) return;
  const extra: number[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  if (!extra.includes(id)) {
    localStorage.setItem(KEY, JSON.stringify([id, ...extra].slice(0, 50)));
  }
}
