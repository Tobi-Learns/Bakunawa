"use client";

// Portfolio (v4): two instrument classes per market —
//  TICKETS      live balances of the wallet's side tickets (however acquired:
//               minted or bought on the DEX), redeemable after settlement
//               (winning side) or cancellation (par).
//  CONVICTIONS  locked positions with the honest per-phase state; dead ones
//               shown as "banked into pool", claims pull-based.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatusPill } from "@/components/status-pill";
import {
  buildClaimXdr,
  buildRedeemXdr,
  explorerTxUrl,
  getLadder,
  getMarket,
  getOutcome,
  getPositions,
  getTicketBalance,
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
  positions: PositionView[]; // convictions
  tickets: [bigint, bigint]; // held per side
}

function fmtRoi(roi: number) {
  return `+${(roi * 100).toFixed(1)}%`;
}

function convictionState(g: Group, p: PositionView): { label: string; cls: string } {
  const render = (rs: RungState, suffix: string) =>
    rs.state === "won"
      ? { label: `${fmtRoi(rs.roi)} ${suffix}`, cls: "text-emerald-400" }
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
    if (rs.state === "won" && p.claimed)
      return { label: `${fmtRoi(rs.roi)} · claimed`, cls: "text-neutral-400" };
    return render(rs, "won");
  }
  if ((g.status === "Locked" || g.status === "Settling") && g.move?.winningSide != null) {
    return render(
      outcomeRung(g.ladder, g.move.winningSide, g.move.units, p.side, p.rung, g.market.rakeBps),
      "if settled now",
    );
  }
  return render(outcomeRung(g.ladder, p.side, p.rung, p.side, p.rung, g.market.rakeBps), "if settled now");
}

function ticketState(g: Group, side: number): { label: string; cls: string; redeemable: boolean } {
  if (g.status === "Cancelled")
    return { label: "redeem at par", cls: "text-amber-300", redeemable: true };
  if (g.status === "Settled" && g.outcome) {
    if (side !== g.outcome.winner)
      return { label: "lost", cls: "text-neutral-500", redeemable: false };
    const rs = outcomeRung(g.ladder, g.outcome.winner, g.outcome.margin, side, 0, g.market.rakeBps);
    return {
      label: rs.state === "won" ? `${fmtRoi(rs.roi)} — redeemable` : "—",
      cls: "text-emerald-400",
      redeemable: true,
    };
  }
  const outcomeNow =
    g.move?.winningSide != null && (g.status === "Locked" || g.status === "Settling")
      ? outcomeRung(g.ladder, g.move.winningSide, g.move.units, side, 0, g.market.rakeBps)
      : outcomeRung(g.ladder, side, 0, side, 0, g.market.rakeBps);
  // "sharks circling": open conviction money on the ticket's own side — the
  // variance regulars are structurally short (they underperform if it lands).
  const sharks = g.ladder
    .filter((r) => r.side === side && r.rung > 0)
    .reduce((a, r) => a + r.stake, 0n);
  const sharkNote = sharks > 0n ? ` · 🦈 ${formatUsdc(sharks)} in convictions circling` : "";
  return {
    label:
      (outcomeNow.state === "won"
        ? `${fmtRoi(outcomeNow.roi)} if settled now · tradable`
        : "losing now · tradable") + sharkNote,
    cls: outcomeNow.state === "won" ? "text-neutral-200" : "text-neutral-500",
    redeemable: false,
  };
}

export default function PortfolioPage() {
  const { address, signTransaction } = useWallet();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    const found: Group[] = [];
    await Promise.all(
      knownMarketIds().map(async (id) => {
        try {
          const market = await getMarket(id);
          const [positions, ta, tb] = await Promise.all([
            getPositions(id, address),
            getTicketBalance(market, 0, address).catch(() => 0n),
            getTicketBalance(market, 1, address).catch(() => 0n),
          ]);
          if (positions.length === 0 && ta === 0n && tb === 0n) return;
          const status = uiStatus(market);
          const [ladder, outcome, move] = await Promise.all([
            getLadder(id),
            market.status === "Settled" ? getOutcome(id) : null,
            market.oracle === "Reflector" && market.status === "Open"
              ? getLiveMove(market.asset, market.baseline).catch(() => null)
              : null,
          ]);
          found.push({ market, status, ladder, outcome, move, positions, tickets: [ta, tb] });
        } catch {
          /* market unreadable — skip */
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

  async function run(key: string, build: () => Promise<string>, done: string) {
    if (!address) return;
    setBusy(key);
    setNotice(null);
    try {
      const signed = await signTransaction(await build());
      const hash = await submitAndWait(signed);
      setNotice({ ok: true, text: done, hash });
      await refresh();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
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
          const id = Number(g.market.id);
          const sideName = (s: number) => (s === 0 ? g.market.sideA : g.market.sideB);
          const canClaim =
            (g.status === "Settled" &&
              g.outcome &&
              g.positions.some(
                (p) =>
                  !p.claimed && p.side === g.outcome!.winner && p.rung <= g.outcome!.margin,
              )) ||
            (g.status === "Cancelled" && g.positions.some((p) => !p.claimed));
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
                {canClaim && (
                  <button
                    onClick={() =>
                      run(`claim-${id}`, () => buildClaimXdr(address, BigInt(id)), `Claimed convictions on #${id}`)
                    }
                    disabled={busy !== null}
                    className="rounded bg-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-950 hover:bg-emerald-200 disabled:opacity-50"
                  >
                    {busy === `claim-${id}` ? "Claiming…" : "Claim convictions"}
                  </button>
                )}
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {[0, 1].map((side) => {
                    const held = g.tickets[side];
                    if (held === 0n) return null;
                    const st = ticketState(g, side);
                    return (
                      <tr key={`t${side}`} className="border-t border-neutral-900 first:border-t-0">
                        <td className="px-4 py-2.5">{sideName(side)} tickets</td>
                        <td className="px-4 py-2.5 tabular-nums">{formatUsdc(held)} held</td>
                        <td className={`px-4 py-2.5 ${st.cls}`}>{st.label}</td>
                        <td className="px-4 py-2.5 text-right">
                          {st.redeemable && (
                            <button
                              onClick={() =>
                                run(
                                  `redeem-${id}-${side}`,
                                  () => buildRedeemXdr(address, BigInt(id), side, held),
                                  `Redeemed ${sideName(side)} tickets on #${id}`,
                                )
                              }
                              disabled={busy !== null}
                              className="rounded bg-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-950 disabled:opacity-50"
                            >
                              {busy === `redeem-${id}-${side}` ? "Redeeming…" : "Redeem"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {g.positions.map((p, i) => {
                    const st = convictionState(g, p);
                    return (
                      <tr key={i} className="border-t border-neutral-900">
                        <td className="px-4 py-2.5">
                          <Link href={`/portfolio/${g.market.id}-${i}`} className="hover:underline">
                            Conviction: {sideName(p.side)}{" "}
                            {g.market.oracle === "Reflector"
                              ? `by ≥ ${(p.rung / 100).toFixed(2)}%`
                              : `by ≥ ${p.rung}`}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{formatUsdc(p.stake)} USDC</td>
                        <td className={`px-4 py-2.5 ${st.cls}`} colSpan={2}>
                          {st.label}
                        </td>
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
        States refresh from chain every 15s. Ticket rows show your live balance —
        including tickets bought on the DEX. Redemptions and conviction claims are
        pull-based; funds stay in the market contract until you collect.
      </p>
    </div>
  );
}
