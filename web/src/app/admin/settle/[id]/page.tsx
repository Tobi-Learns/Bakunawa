"use client";

// Settlement view (1.7d): trigger Reflector settlement (permissionless),
// post an Admin-oracle result, or cancel (postponement/abandon). Every action
// is wallet-signed; the cache re-syncs after each.

import Link from "next/link";
import { use, useState } from "react";
import { AdminGate } from "@/components/admin-gate";
import { Countdown } from "@/components/countdown";
import { StatusPill } from "@/components/status-pill";
import {
  buildCancelMarketXdr,
  buildSettleAdminXdr,
  buildSettleOracleXdr,
  syncMarketNow,
} from "@/lib/admin";
import { explorerTxUrl, submitAndWait } from "@/lib/bakunawa";
import { formatUsdc } from "@/lib/config";
import { uiStatus } from "@/lib/market-status";
import { useMarket } from "@/lib/use-market";
import { useWallet } from "@/lib/wallet-context";

export default function AdminSettlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { market, ladder, outcome, move } = useMarket(id);
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
              · live: {move.winningSide === null ? "flat" : `${sideName(move.winningSide)} ${(move.units / 100).toFixed(2)}%`}
            </>
          )}
          <br />
          locks {new Date(market.closeTs * 1000).toLocaleString()} · settles{" "}
          {new Date(market.settleTs * 1000).toLocaleString()}
          {status === "Locked" && (
            <>
              {" "}
              (in <Countdown to={market.settleTs} />)
            </>
          )}
        </div>

        {outcome && (
          <div className="rounded-xl border border-info/35 bg-info/8 px-4 py-3 text-sm">
            Settled: {sideName(outcome.winner)} by {outcome.margin} · losing pool{" "}
            {formatUsdc(outcome.losingPool)} · fee {formatUsdc(outcome.rakeAmount)} USDC
          </div>
        )}

        {market.status === "Open" && (
          <>
            {market.oracle === "Reflector" ? (
              <button
                disabled={busy !== null || status !== "Settling"}
                onClick={() => run("Oracle settlement", () => buildSettleOracleXdr(address!, BigInt(id)))}
                className="min-h-11 rounded-md bg-action font-semibold text-action-ink disabled:opacity-50"
                title={status !== "Settling" ? "Available once settle time passes" : ""}
              >
                {busy === "Oracle settlement" ? "Settling…" : "Trigger Reflector settlement"}
              </button>
            ) : (
              <form
                className="flex flex-col gap-3 rounded-xl border border-line bg-panel/80 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  run("Admin settlement", () =>
                    buildSettleAdminXdr(address!, BigInt(id), winner, Number(margin)),
                  );
                }}
              >
                <p className="text-sm text-ink-muted">
                  Post the result from the named official source (exact terms on the
                  market page):
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    className="min-h-11 rounded-md border border-line-strong bg-panel px-3 text-sm text-ink"
                    value={winner}
                    onChange={(e) => setWinner(Number(e.target.value))}
                  >
                    <option value={0}>{market.sideA} won</option>
                    <option value={1}>{market.sideB} won</option>
                  </select>
                  <input
                    className="min-h-11 rounded-md border border-line-strong bg-panel px-3 text-sm text-ink"
                    placeholder="Margin (units)"
                    value={margin}
                    onChange={(e) => setMargin(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                </div>
                <button
                  disabled={busy !== null || status !== "Settling"}
                  className="min-h-11 rounded-md bg-action text-sm font-semibold text-action-ink disabled:opacity-50"
                >
                  {busy === "Admin settlement" ? "Settling…" : "Post result & settle"}
                </button>
              </form>
            )}
            <button
              disabled={busy !== null}
              onClick={() => run("Cancellation", () => buildCancelMarketXdr(address!, BigInt(id)))}
              className="min-h-11 rounded-md border border-danger/50 bg-danger/10 text-sm text-danger hover:border-danger disabled:opacity-50"
            >
              {busy === "Cancellation" ? "Cancelling…" : "Cancel market (full refunds, no fee)"}
            </button>
          </>
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
