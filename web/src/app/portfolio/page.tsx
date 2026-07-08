"use client";

// Portfolio (1.5b/c): the connected wallet's positions across known markets,
// with the honest per-phase number (live implied / if-settled-now / final),
// dead positions shown as "banked into pool" (never silently vanished), and
// one-tap pull-based claims (winnings or cancelled-market refunds).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatusPill } from "@/components/status-pill";
import {
  buildClaimXdr,
  explorerTxUrl,
  getLadder,
  getMarket,
  getOutcome,
  getPositions,
  submitAndWait,
  type LadderRowView,
  type MarketView,
  type OutcomeView,
  type PositionView,
} from "@/lib/bakunawa";
import { formatUsdc } from "@/lib/config";
import { uiStatus, type UiStatus } from "@/lib/market-status";
import { knownMarketIds } from "@/lib/markets-registry";
import { getLiveMove, type LiveMove } from "@/lib/reflector";
import { outcomeRung, type RungState } from "@/lib/parimutuel";
import { useWallet } from "@/lib/wallet-context";

interface Group {
  market: MarketView;
  status: UiStatus;
  ladder: LadderRowView[];
  outcome: OutcomeView | null;
  move: LiveMove | null;
  positions: PositionView[];
}

function positionState(g: Group, p: PositionView): { label: string; cls: string } {
  const fmt = (roi: number) => `+${(roi * 100).toFixed(1)}%`;
  const render = (rs: RungState, suffix: string) =>
    rs.state === "won"
      ? { label: `${fmt(rs.roi)} ${suffix}`, cls: "text-emerald-400" }
      : rs.state === "banked"
        ? { label: "banked into pool", cls: "text-amber-400" }
        : { label: suffix === "if settled now" ? "losing now" : "lost", cls: "text-neutral-500" };

  if (g.status === "Cancelled")
    return p.claimed
      ? { label: "refunded", cls: "text-neutral-500" }
      : { label: "refund available", cls: "text-amber-300" };
  if (g.status === "Settled" && g.outcome) {
    const rs = outcomeRung(
      g.ladder, g.outcome.winner, g.outcome.margin, p.side, p.rung, g.market.rakeBps,
    );
    if (rs.state === "won" && p.claimed) return { label: `${fmt(rs.roi)} · claimed`, cls: "text-neutral-400" };
    return render(rs, "won");
  }
  if ((g.status === "Locked" || g.status === "Settling") && g.move?.winningSide != null) {
    return render(
      outcomeRung(g.ladder, g.move.winningSide, g.move.units, p.side, p.rung, g.market.rakeBps),
      "if settled now",
    );
  }
  // Open: implied at the position's own minimal winning outcome
  return render(outcomeRung(g.ladder, p.side, p.rung, p.side, p.rung, g.market.rakeBps), "if settled now");
}

function claimable(g: Group): bigint {
  if (g.status === "Cancelled")
    return g.positions.filter((p) => !p.claimed).reduce((a, p) => a + p.stake, 0n);
  if (g.status === "Settled" && g.outcome) {
    return g.positions
      .filter((p) => !p.claimed)
      .reduce((a, p) => {
        const rs = outcomeRung(
          g.ladder, g.outcome!.winner, g.outcome!.margin, p.side, p.rung, g.market.rakeBps,
        );
        return rs.state === "won"
          ? a + p.stake + BigInt(Math.floor(Number(p.stake) * rs.roi))
          : a;
      }, 0n);
  }
  return 0n;
}

export default function PortfolioPage() {
  const { address, signTransaction } = useWallet();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    const found: Group[] = [];
    await Promise.all(
      knownMarketIds().map(async (id) => {
        try {
          const positions = await getPositions(id, address);
          if (positions.length === 0) return;
          const market = await getMarket(id);
          const status = uiStatus(market);
          const [ladder, outcome, move] = await Promise.all([
            getLadder(id),
            market.status === "Settled" ? getOutcome(id) : null,
            market.oracle === "Reflector" && market.status === "Open"
              ? getLiveMove(market.asset, market.baseline).catch(() => null)
              : null,
          ]);
          found.push({ market, status, ladder, outcome, move, positions });
        } catch {
          /* skip */
        }
      }),
    );
    setGroups(found.sort((a, b) => Number(b.market.id - a.market.id)));
    setLoaded(true);
  }, [address]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function claim(marketId: number) {
    if (!address) return;
    setClaiming(marketId);
    setNotice(null);
    try {
      const xdr = await buildClaimXdr(address, BigInt(marketId));
      const signed = await signTransaction(xdr);
      const hash = await submitAndWait(signed);
      setNotice({ ok: true, text: `Claimed from market #${marketId}`, hash });
      await refresh();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setClaiming(null);
    }
  }

  if (!address)
    return (
      <p className="py-16 text-center text-sm text-neutral-400">
        <Link href="/connect" className="underline">
          Connect a wallet
        </Link>{" "}
        to see your positions.
      </p>
    );

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Portfolio</h1>
      {notice && (
        <p className={`text-sm ${notice.ok ? "text-emerald-400" : "text-red-400"}`}>
          {notice.text}
          {notice.hash && (
            <>
              {" · "}
              <a href={explorerTxUrl(notice.hash)} target="_blank" rel="noreferrer" className="underline">
                view transaction
              </a>
            </>
          )}
        </p>
      )}
      {!loaded ? (
        <p className="text-sm text-neutral-500">Reading positions from chain…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-neutral-400">
          No positions yet —{" "}
          <Link href="/markets" className="underline">
            browse markets
          </Link>
          .
        </p>
      ) : (
        groups.map((g) => {
          const canClaim = claimable(g);
          return (
            <div key={String(g.market.id)} className="rounded-lg border border-neutral-800">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <Link href={`/markets/${g.market.id}`} className="font-medium underline-offset-2 hover:underline">
                    {g.market.oracle === "Reflector"
                      ? `${g.market.asset} ${g.market.sideA}/${g.market.sideB}`
                      : `${g.market.sideA} vs ${g.market.sideB}`}{" "}
                    <span className="text-neutral-500">#{String(g.market.id)}</span>
                  </Link>
                  <StatusPill status={g.status} />
                </div>
                {canClaim > 0n && (
                  <button
                    onClick={() => claim(Number(g.market.id))}
                    disabled={claiming !== null}
                    className="rounded bg-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-950 hover:bg-emerald-200 disabled:opacity-50"
                  >
                    {claiming === Number(g.market.id)
                      ? "Claiming…"
                      : `Claim ${formatUsdc(canClaim)} USDC`}
                  </button>
                )}
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {g.positions.map((p, i) => {
                    const st = positionState(g, p);
                    return (
                      <tr key={i} className="border-t border-neutral-900 first:border-t-0">
                        <td className="px-4 py-2.5">
                          <Link href={`/portfolio/${g.market.id}-${i}`} className="hover:underline">
                            {p.side === 0 ? g.market.sideA : g.market.sideB}{" "}
                            {p.rung === 0
                              ? "wins"
                              : g.market.oracle === "Reflector"
                                ? `by ≥ ${(p.rung / 100).toFixed(2)}%`
                                : `by ≥ ${p.rung}`}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{formatUsdc(p.stake)} USDC</td>
                        <td className={`px-4 py-2.5 ${st.cls}`}>{st.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })
      )}
      <p className="text-xs text-neutral-600">
        States refresh from chain every 15s. Claims are pull-based — winnings and refunds
        stay in the market contract until you claim them.
      </p>
    </div>
  );
}
