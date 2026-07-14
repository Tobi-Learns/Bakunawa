"use client";

// List an event (1.7a): defines the on-chain market (wallet-signed
// create_market with a Snowflake id) + curator metadata (DB). Stats-mode
// curves are display metadata only (S7) and attach on /admin/curves.

import Link from "next/link";
import { useState } from "react";
import { AdminGate } from "@/components/admin-gate";
import { buildCreateMarketXdr, patchMarketMeta } from "@/lib/admin";
import { explorerTxUrl, submitAndWait } from "@/lib/bakunawa";
import { parseUsdc } from "@/lib/config";
import { snowflakeU64 } from "@/lib/ids";
import { useWallet } from "@/lib/wallet-context";

const label = "mb-1 block text-sm text-ink-muted";
const input = "min-h-11 w-full rounded-md border border-line-strong bg-panel px-3 text-sm text-ink";

export default function NewEventPage() {
  const { address, signTransaction } = useWallet();
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "crypto",
    oracle: "Reflector" as "Reflector" | "Admin",
    asset: "BTC",
    sideA: "UP",
    sideB: "DOWN",
    rungs: "100, 300, 500, 1000",
    close: "",
    settle: "",
    rakeBps: 300,
    minPool: "0",
    ticketA: "",
    ticketB: "",
  });
  const [state, setState] = useState<
    | { step: "idle" }
    | { step: "busy"; what: string }
    | { step: "done"; id: string; txHash: string }
    | { step: "error"; message: string }
  >({ step: "idle" });

  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!address) return;
    try {
      const rungs = form.rungs
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
      const closeTs = Math.floor(new Date(form.close).getTime() / 1000);
      const settleTs = Math.floor(new Date(form.settle).getTime() / 1000);
      if (!Number.isFinite(closeTs) || !Number.isFinite(settleTs))
        throw new Error("close/settle datetimes required");
      if (closeTs > settleTs) throw new Error("close must be at or before settle");
      if (!form.ticketA.trim() || !form.ticketB.trim())
        throw new Error(
          "share SAC addresses required — run scripts/list-market.mjs steps 1-3 " +
            "(assets + pre-mint) first, or use the script for the whole listing",
        );
      const id = snowflakeU64();

      setState({ step: "busy", what: "Building transaction…" });
      const xdr = await buildCreateMarketXdr(address, {
        id,
        sideA: form.sideA.trim(),
        sideB: form.sideB.trim(),
        rungs,
        closeTs,
        settleTs,
        oracle: form.oracle,
        asset: form.asset.trim(),
        rakeBps: Number(form.rakeBps),
        minPool: parseUsdc(form.minPool || "0"),
        ticketA: form.ticketA.trim(),
        ticketB: form.ticketB.trim(),
      });
      setState({ step: "busy", what: "Sign in Freighter…" });
      const signed = await signTransaction(xdr);
      setState({ step: "busy", what: "Submitting…" });
      const txHash = await submitAndWait(signed);
      setState({ step: "busy", what: "Saving metadata…" });
      await patchMarketMeta(id, {
        title: form.title,
        description: form.description,
        category: form.category,
      });
      setState({ step: "done", id: id.toString(), txHash });
    } catch (e) {
      setState({ step: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <AdminGate>
      <div className="mx-auto max-w-xl">
        <h1 className="mb-1 text-2xl font-semibold">List an event</h1>
        <p className="mb-6 text-sm leading-relaxed text-ink-muted">
          Settlement terms are printed from these fields on the market page. Crypto
          markets snapshot their baseline from Reflector at listing and settle
          trustlessly; Admin-oracle markets are settled by you from the named official
          source.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className={label}>Title (public)</label>
            <input
              className={input}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="BTC up or down this week"
              required
            />
          </div>
          <div>
            <label className={label}>Description / settlement terms</label>
            <textarea
              className={input}
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Named source, measurement window, cancellation deadline…"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>Category</label>
              <select
                className={input}
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
              >
                <option value="crypto">crypto</option>
                <option value="nba">nba</option>
                <option value="other">other</option>
              </select>
            </div>
            <div>
              <label className={label}>Oracle</label>
              <select
                className={input}
                value={form.oracle}
                onChange={(e) => set("oracle", e.target.value)}
              >
                <option value="Reflector">Reflector (crypto)</option>
                <option value="Admin">Admin (curated)</option>
              </select>
            </div>
            <div>
              <label className={label}>Asset (Reflector)</label>
              <input
                className={input}
                value={form.asset}
                onChange={(e) => set("asset", e.target.value)}
                disabled={form.oracle !== "Reflector"}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Side A</label>
              <input className={input} value={form.sideA} onChange={(e) => set("sideA", e.target.value)} maxLength={9} required />
            </div>
            <div>
              <label className={label}>Side B</label>
              <input className={input} value={form.sideB} onChange={(e) => set("sideB", e.target.value)} maxLength={9} required />
            </div>
          </div>
          <div>
            <label className={label}>
              Margin rungs (ascending; crypto in hundredths of a %, sports in points)
            </label>
            <input className={input} value={form.rungs} onChange={(e) => set("rungs", e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Predictions lock (local time)</label>
              <input type="datetime-local" className={input} value={form.close} onChange={(e) => set("close", e.target.value)} required />
            </div>
            <div>
              <label className={label}>Settles (local time)</label>
              <input type="datetime-local" className={input} value={form.settle} onChange={(e) => set("settle", e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Share SAC — side A</label>
              <input className={input} value={form.ticketA} onChange={(e) => set("ticketA", e.target.value)} placeholder="C… (from list-market.mjs)" required />
            </div>
            <div>
              <label className={label}>Share SAC — side B</label>
              <input className={input} value={form.ticketB} onChange={(e) => set("ticketB", e.target.value)} placeholder="C…" required />
            </div>
          </div>
          <p className="text-xs text-ink-muted">
            v4: share assets must exist and be pre-minted into the contract before
            listing — <code>node scripts/list-market.mjs</code> does the full sequence
            in one command (recommended); this form is the manual path.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Protocol fee (bps)</label>
              <input type="number" className={input} value={form.rakeBps} onChange={(e) => set("rakeBps", Number(e.target.value))} min={0} max={10000} />
            </div>
            <div>
              <label className={label}>Min pool (USDC, viability)</label>
              <input className={input} value={form.minPool} onChange={(e) => set("minPool", e.target.value)} />
            </div>
          </div>
          <button
            disabled={state.step === "busy"}
            className="min-h-11 rounded-md bg-action font-semibold text-action-ink hover:bg-action-hover disabled:opacity-50"
          >
            {state.step === "busy" ? state.what : "Create market (sign in Freighter)"}
          </button>
        </form>
        {state.step === "done" && (
          <p className="mt-4 text-sm text-positive">
            Listed market #{state.id} —{" "}
            <a href={explorerTxUrl(state.txHash)} target="_blank" rel="noreferrer" className="underline">
              transaction
            </a>{" "}
            ·{" "}
            <Link href={`/markets/${state.id}`} className="underline">
              view market
            </Link>{" "}
            ·{" "}
            <Link href="/admin/curves" className="underline">
              attach curve
            </Link>
          </p>
        )}
        {state.step === "error" && (
          <p className="mt-4 text-sm text-danger">{state.message}</p>
        )}
      </div>
    </AdminGate>
  );
}
