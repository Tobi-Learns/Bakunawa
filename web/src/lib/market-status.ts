import type { MarketView } from "./bakunawa";

/** UI lifecycle derived from on-chain status + the clock.
 *  Open -> Locked (betting closed, event under way) -> Settling (awaiting
 *  oracle trigger) -> Settled / Cancelled. */
export type UiStatus = "Open" | "Locked" | "Settling" | "Settled" | "Cancelled";

export function uiStatus(m: MarketView, nowSec = Date.now() / 1000): UiStatus {
  if (m.status !== "Open") return m.status;
  if (nowSec >= m.settleTs) return "Settling";
  if (nowSec >= m.closeTs) return "Locked";
  return "Open";
}

export const STATUS_STYLE: Record<UiStatus, string> = {
  Open: "border-emerald-800 bg-emerald-950/50 text-emerald-300",
  Locked: "border-violet-800 bg-violet-950/50 text-violet-300",
  Settling: "border-amber-800 bg-amber-950/50 text-amber-300",
  Settled: "border-sky-800 bg-sky-950/50 text-sky-300",
  Cancelled: "border-neutral-700 bg-neutral-900 text-neutral-400",
};
