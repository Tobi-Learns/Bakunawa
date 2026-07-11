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

function fmtRange(r: { min: number; max: number }): string {
  return Math.abs(r.max - r.min) < 0.005 ? fmtRoi(r.max) : `${fmtRoi(r.min)} – ${fmtRoi(r.max)}`;
}

/**
 * Open-market implied payout is a RANGE, not one number: a nested-threshold
 * pool pays differently depending on the final margin (same rule the ladder
 * and prediction slip obey). The position is already in the pool, so settle it
 * in place (no marginal probe) at the two boundary outcomes:
 *   max = side wins by exactly `rung` — deeper same-side convictions die + bank
 *   min = side wins by the largest listed rung — every same-side conviction lands
 * Collapses to a point for the top rung / a market with no convictions.
 */
function openRange(g: Group, side: number, rung: number): { min: number; max: number } | null {
  const maxRung = g.market.rungs.length ? Math.max(rung, ...g.market.rungs) : rung;
  const best = outcomeRung(g.ladder, side, rung, side, rung, g.market.rakeBps);
  const worst = outcomeRung(g.ladder, side, maxRung, side, rung, g.market.rakeBps);
  if (best.state !== "won" || worst.state !== "won") return null;
  return { min: Math.min(best.roi, worst.roi), max: Math.max(best.roi, worst.roi) };
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
  // Open, no live outcome yet: the payout is a RANGE, not the lone optimistic figure.
  const range = openRange(g, p.side, p.rung);
  return range
    ? { label: `${fmtRange(range)} if it wins`, cls: "text-emerald-400" }
    : { label: "—", cls: "text-neutral-500" };
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
  // "sharks circling": open conviction money on the ticket's own side — the
  // variance regulars are structurally short (they underperform if it lands).
  const sharks = g.ladder
    .filter((r) => r.side === side && r.rung > 0)
    .reduce((a, r) => a + r.stake, 0n);
  const sharkNote = sharks > 0n ? ` · 🦈 ${formatUsdc(sharks)} in convictions circling` : "";
  // Locked/Settling with a live oracle move: a concrete outcome → single number.
  if (g.move?.winningSide != null && (g.status === "Locked" || g.status === "Settling")) {
    const outcomeNow = outcomeRung(g.ladder, g.move.winningSide, g.move.units, side, 0, g.market.rakeBps);
    return {
      label:
        (outcomeNow.state === "won"
          ? `${fmtRoi(outcomeNow.roi)} if settled now · tradable`
          : "losing now · tradable") + sharkNote,
      cls: outcomeNow.state === "won" ? "text-neutral-200" : "text-neutral-500",
      redeemable: false,
    };
  }
  // Open: implied payout is a RANGE. Rung-0 shares see the widest spread —
  // they're structurally short every same-side conviction.
  const range = openRange(g, side, 0);
  return {
    label: (range ? `${fmtRange(range)} if it wins · tradable` : "tradable") + sharkNote,
    cls: range ? "text-neutral-200" : "text-neutral-500",
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
                        <td className="px-4 py-2.5">{sideName(side)} shares</td>
                        <td className="px-4 py-2.5 tabular-nums">{formatUsdc(held)} held</td>
                        <td className={`px-4 py-2.5 ${st.cls}`}>{st.label}</td>
                        <td className="px-4 py-2.5 text-right">
                          {st.redeemable && (
                            <button
                              onClick={() =>
                                run(
                                  `redeem-${id}-${side}`,
                                  () => buildRedeemXdr(address, BigInt(id), side, held),
                                  `Redeemed ${sideName(side)} shares on #${id}`,
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
        States refresh from chain every 15s. Open positions show a min–max range
        because the payout depends on the final margin — deeper same-side
        convictions bank into your share when they miss and take a cut when they
        land. Share rows show your live balance — including shares bought on the
        DEX. Redemptions and conviction claims are pull-based; funds stay in the
        market contract until you collect.
      </p>
    </div>
  );
}
