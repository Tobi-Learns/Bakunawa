import { STATUS_STYLE, type UiStatus } from "@/lib/market-status";

export function StatusPill({ status }: { status: UiStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[status]}`}
    >
      {status === "Locked" ? "Locked · in play" : status}
    </span>
  );
}
