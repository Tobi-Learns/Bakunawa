import Link from "next/link";
import { Countdown } from "@/components/countdown";
import { StatusPill } from "@/components/status-pill";
import type { MarketView } from "@/lib/bakunawa";
import { formatUsdc } from "@/lib/config";
import { uiStatus } from "@/lib/market-status";
import { ui } from "@/lib/ui";

export interface CatalogMarket {
  id: string;
  title?: string | null;
  asset?: string | null;
  sideA: string;
  sideB: string;
  oracle: string;
  status: string;
  closeTs: number;
  settleTs: number;
  pool: string;
  sidePoolA: string;
  sidePoolB: string;
  winner?: number | null;
}

function percent(part: bigint, total: bigint) {
  if (total === 0n) return 50;
  return Number((part * 1000n + total / 2n) / total) / 10;
}

function probabilityLabel(value: number) {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

export function MarketCard({ market: m }: { market: CatalogMarket }) {
  const status = uiStatus({
    status: m.status,
    closeTs: m.closeTs,
    settleTs: m.settleTs,
  } as MarketView);
  const pool = BigInt(m.pool);
  const sidePoolA = BigInt(m.sidePoolA);
  const sidePoolB = BigInt(m.sidePoolB);
  const sideA = percent(sidePoolA, pool);
  const sideB = percent(sidePoolB, pool);
  const name =
    m.title ??
    (m.oracle === "Reflector" ? `${m.asset} ${m.sideA}/${m.sideB}` : `${m.sideA} vs ${m.sideB}`);

  return (
    <Link href={`/markets/${m.id}`} className={`${ui.cardInteractive} flex min-h-56 flex-col gap-4 p-4`}>
      <div className="flex items-start justify-between gap-3">
        <span className="line-clamp-2 font-semibold leading-snug text-ink">{name}</span>
        <StatusPill status={status} />
      </div>

      <div className="grid grid-cols-2 gap-2" aria-label="Crowd forecast">
        <div className="min-w-0 rounded-lg border border-info/25 bg-info/8 p-3">
          <div className="truncate text-xs font-medium text-ink-muted">{m.sideA}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-info">
            {probabilityLabel(sideA)}
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-action/25 bg-action/8 p-3 text-right">
          <div className="truncate text-xs font-medium text-ink-muted">{m.sideB}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-action-hover">
            {probabilityLabel(sideB)}
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-3 text-xs">
        <div>
          <div className="text-ink-subtle">Pool</div>
          <div className="mt-0.5 font-semibold tabular-nums text-ink-secondary">
            {formatUsdc(pool)} USDC
          </div>
        </div>
        <div className="text-right text-ink-muted">
          {status === "Open" ? (
            <>locks in <Countdown to={m.closeTs} /></>
          ) : status === "Locked" ? (
            <>settles in <Countdown to={m.settleTs} /></>
          ) : status === "Settled" && m.winner != null ? (
            `${m.winner === 0 ? m.sideA : m.sideB} won`
          ) : (
            status
          )}
        </div>
      </div>
    </Link>
  );
}
