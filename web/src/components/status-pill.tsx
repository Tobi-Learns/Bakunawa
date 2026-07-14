import { STATUS_STYLE, type UiStatus } from "@/lib/market-status";

export function StatusPill({ status }: { status: UiStatus }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {status === "Locked" ? "Locked · in play" : status}
    </span>
  );
}
