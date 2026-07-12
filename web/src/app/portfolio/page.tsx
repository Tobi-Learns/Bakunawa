"use client";

// Portfolio (1.13 unified shares): one table per market. Every holding is
// share-denominated —
//   NEUTRAL      tradable side shares (however acquired: minted or bought on the
//                DEX). Fungible -> no on-chain cost basis; "bought at" is the
//                weighted average of the wallet's in-app mints (positions-meta),
//                or "—" for DEX/other-browser buys. Redeem after settle.
//   CONVICTIONS  locked, share-denominated positions (stake + shares both on
//                chain), so a real $/share, cost, and ROI. Dead ones bank.
// Columns: Margin · Shares · Bought at · Cost · Return (min–max if it wins) ·
// Deeper pool. Payout = parimutuel pool split (NOT a fixed $1/share).

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
import { outcomeRung, settlePayout, type RungState } from "@/lib/parimutuel";
import { neutralBasis } from "@/lib/positions-meta";
import { useWallet } from "@/lib/wallet-context";

interface Group {
  market: MarketView;
  status: UiStatus;
  ladder: LadderRowView[];
  outcome: OutcomeView | null;
  move: LiveMove | null;
  positions: PositionView[]; // convictions
  tickets: [bigint, bigint]; // Neutral shares held per side
}

const num = (v: bigint) => Number(v);
const usd = (stroops: number) => `$${(stroops / 1e7).toFixed(2)}`;

function fmtRoi(roi: number) {
  return `${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(Math.abs(roi) >= 10 ? 0 : 1)}%`;
}

/** Same-side money staked at rungs strictly deeper than `rung` — the dominance
 *  pool sitting above this position (banks into it if those rungs miss). */
function deeperPool(g: Group, side: number, rung: number): bigint {
  return g.ladder
    .filter((r) => r.side === side && r.rung > rung)
    .reduce((a, r) => a + r.stake, 0n);
}

/** Payout (USDC stroops) at the two boundary outcomes for a winning position. */
function winPayoutRange(
  g: Group,
  pos: { side: number; rung: number; shares: number; stake: number },
): { lo: number; hi: number } | null {
  const maxRung = g.market.rungs.length
    ? Math.max(pos.rung, ...g.market.rungs)
    : pos.rung;
  const best = settlePayout(g.ladder, pos, pos.side, pos.rung, g.market.rakeBps);
  const worst = settlePayout(g.ladder, pos, pos.side, maxRung, g.market.rakeBps);
  if (best === null || worst === null) return null;
  return { lo: Math.min(best, worst), hi: Math.max(best, worst) };
}

/** Return cell for an OPEN position: ROI range when a cost basis exists
 *  (convictions: stake), else the redeemable payout range in USDC. */
function openReturn(
  g: Group,
  pos: { side: number; rung: number; shares: number; stake: number },
  basis: number | null,
): { text: string; cls: string } {
  const r = winPayoutRange(g, pos);
  if (!r) return { text: "—", cls: "text-neutral-600" };
  if (basis && basis > 0) {
    const lo = r.lo / basis - 1;
    const hi = r.hi / basis - 1;
    const same = Math.abs(hi - lo) < 0.005;
    return {
      text: `${same ? fmtRoi(hi) : `${fmtRoi(lo)} – ${fmtRoi(hi)}`} if it wins`,
      cls: "text-emerald-400",
    };
  }
  const same = Math.abs(r.hi - r.lo) < 1e5;
  return {
    text: `${same ? usd(r.hi) : `${usd(r.lo)} – ${usd(r.hi)}`} if it wins`,
    cls: "text-neutral-200",
  };
}

