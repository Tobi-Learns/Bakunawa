"use client";

// Settlement view (1.7d + Phase 2 optimistic oracle). Reflector markets settle
// instantly (permissionless trigger). Admin markets settle in two phases:
//   Settling  -> Post result (propose_result) — opens the dispute window
//   Proposed  -> countdown + resolve any open dispute (uphold/correct) +
//                Finalize (permissionless, once the window elapses)
// Cancel is available while Open or Proposed. Every action is wallet-signed;
// the cache re-syncs after each.

import Link from "next/link";
import { use, useState } from "react";
import { AdminGate } from "@/components/admin-gate";
import { Countdown } from "@/components/countdown";
import { StatusPill } from "@/components/status-pill";
import {
  buildCancelMarketXdr,
  buildFinalizeXdr,
  buildProposeResultXdr,
  buildResolveDisputeXdr,
  buildSettleOracleXdr,
  syncMarketNow,
} from "@/lib/admin";
import { explorerTxUrl, submitAndWait } from "@/lib/bakunawa";
import { formatUsdc } from "@/lib/config";
import { isPast, uiStatus } from "@/lib/market-status";
import { useMarket } from "@/lib/use-market";
import { useWallet } from "@/lib/wallet-context";

export default function AdminSettlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { market, ladder, outcome, move, proposal, dispute } = useMarket(id);
  const { address, signTransaction } = useWallet();
  const [winner, setWinner] = useState(0);
  const [margin, setMargin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  async function run(what: string, buildXdr: () => Promise<string>) {
    if (!address) return;
    setBusy(what);
    setMsg(null);
    try {
      const xdr = await buildXdr();
      const signed = await signTransaction(xdr);
      const hash = await submitAndWait(signed);
      await syncMarketNow(BigInt(id)).catch(() => {});
      setMsg({ ok: true, text: `${what} confirmed`, hash });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  if (!market)
    return (
      <AdminGate>
        <p className="text-sm text-ink-muted">Reading market #{id} from chain…</p>
      </AdminGate>
    );

  const status = uiStatus(market);
  const pool = ladder.reduce((a, r) => a + r.stake, 0n);
  const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);
  const marginUnit = (m: number) =>
    market.oracle === "Reflector" ? `${(m / 100).toFixed(2)}%` : `${m}`;
  const windowElapsed = proposal ? isPast(proposal.deadline) : false;

  const field =
    "min-h-11 rounded-md border border-line-strong bg-panel px-3 text-sm text-ink";

  return (
    <AdminGate>
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">
            Settle{" "}
            <Link href={`/markets/${id}`} className="underline underline-offset-2">
              market #{id}
            </Link>
          </h1>
          <StatusPill status={status} />
        </div>
        <div className="rounded-xl border border-line bg-panel/80 px-4 py-3 text-sm text-ink-secondary">
          {market.sideA} vs {market.sideB} · pool {formatUsdc(pool)} USDC · oracle{" "}
          {market.oracle}
          {market.oracle === "Reflector" && move && (
            <>
              {" "}
              · live:{" "}
              {move.winningSide === null
                ? "flat"
                : `${sideName(move.winningSide)} ${(move.units / 100).toFixed(2)}%`}
            </>
          )}
          <br />
          locks {new Date(market.closeTs * 1000).toLocaleString()} · settles{" "}
          {new Date(market.settleTs * 1000).toLocaleString()}
          {market.oracle === "Admin" && (
            <>
              {" "}
              · dispute window {Math.round(market.disputeSecs / 3600)}h · bond{" "}
              {(market.disputeBondBps / 100).toFixed(2)}% of pool (min 5 USDC)
            </>
          )}
        </div>

        {outcome && (
          <div className="rounded-xl border border-info/35 bg-info/8 px-4 py-3 text-sm">
            Settled: {sideName(outcome.winner)} by {marginUnit(outcome.margin)} · losing
            pool {formatUsdc(outcome.losingPool)} · fee {formatUsdc(outcome.rakeAmount)} USDC
          </div>
        )}

        {/* --- Open: Reflector trigger or Admin post-result --- */}
        {market.status === "Open" && market.oracle === "Reflector" && (
          <button
            disabled={busy !== null || status !== "Settling"}
            onClick={() => run("Oracle settlement", () => buildSettleOracleXdr(address!, BigInt(id)))}
            className="min-h-11 rounded-md bg-action font-semibold text-action-ink disabled:opacity-50"
            title={status !== "Settling" ? "Available once settle time passes" : ""}
          >
            {busy === "Oracle settlement" ? "Settling…" : "Trigger Reflector settlement"}
          </button>
        )}
        {market.status === "Open" && market.oracle === "Admin" && (
          <form
            className="flex flex-col gap-3 rounded-xl border border-line bg-panel/80 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              run("Post result", () =>
                buildProposeResultXdr(address!, BigInt(id), winner, Number(margin)),
              );
            }}
          >
            <p className="text-sm text-ink-muted">
              Post the result from the named official source (exact terms on the market
              page). This opens the dispute window — it does <b>not</b> settle. Claims
              stay frozen until you finalize after the window.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <select className={field} value={winner} onChange={(e) => setWinner(Number(e.target.value))}>
                <option value={0}>{market.sideA} won</option>
                <option value={1}>{market.sideB} won</option>
              </select>
              <input
                className={field}
                placeholder="Margin (units)"
                value={margin}
                onChange={(e) => setMargin(e.target.value.replace(/\D/g, ""))}
                required
              />
            </div>
            <button
              disabled={busy !== null || status !== "Settling"}
              className="min-h-11 rounded-md bg-action text-sm font-semibold text-action-ink disabled:opacity-50"
              title={status !== "Settling" ? "Available once settle time passes" : ""}
            >
              {busy === "Post result" ? "Posting…" : "Post result & open dispute window"}
            </button>
          </form>
        )}

        {/* --- Proposed: dispute window running --- */}
        {market.status === "Proposed" && proposal && (
          <div className="flex flex-col gap-4 rounded-xl border border-warning/40 bg-warning/8 p-4">
            <div className="text-sm">
              <div className="font-medium text-ink">
                Posted result: {sideName(proposal.winner)} by {marginUnit(proposal.margin)}
              </div>
              <div className="mt-1 text-ink-secondary">
                {windowElapsed ? (
                  "Dispute window elapsed — ready to finalize."
                ) : (
                  <>
                    Dispute window closes in <b><Countdown to={proposal.deadline} /></b> (
                    {new Date(proposal.deadline * 1000).toLocaleString()})
                  </>
                )}
              </div>
            </div>

            {dispute ? (
              <div className="rounded-lg border border-danger/40 bg-danger/8 p-3 text-sm">
                <div className="text-ink">
                  Open dispute · bond {formatUsdc(dispute.bond)} USDC
                </div>
                <div className="mt-0.5 break-all text-xs text-ink-muted">
                  by {dispute.disputer}
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  <button
                    disabled={busy !== null}
                    onClick={() =>
                      run("Uphold (dispute frivolous)", () =>
                        buildResolveDisputeXdr(address!, BigInt(id), true, proposal.winner, proposal.margin),
                      )
                    }
                    className="min-h-11 rounded-md bg-action text-sm font-semibold text-action-ink disabled:opacity-50"
                  >
                    {busy === "Uphold (dispute frivolous)"
                      ? "Resolving…"
                      : "Uphold result — bond to treasury, window continues"}
                  </button>
                  <div className="flex items-center gap-2">
                    <select className={`${field} flex-1`} value={winner} onChange={(e) => setWinner(Number(e.target.value))}>
                      <option value={0}>{market.sideA} won</option>
                      <option value={1}>{market.sideB} won</option>
                    </select>
                    <input
                      className={`${field} w-28`}
                      placeholder="Margin"
                      value={margin}
                      onChange={(e) => setMargin(e.target.value.replace(/\D/g, ""))}
                    />
                    <button
                      disabled={busy !== null || margin === ""}
                      onClick={() =>
                        run("Correct result", () =>
                          buildResolveDisputeXdr(address!, BigInt(id), false, winner, Number(margin)),
                        )
                      }
                      className="min-h-11 shrink-0 rounded-md border border-line-strong px-3 text-sm text-ink-secondary hover:border-ink-subtle disabled:opacity-50"
                    >
                      {busy === "Correct result" ? "…" : "Correct + refund bond"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                disabled={busy !== null || !windowElapsed}
                onClick={() => run("Finalize", () => buildFinalizeXdr(address!, BigInt(id)))}
                className="min-h-11 rounded-md bg-positive text-sm font-semibold text-action-ink disabled:opacity-50"
                title={!windowElapsed ? "Available once the dispute window elapses" : ""}
              >
                {busy === "Finalize" ? "Finalizing…" : "Finalize result & settle"}
              </button>
            )}
          </div>
        )}

        {/* Cancel — Open or Proposed (postponement / abandoned event) */}
        {(market.status === "Open" || market.status === "Proposed") && (
          <button
            disabled={busy !== null}
            onClick={() => run("Cancellation", () => buildCancelMarketXdr(address!, BigInt(id)))}
            className="min-h-11 rounded-md border border-danger/50 bg-danger/10 text-sm text-danger hover:border-danger disabled:opacity-50"
          >
            {busy === "Cancellation" ? "Cancelling…" : "Cancel market (full refunds, no fee)"}
          </button>
        )}

        {msg && (
          <p className={`text-sm ${msg.ok ? "text-positive" : "text-danger"}`}>
            {msg.text}
            {msg.hash && (
              <>
                {" · "}
                <a href={explorerTxUrl(msg.hash)} target="_blank" rel="noreferrer" className="underline">
                  transaction
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </AdminGate>
  );
}
