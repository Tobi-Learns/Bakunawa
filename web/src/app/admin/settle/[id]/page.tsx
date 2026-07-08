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
        <p className="text-sm text-neutral-500">Reading market #{id} from chain…</p>
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
        <div className="rounded border border-neutral-800 px-4 py-3 text-sm text-neutral-300">
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
          <div className="rounded border border-sky-900 bg-sky-950/40 px-4 py-3 text-sm">
            Settled: {sideName(outcome.winner)} by {outcome.margin} · losing pool{" "}
            {formatUsdc(outcome.losingPool)} · rake {formatUsdc(outcome.rakeAmount)} USDC
          </div>
        )}

        {market.status === "Open" && (
          <>
            {market.oracle === "Reflector" ? (
              <button
                disabled={busy !== null || status !== "Settling"}
                onClick={() => run("Oracle settlement", () => buildSettleOracleXdr(address!, BigInt(id)))}
                className="rounded bg-neutral-100 py-2.5 font-medium text-neutral-900 disabled:opacity-50"
                title={status !== "Settling" ? "Available once settle time passes" : ""}
              >
                {busy === "Oracle settlement" ? "Settling…" : "Trigger Reflector settlement"}
              </button>
            ) : (
              <form
                className="flex flex-col gap-3 rounded border border-neutral-800 p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  run("Admin settlement", () =>
                    buildSettleAdminXdr(address!, BigInt(id), winner, Number(margin)),
                  );
                }}
              >
                <p className="text-sm text-neutral-400">
                  Post the result from the named official source (exact terms on the
                  market page):
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    className="rounded border border-neutral-700 bg-transparent px-3 py-2 text-sm"
                    value={winner}
                    onChange={(e) => setWinner(Number(e.target.value))}
                  >
                    <option value={0}>{market.sideA} won</option>
                    <option value={1}>{market.sideB} won</option>
                  </select>
                  <input
                    className="rounded border border-neutral-700 bg-transparent px-3 py-2 text-sm"
                    placeholder="Margin (units)"
                    value={margin}
                    onChange={(e) => setMargin(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                </div>
                <button
                  disabled={busy !== null || status !== "Settling"}
                  className="rounded bg-neutral-100 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
                >
                  {busy === "Admin settlement" ? "Settling…" : "Post result & settle"}
                </button>
              </form>
            )}
            <button
              disabled={busy !== null}
              onClick={() => run("Cancellation", () => buildCancelMarketXdr(address!, BigInt(id)))}
              className="rounded border border-red-900 py-2 text-sm text-red-300 hover:border-red-700 disabled:opacity-50"
            >
              {busy === "Cancellation" ? "Cancelling…" : "Cancel market (full refunds, no rake)"}
            </button>
          </>
        )}

        {msg && (
          <p className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
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