/** Return cell at a KNOWN outcome (Locked live-move / Settled). */
function outcomeReturn(
  g: Group,
  pos: { side: number; rung: number; shares: number; stake: number },
  winner: number,
  margin: number,
  suffix: string,
): { text: string; cls: string } {
  const rs: RungState = outcomeRung(g.ladder, winner, margin, pos, g.market.rakeBps);
  if (rs.state === "won") {
    // ROI needs a basis; convictions have one (stake), Neutral shows payout.
    if (pos.stake > 0) return { text: `${fmtRoi(rs.roi)} ${suffix}`, cls: "text-emerald-400" };
    const pay = settlePayout(g.ladder, pos, winner, margin, g.market.rakeBps);
    return { text: `${usd(pay ?? 0)} ${suffix}`, cls: "text-emerald-400" };
  }
  if (rs.state === "banked") return { text: "banked into pool", cls: "text-amber-400" };
  return { text: suffix.includes("now") ? "losing now" : "lost", cls: "text-neutral-500" };
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

  const marginLabel = (m: MarketView, rung: number) =>
    rung === 0
      ? "Neutral"
      : m.oracle === "Reflector"
        ? `≥ ${(rung / 100).toFixed(2)}%`
        : `≥ ${rung}`;

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
                (p) => !p.claimed && p.side === g.outcome!.winner && p.rung <= g.outcome!.margin,
              )) ||
            (g.status === "Cancelled" && g.positions.some((p) => !p.claimed));

          // Build the display rows: a Neutral row per held side, then convictions.
          type Row = {
            key: string;
            side: number;
            rung: number;
            shares: bigint;
            stake: number; // pos stake for settlement (convictions); 0 for Neutral
            boughtAt: string; // $/share
            cost: number | null; // total USDC cost basis (stroops); null if unknown
            redeem?: bigint; // Neutral shares to redeem (when redeemable)
          };
          const rows: Row[] = [];
          for (const side of [0, 1]) {
            const held = g.tickets[side];
            if (held > 0n) {
              // Fungible: no on-chain basis — use the wallet's recorded in-app
              // mints (weighted average). DEX buys / other browsers -> "—".
              const basis = neutralBasis(id, side);
              rows.push({
                key: `n${side}`,
                side,
                rung: 0,
                shares: held,
                stake: 0,
                boughtAt: basis ? `$${basis.avgPrice.toFixed(4)}` : "—",
                cost: basis ? num(held) * basis.avgPrice : null,
                redeem: held,
              });
            }
          }
          g.positions.forEach((p, i) => {
            const price = num(p.shares) > 0 ? num(p.stake) / num(p.shares) : 0;
            rows.push({
              key: `c${i}`,
              side: p.side,
              rung: p.rung,
              shares: p.shares,
              stake: num(p.stake),
              boughtAt: `$${price.toFixed(4)}`,
              cost: num(p.stake), // convictions: stake is the cost basis (on-chain)
            });
          });

          const returnCell = (row: Row) => {
            const pos = { side: row.side, rung: row.rung, shares: num(row.shares), stake: row.stake };
            if (g.status === "Cancelled")
              return { text: "refund available", cls: "text-amber-300" };
            if (g.status === "Settled" && g.outcome)
              return outcomeReturn(g, pos, g.outcome.winner, g.outcome.margin, "settled");
            if ((g.status === "Locked" || g.status === "Settling") && g.move?.winningSide != null)
              return outcomeReturn(g, pos, g.move.winningSide, g.move.units, "if settled now");
            return openReturn(g, pos, row.cost);
          };

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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-neutral-500">
                    <tr>
                      <th className="px-4 py-2 font-normal">{sideName(0)} / {sideName(1)} · margin</th>
                      <th className="px-4 py-2 font-normal">Shares</th>
                      <th className="px-4 py-2 font-normal">Bought at</th>
                      <th className="px-4 py-2 font-normal">Cost</th>
                      <th className="px-4 py-2 font-normal">Return</th>
                      <th className="px-4 py-2 font-normal">Deeper pool</th>
                      <th className="px-4 py-2 font-normal text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const ret = returnCell(row);
                      const redeemable =
                        row.redeem != null &&
                        ((g.status === "Settled" && g.outcome?.winner === row.side) ||
                          g.status === "Cancelled");
                      return (
                        <tr key={row.key} className="border-t border-neutral-900">
                          <td className="px-4 py-2.5">
                            <span className="text-neutral-300">{sideName(row.side)}</span>{" "}
                            <span className="text-neutral-500">·</span>{" "}
                            {marginLabel(g.market, row.rung)}
                          </td>
                          <td className="px-4 py-2.5 tabular-nums">{formatUsdc(row.shares)}</td>
                          <td className="px-4 py-2.5 tabular-nums text-neutral-400">{row.boughtAt}</td>
                          <td className="px-4 py-2.5 tabular-nums text-neutral-400">
                            {row.cost != null ? `$${(row.cost / 1e7).toFixed(2)}` : "—"}
                          </td>
                          <td className={`px-4 py-2.5 ${ret.cls}`}>{ret.text}</td>
                          <td className="px-4 py-2.5 tabular-nums text-neutral-400">
                            {deeperPool(g, row.side, row.rung) > 0n
                              ? `$${formatUsdc(deeperPool(g, row.side, row.rung))}`
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {redeemable && row.redeem != null && (
                              <button
                                onClick={() =>
                                  run(
                                    `redeem-${id}-${row.side}`,
                                    () => buildRedeemXdr(address, BigInt(id), row.side, row.redeem!),
                                    `Redeemed ${sideName(row.side)} shares on #${id}`,
                                  )
                                }
                                disabled={busy !== null}
                                className="rounded bg-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-950 disabled:opacity-50"
                              >
                                {busy === `redeem-${id}-${row.side}` ? "Redeeming…" : "Redeem"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
      <p className="text-xs text-neutral-600">
        States refresh from chain every 15s. Every holding is share-denominated;
        price/share is the crowd probability ($0.01–$0.99). Open positions show a
        min–max range because the payout depends on the final margin — deeper
        same-side convictions bank into your share when they miss and take a cut
        when they land. Payout is a parimutuel pool split, not a fixed $1/share.
        Convictions carry an on-chain cost basis; Neutral shares are fungible, so
        their bought-at is a weighted average of your in-app buys recorded
        locally (DEX buys or another browser show a dash). Redemptions and claims are pull-based.
      </p>
    </div>
  );
}
