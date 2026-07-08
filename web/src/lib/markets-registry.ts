// Known market ids. There is deliberately no on-chain enumeration — the
// indexer/DB (Phase 1.6) becomes the real browse source; until then the
// registry is built-in demo ids plus any id successfully opened locally.

const BUILTIN: number[] = [1003, 1002, 1001];
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
