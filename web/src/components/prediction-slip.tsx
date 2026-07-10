"use client";

// The prediction slip (v4 + D2) — two instruments, one pool:
//  PREDICTION  dynamically-priced Neutral shares (price = the side money-share;
//              you enter SHARES, we quote $/share + cost). Tradable on the DEX.
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
import { dollarsForShares, sharePrice } from "@/lib/dpm";
import { demandMult, impliedRange } from "@/lib/parimutuel";
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
  // Neutral shares are dynamically priced (D2): the user enters SHARES; quote
  // the USDC cost + $/share from the side's money-share. Conviction mode keeps
  // a plain USDC stake.
  const sideMoneyUsd = (sd: number) =>
    Number(ladder.filter((r) => r.side === sd).reduce((a, r) => a + r.stake, 0n)) / 1e7;
  const dpmQuote = useMemo(() => {
    if (mode !== "prediction") return null;
    const shares = Number(stakeText) || 0;
    if (shares <= 0) return null;
    const mSide = sideMoneyUsd(selected.side);
    const mOther = sideMoneyUsd(1 - selected.side);
    const cost = dollarsForShares(mSide, mOther, shares);
    return { shares, cost, perShare: cost / shares, marketPrice: sharePrice(mSide, mOther) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, stakeText, ladder, selected.side]);

  const stake = useMemo(() => {
    if (mode === "prediction") {
      return dpmQuote ? BigInt(Math.round(dpmQuote.cost * 1e7)) : 0n;
    }
    try {
      return parseUsdc(stakeText || "0");
    } catch {
      return 0n;
    }
  }, [mode, dpmQuote, stakeText]);

  const range = useMemo(() => {
    if (stake <= 0n) return null;
    return impliedRange(ladder, selected.side, selected.rung, market.rungs, market.rakeBps, stake);
  }, [ladder, selected, market.rungs, market.rakeBps, stake]);
  const mult = demandMult(ladder, selected.side, selected.rung);
  const payoutAt = (roi: number) =>
    formatUsdc(stake + BigInt(Math.floor(Number(stake) * roi)));
  const rangePoint = range !== null && Math.abs(range.max - range.min) < 0.005;

  const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);
  const rungLabel = (rung: number) =>
    rung === 0
      ? "None (neutral)"
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
      const entryRoi = range?.max ?? 0; // conviction at-threshold quote (recorded for convictions only)
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
            <b>Neutral prediction</b> — mints tradable {sideName(selected.side)}{" "}
            shares at the live price (the side&apos;s money-share — the heavier the side, the
            dearer the share). Sell anytime before lock on the DEX; settlement pays
            whoever holds them.
          </>
        ) : (
          <>
            <b>Conviction</b> — locked at entry. No exit, no transfer, all-or-nothing:
            wins only if {sideName(selected.side)} wins by {rungLabel(selected.rung)}{" "}
            (exact hit wins).
          </>
        )}
      </p>

      {/* Amount: Shares (Neutral, dynamically priced) or USDC (conviction) */}
      <div className="mb-4">
        <label className="mb-1 block text-sm text-neutral-400">
          {mode === "prediction" ? "Shares" : "Stake (USDC)"}
        </label>
        <input
          value={stakeText}
          onChange={(e) => setStakeText(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          className="w-full rounded border border-neutral-700 bg-transparent px-3 py-2 tabular-nums"
        />
        {dpmQuote && (
          <div className="mt-1.5 flex justify-between text-xs text-neutral-500">
            <span>
              <span className="tabular-nums text-neutral-300">${dpmQuote.perShare.toFixed(3)}</span> /
              share
              <span className="text-neutral-600"> · market ${dpmQuote.marketPrice.toFixed(2)}</span>
            </span>
            <span className="tabular-nums">
              ≈ <span className="text-neutral-300">${dpmQuote.cost.toFixed(2)}</span> total
            </span>
          </div>
        )}
      </div>

      {/* Live quote */}
      <div className="mb-4 rounded border border-neutral-800 bg-neutral-900/50 px-3 py-2.5 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-400">Rarity multiplier (now)</span>
          <span className="tabular-nums">×{mult ? mult.toFixed(2) : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-400">If your side wins</span>
          <span className="font-medium text-emerald-400 tabular-nums">
            {range === null
              ? "—"
              : rangePoint
                ? `+${(range.max * 100).toFixed(1)}%`
                : `+${(range.min * 100).toFixed(0)}% to +${(range.max * 100).toFixed(0)}%`}
          </span>
        </div>
        <div className="flex justify-between text-neutral-500">
          <span>Potential payout</span>
          <span className="tabular-nums">
            {range === null
              ? "—"
              : rangePoint
                ? `${payoutAt(range.max)} USDC`
                : `${payoutAt(range.min)} – ${payoutAt(range.max)} USDC`}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-neutral-600">
          {rangePoint
            ? "Quote includes your stake; the pool reprices as money moves."
            : selected.rung === 0
              ? "The range is the honest bracket: you earn the high end when convictions on your side die (banked into the pool), the low end when they land and take their cut."
              : "The range spans the final margin: the high end if your side wins by just your margin, the low end if deeper convictions also land."}
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
              ? "Mint shares"
              : "Lock conviction"}
      </button>

      {phase.step === "done" && (
        <p className="mt-3 text-sm text-emerald-400">
          {phase.kind === "prediction" ? "Shares minted" : "Conviction locked"} —{" "}
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
