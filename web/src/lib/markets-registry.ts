// Known market ids. There is deliberately no on-chain enumeration — the
// indexer/DB (Phase 1.6) becomes the real browse source; until then the
// registry is built-in demo ids plus any id successfully opened locally.

// Demo catalog on the current clean contract (CACPGURD…I22L). Earlier ids
// (1xxx–3xxx) lived on retired contracts.
const BUILTIN: number[] = [4003, 4002, 4001];
const KEY = "bakunawa:known-markets";

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
