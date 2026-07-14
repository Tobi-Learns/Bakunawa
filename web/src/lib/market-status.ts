import type { MarketView } from "./bakunawa";

/** UI lifecycle derived from on-chain status + the clock.
 *  Open -> Locked (predictions closed, event under way) -> Settling (awaiting
 *  oracle trigger) -> Settled / Cancelled. */
export type UiStatus = "Open" | "Locked" | "Settling" | "Settled" | "Cancelled";

export function uiStatus(m: MarketView, nowSec = Date.now() / 1000): UiStatus {
  if (m.status !== "Open") return m.status;
  if (nowSec >= m.settleTs) return "Settling";
  if (nowSec >= m.closeTs) return "Locked";
  return "Open";
}

export const STATUS_STYLE: Record<UiStatus, string> = {
  Open: "border-positive/40 bg-positive/10 text-positive",
  Locked: "border-action/40 bg-action/10 text-action-hover",
  Settling: "border-warning/40 bg-warning/10 text-warning",
  Settled: "border-info/40 bg-info/10 text-info",
  Cancelled: "border-line-strong bg-panel-muted text-ink-muted",
};
