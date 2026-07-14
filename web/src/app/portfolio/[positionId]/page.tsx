"use client";

// Position detail (1.5d): entry vs now. positionId = "<marketId>-<index>"
// into the wallet's on-chain position vec. Entry-time quote/tx come from the
// local write-through meta (positions placed elsewhere show no entry data).

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { StatusPill } from "@/components/status-pill";
import {
  explorerTxUrl,
  getOutcome,
  getPositions,
  type OutcomeView,
  type PositionView,
} from "@/lib/bakunawa";
import { getLadder, getMarket, type LadderRowView, type MarketView } from "@/lib/bakunawa";
import { formatUsdc } from "@/lib/config";
import { uiStatus } from "@/lib/market-status";
import { outcomeRung, sharePrice } from "@/lib/parimutuel";
import { findPositionMeta } from "@/lib/positions-meta";
import { useWallet } from "@/lib/wallet-context";

export default function PositionPage({
  params,
}: {
  params: Promise<{ positionId: string }>;
}) {
  const { positionId } = use(params);
  const { address } = useWallet();
  const [marketIdStr, indexStr] = positionId.split("-");
  const marketId = Number(marketIdStr);
  const index = Number(indexStr ?? 0);

  const [market, setMarket] = useState<MarketView | null>(null);
  const [ladder, setLadder] = useState<LadderRowView[]>([]);
  const [outcome, setOutcome] = useState<OutcomeView | null>(null);
  const [position, setPosition] = useState<PositionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address || !Number.isFinite(marketId)) return;
    let live = true;
    (async () => {
      try {
        const [m, l, positions] = await Promise.all([
          getMarket(marketId),
          getLadder(marketId),
          getPositions(marketId, address),
        ]);
        const o = m.status === "Settled" ? await getOutcome(marketId) : null;
        if (!live) return;
        setMarket(m);
        setLadder(l);
        setOutcome(o);
        setPosition(positions[index] ?? null);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [address, marketId, index]);

  if (!address)
    return (
      <p className="py-16 text-center text-sm text-ink-muted">
        <Link href="/connect" className="underline">
          Connect a wallet
        </Link>{" "}
        to view this position.
      </p>
    );
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!market || !position)
    return <p className="text-sm text-ink-muted">Reading position from chain…</p>;

  const status = uiStatus(market);
  const meta = findPositionMeta(marketId, position.side, position.rung, position.stake);
  const sideName = position.side === 0 ? market.sideA : market.sideB;
  const rungLabel =
    position.rung === 0
      ? "winner only"
      : market.oracle === "Reflector"
        ? `≥ ${(position.rung / 100).toFixed(2)}%`
        : `≥ ${position.rung}`;
  const priceNow = sharePrice(ladder, position.side, position.rung);
  const pos = {
    side: position.side,
    rung: position.rung,
    stake: Number(position.stake),
    shares: Number(position.shares),
  };
  const nowState = outcomeRung(
    ladder,
    outcome?.winner ?? position.side,
    outcome?.margin ?? position.rung,
    pos,
    market.rakeBps,
  );

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between border-t border-line px-4 py-2.5 first:border-t-0">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {sideName} {rungLabel} —{" "}
          <Link href={`/markets/${marketId}`} className="underline underline-offset-2">
            market #{marketId}
          </Link>
        </h1>
        <StatusPill status={status} />
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-panel/80 text-sm">
        {row("Stake", `${formatUsdc(position.stake)} USDC`)}
        {row(
          "Entry",
          meta ? (
            <>
              {new Date(meta.at).toLocaleString()} · quoted +
              {(meta.entryRoi * 100).toFixed(1)}% ·{" "}
              <a
                href={explorerTxUrl(meta.txHash)}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                tx
              </a>
            </>
          ) : (
            <span className="text-ink-subtle">placed outside this browser</span>
          ),
        )}
        {row("Shares held", formatUsdc(position.shares))}
        {row("Price per share now", `$${priceNow.toFixed(4)}`)}
        {status !== "Settled" &&
          status !== "Cancelled" &&
          row(
            "If settled now",
            nowState.state === "won" ? (
              <span className="text-positive">+{(nowState.roi * 100).toFixed(1)}%</span>
            ) : nowState.state === "banked" ? (
              <span className="text-warning">banked into pool</span>
            ) : (
              <span className="text-ink-muted">losing</span>
            ),
          )}
        {status === "Cancelled" &&
          row("Result", position.claimed ? "refunded" : "refund available in portfolio")}
        {status === "Settled" &&
          outcome &&
          row(
            "Settlement",
            nowState.state === "won" ? (
              <span className="text-positive">
                +{(nowState.roi * 100).toFixed(1)}% ={" "}
                {formatUsdc(
                  position.stake + BigInt(Math.floor(Number(position.stake) * nowState.roi)),
                )}{" "}
                USDC {position.claimed ? "· claimed" : "· claim in portfolio"}
              </span>
            ) : nowState.state === "banked" ? (
              <span className="text-warning">
                margin unmet — stake banked into the pool
              </span>
            ) : (
              <span className="text-ink-muted">wrong side — stake lost</span>
            ),
          )}
        {status === "Settled" &&
          outcome &&
          row(
            "Outcome",
            `${outcome.winner === 0 ? market.sideA : market.sideB} by ${
              market.oracle === "Reflector"
                ? `${(outcome.margin / 100).toFixed(2)}%`
                : outcome.margin
            } · losing pool ${formatUsdc(outcome.losingPool)} USDC · fee ${formatUsdc(outcome.rakeAmount)} USDC`,
          )}
      </div>

      <Link href="/portfolio" className="inline-flex min-h-11 items-center text-sm text-ink-muted underline hover:text-ink">
        ← Back to portfolio
      </Link>
    </div>
  );
}
