import type { MarketView } from "./bakunawa";

/** UI lifecycle derived from on-chain status + the clock.
 *  Open -> Locked (predictions closed, event under way) -> Settling (awaiting
 *  oracle trigger) -> [Proposed (Admin result posted, dispute window)] ->
 *  Settled / Cancelled. "Proposed" is an on-chain status (Phase 2 optimistic
 *  oracle); Reflector markets never pass through it. */
export type UiStatus = "Open" | "Locked" | "Settling" | "Proposed" | "Settled" | "Cancelled";

/** True once `unixSec` (seconds) is in the past. Wrapped here (not inlined in a
 *  component) so the render-purity lint stays happy — callers re-render on their
 *  poll/tick to refresh the result. */
export function isPast(unixSec: number, nowSec = Date.now() / 1000): boolean {
  return nowSec >= unixSec;
}

export function uiStatus(m: MarketView, nowSec = Date.now() / 1000): UiStatus {
  if (m.status !== "Open") return m.status; // Proposed / Settled / Cancelled pass through
  if (nowSec >= m.settleTs) return "Settling";
  if (nowSec >= m.closeTs) return "Locked";
  return "Open";
}

export const STATUS_STYLE: Record<UiStatus, string> = {
  Open: "border-positive/40 bg-positive/10 text-positive",
  Locked: "border-action/40 bg-action/10 text-action-hover",
  Settling: "border-warning/40 bg-warning/10 text-warning",
  Proposed: "border-warning/50 bg-warning/12 text-warning",
  Settled: "border-info/40 bg-info/10 text-info",
  Cancelled: "border-line-strong bg-panel-muted text-ink-muted",
};
