"use client";

// The bet slip (1.5a) — lives on the market page, only while betting is open.
// Signature interaction: slide the margin rung and watch the multiplier +
// implied payout reprice live (your own stake is included in the quote, so
// piling on a rung honestly prices it down). Submit chains trustline setup
// (first bet from a fresh wallet) -> place_bet, both signed in Freighter.

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  buildPlaceBetXdr,
  buildTrustlineXdr,
  explorerTxUrl,
  submitAndWait,
  type LadderRowView,
  type MarketView,
} from "@/lib/bakunawa";
import { formatUsdc, parseUsdc } from "@/lib/config";
import { demandMult, impliedRoi } from "@/lib/parimutuel";
import { recordPositionMeta } from "@/lib/positions-meta";
import { useWallet } from "@/lib/wallet-context";
import { HonestyTip } from "./honesty-tip";

type Phase =
  | { step: "idle" }
  | { step: "trustline" }
  | { step: "signing" }
  | { step: "submitting" }
  | { step: "done"; txHash: string }
  | { step: "error"; message: string };

export function BetSlip({
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
      ? "Winner only"
      : market.oracle === "Reflector"
        ? `≥ ${(rung / 100).toFixed(2)}%`
        : `≥ ${rung}`;

  const busy = ["trustline", "signing", "submitting"].includes(phase.step);

  async function placeBet() {
    if (!address) {
      await connect();
      return;
    }
    if (stake <= 0n) return;
    try {
      setPhase({ step: "trustline" });
      const trustXdr = await buildTrustlineXdr(address);
      if (trustXdr) {
        const signed = await signTransaction(trustXdr);
        await submitAndWait(signed);
      }
      setPhase({ step: "signing" });
      const entryRoi = quote ?? 0;
      const xdr = await buildPlaceBetXdr(
        address,
        BigInt(market.id),
        selected.side,
        selected.rung,
        stake,
      );
      const signed = await signTransaction(xdr);
      setPhase({ step: "submitting" });
      const txHash = await submitAndWait(signed);
      recordPositionMeta({
        marketId: Number(market.id),
        side: selected.side,
        rung: selected.rung,
        stake: stake.toString(),
        entryRoi,
        txHash,
        at: Date.now(),
      });
      setPhase({ step: "done", txHash });
      onPlaced();
    } catch (e) {
      setPhase({
        step: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Place a prediction</h2>
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

      {/* Margin rung slider — the signature interaction */}
      <div className="mb-4">
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
            <span key={r}>{r === 0 ? "win" : rungLabel(r).replace("≥ ", "")}</span>
          ))}
        </div>
      </div>

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
          Wins only if {sideName(selected.side)}{" "}
          {selected.rung === 0 ? "wins" : `wins by ${rungLabel(selected.rung)}`} — exact
          hit wins. Quote includes your stake; the pool reprices as money moves.
        </p>
      </div>

      {/* Submit */}
      <button
        onClick={placeBet}
        disabled={busy || (address !== null && stake <= 0n)}
        className="w-full rounded bg-neutral-100 py-2.5 font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
      >
        {!address
          ? "Connect wallet to bet"
          : phase.step === "trustline"
            ? "Checking trustline…"
            : phase.step === "signing"
              ? "Sign in Freighter…"
              : phase.step === "submitting"
                ? "Submitting…"
                : "Place prediction"}
      </button>

      {phase.step === "done" && (
        <p className="mt-3 text-sm text-emerald-400">
          Prediction placed —{" "}
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
