"use client";

// The prediction slip (v4) — two instruments, one pot:
//  PREDICTION  par-mints tradable side tickets (exit anytime on the DEX;
//              trades move the claim, never the cash).
//  CONVICTION  winner + minimum margin, locked at entry, all-or-nothing;
//              the rung slider repricing live is the signature interaction.
// Quotes include the user's own stake (self-pricing). Submits chain
// trustline setup (USDC + the ticket asset for predictions) -> sign -> submit.

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  buildAssetTrustlineXdr,
  buildConvictionXdr,
  buildMintTicketsXdr,
  buildTrustlineXdr,
  explorerTxUrl,
  submitAndWait,
  ticketAssetCode,
  type LadderRowView,
  type MarketView,
} from "@/lib/bakunawa";
import { CONFIG, formatUsdc, parseUsdc } from "@/lib/config";
import { demandMult, impliedRoi } from "@/lib/parimutuel";
import { recordPositionMeta } from "@/lib/positions-meta";
import { useWallet } from "@/lib/wallet-context";
import { HonestyTip } from "./honesty-tip";

type Phase =
  | { step: "idle" }
  | { step: "busy"; what: string }
  | { step: "done"; txHash: string; kind: "prediction" | "conviction" }
  | { step: "error"; message: string };

export function PredictionSlip({
  market,
  ladder,
  selected,
  onSelect,
  onPlaced,
}: {
  market: MarketView;
  ladder: LadderRowView[];
  selected: { side: number; rung: number };
  onSelect: (side: number, rung: number) => void;
  onPlaced: () => void;
}) {
  const { address, connect, signTransaction } = useWallet();
  const [stakeText, setStakeText] = useState("10");
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  // selected.rung 0 = regular prediction; >=1 = conviction on that rung
  const mode: "prediction" | "conviction" = selected.rung === 0 ? "prediction" : "conviction";
  const rungSteps = useMemo(() => [0, ...market.rungs], [market.rungs]);
  const rungIndex = Math.max(0, rungSteps.indexOf(selected.rung));
  const stake = useMemo(() => {
    try {
      return parseUsdc(stakeText || "0");
    } catch {
      return 0n;
    }
  }, [stakeText]);

  const quote = useMemo(() => {
    if (stake <= 0n) return null;
    return impliedRoi(ladder, selected.side, selected.rung, market.rakeBps, stake);
  }, [ladder, selected, market.rakeBps, stake]);
  const mult = demandMult(ladder, selected.side, selected.rung);

  const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);
  const rungLabel = (rung: number) =>
    rung === 0
      ? "None (regular)"
      : market.oracle === "Reflector"
        ? `≥ ${(rung / 100).toFixed(2)}%`
        : `≥ ${rung}`;

  const busy = phase.step === "busy";

  async function submit() {
    if (!address) {
      await connect();
      return;
    }
    if (stake <= 0n) return;
    try {
      setPhase({ step: "busy", what: "Checking trustlines…" });
      const trusts = [await buildTrustlineXdr(address)];
      if (mode === "prediction") {
        trusts.push(
          await buildAssetTrustlineXdr(
            address,
            ticketAssetCode(market.id, selected.side),
            CONFIG.ticketIssuer,
          ),
        );
      }
      for (const t of trusts) {
        if (t) {
          const signed = await signTransaction(t);
          await submitAndWait(signed);
        }
      }
      setPhase({ step: "busy", what: "Sign in Freighter…" });
      const entryRoi = quote ?? 0;
      const xdr =
        mode === "prediction"
          ? await buildMintTicketsXdr(address, BigInt(market.id), selected.side, stake)
          : await buildConvictionXdr(
              address,
              BigInt(market.id),
              selected.side,
              selected.rung,
              stake,
            );
      const signed = await signTransaction(xdr);
      setPhase({ step: "busy", what: "Submitting…" });
      const txHash = await submitAndWait(signed);
      if (mode === "conviction") {
        recordPositionMeta({
          marketId: Number(market.id),
          side: selected.side,
          rung: selected.rung,
          stake: stake.toString(),
          entryRoi,
          txHash,
          at: Date.now(),
        });
      }
      setPhase({ step: "done", txHash, kind: mode });
      onPlaced();
    } catch (e) {
      setPhase({ step: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Prediction slip</h2>
        <HonestyTip />
      </div>

      {/* Side toggle */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        {[0, 1].map((side) => (
          <button
            key={side}
            onClick={() => onSelect(side, selected.rung)}
            className={`rounded border px-3 py-2 text-sm font-medium ${
              selected.side === side
                ? "border-neutral-200 bg-neutral-100 text-neutral-900"
                : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
            }`}
          >
            {sideName(side)}
          </button>
        ))}
      </div>

      {/* Margin rung slider — 0 = regular, right = deeper conviction */}
      <div className="mb-2">
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-neutral-400">Dominance margin</span>
          <span className="font-medium">{rungLabel(selected.rung)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={rungSteps.length - 1}
          step={1}
          value={rungIndex}
          onChange={(e) => onSelect(selected.side, rungSteps[Number(e.target.value)])}
          className="w-full accent-neutral-200"
        />
        <div className="mt-1 flex justify-between text-[10px] text-neutral-600">
          {rungSteps.map((r) => (
            <span key={r}>{r === 0 ? "none" : rungLabel(r).replace("≥ ", "")}</span>
          ))}
        </div>
      </div>

      {/* Instrument explainer */}
      <p
        className={`mb-4 rounded border px-3 py-2 text-xs ${
          mode === "prediction"
            ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
            : "border-amber-900 bg-amber-950/30 text-amber-200"
        }`}
      >
        {mode === "prediction" ? (
          <>
            <b>Regular prediction</b> — mints tradable {sideName(selected.side)} tickets
            at par. Sell anytime before lock on the DEX; settlement pays whoever holds
            them.
          </>
        ) : (
          <>
            <b>Conviction</b> — locked at entry. No exit, no transfer, all-or-nothing:
            wins only if {sideName(selected.side)} wins by {rungLabel(selected.rung)}{" "}
            (exact hit wins).
          </>
        )}
      </p>

      {/* Stake */}
      <div className="mb-4">
        <label className="mb-1 block text-sm text-neutral-400">Stake (USDC)</label>
        <input
          value={stakeText}
          onChange={(e) => setStakeText(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          className="w-full rounded border border-neutral-700 bg-transparent px-3 py-2 tabular-nums"
        />
      </div>

      {/* Live quote */}
      <div className="mb-4 rounded border border-neutral-800 bg-neutral-900/50 px-3 py-2.5 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-400">Rarity multiplier (now)</span>
          <span className="tabular-nums">×{mult ? mult.toFixed(2) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-400">If settled now</span>
          <span className="font-medium text-emerald-400 tabular-nums">
            {quote === null ? "—" : `+${(quote * 100).toFixed(1)}%`}
          </span>
        </div>
        <div className="flex justify-between text-neutral-500">
          <span>Potential payout</span>
          <span className="tabular-nums">
            {quote === null
              ? "—"
              : `${formatUsdc(stake + BigInt(Math.floor(Number(stake) * quote)))} USDC`}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-neutral-600">
          Quote includes your stake; the pool reprices as money moves.
        </p>
      </div>

      <button
        onClick={submit}
        disabled={busy || (address !== null && stake <= 0n)}
        className="w-full rounded bg-neutral-100 py-2.5 font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
      >
        {!address
          ? "Connect wallet to predict"
          : busy
            ? phase.what
            : mode === "prediction"
              ? "Mint tickets"
              : "Lock conviction"}
      </button>

      {phase.step === "done" && (
        <p className="mt-3 text-sm text-emerald-400">
          {phase.kind === "prediction" ? "Tickets minted" : "Conviction locked"} —{" "}
          <a
            href={explorerTxUrl(phase.txHash)}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            view transaction
          </a>{" "}
          ·{" "}
          <Link href="/portfolio" className="underline">
            portfolio
          </Link>
        </p>
      )}
      {phase.step === "error" && (
        <p className="mt-3 text-sm text-red-400">{phase.message}</p>
      )}
    </div>
  );
}
