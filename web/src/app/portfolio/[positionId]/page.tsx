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
import { demandMult, outcomeRung } from "@/lib/parimutuel";
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
      <p className="py-16 text-center text-sm text-neutral-400">
        <Link href="/connect" className="underline">
          Connect a wallet
        </Link>{" "}
        to view this position.
      </p>
    );
  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!market || !position)
    return <p className="text-sm text-neutral-500">Reading position from chain…</p>;

  const status = uiStatus(market);
  const meta = findPositionMeta(marketId, position.side, position.rung, position.stake);
  const sideName = position.side === 0 ? market.sideA : market.sideB;
  const rungLabel =
    position.rung === 0
      ? "winner only"
      : market.oracle === "Reflector"
        ? `≥ ${(position.rung / 100).toFixed(2)}%`
        : `≥ ${position.rung}`;
  const multNow = demandMult(ladder, position.side, position.rung);
  const nowState = outcomeRung(
    ladder,
    outcome?.winner ?? position.side,
    outcome?.margin ?? position.rung,
    position.side,
    position.rung,
    market.rakeBps,
  );

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between border-t border-neutral-900 px-4 py-2.5 first:border-t-0">
      <span className="text-neutral-400">{label}</span>
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

      <div className="rounded-lg border border-neutral-800 text-sm">
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
            <span className="text-neutral-600">placed outside this browser</span>
          ),
        )}
        {row("Rarity multiplier now", `×${multNow ? multNow.toFixed(2) : "—"}`)}
        {status !== "Settled" &&
          status !== "Cancelled" &&
          row(
            "If settled now",
            nowState.state === "won" ? (
              <span className="text-emerald-400">+{(nowState.roi * 100).toFixed(1)}%</span>
            ) : nowState.state === "banked" ? (
              <span className="text-amber-400">banked into pool</span>
            ) : (
              <span className="text-neutral-500">losing</span>
            ),
          )}
        {status === "Cancelled" &&
          row("Result", position.claimed ? "refunded" : "refund available in portfolio")}
        {status === "Settled" &&
          outcome &&
          row(
            "Settlement",
            nowState.state === "won" ? (
              <span className="text-emerald-400">
                +{(nowState.roi * 100).toFixed(1)}% ={" "}
                {formatUsdc(
                  position.stake + BigInt(Math.floor(Number(position.stake) * nowState.roi)),
                )}{" "}
                USDC {position.claimed ? "· claimed" : "· claim in portfolio"}
              </span>
            ) : nowState.state === "banked" ? (
              <span className="text-amber-400">
                margin unmet — stake banked into the pool
              </span>
            ) : (
              <span className="text-neutral-500">wrong side — stake lost</span>
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

      <Link href="/portfolio" className="text-sm text-neutral-400 underline">
        ← Back to portfolio
      </Link>
    </div>
  );
}
