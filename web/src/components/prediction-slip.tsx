"use client";

// The trade slip (v4 + D2) — one panel, buy or sell:
//  BUY · Neutral      dynamically-priced shares (enter SHARES, quote $/share).
//  BUY · Conviction   winner + minimum margin, locked, all-or-nothing (slider).
//  SELL               sell held Neutral shares into the best DEX bid; the
//                     dominance slider is disabled (only Neutral shares trade).
// Quotes include the user's own stake (self-pricing). Buy chains trustline
// setup -> sign -> submit; sell posts a crossing classic offer on the DEX.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Asset, BASE_FEE, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
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
import { CONFIG, parseUsdc } from "@/lib/config";
import { dollarsForShares, sharePrice } from "@/lib/dpm";
import { demandMult, impliedRange } from "@/lib/parimutuel";
import { recordPositionMeta } from "@/lib/positions-meta";
import { useWallet } from "@/lib/wallet-context";
import { HonestyTip } from "./honesty-tip";

const server = new rpc.Server(CONFIG.rpcUrl);

type Phase =
  | { step: "idle" }
  | { step: "busy"; what: string }
  | { step: "done"; txHash: string; kind: "prediction" | "conviction" | "sell" }
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
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [stakeText, setStakeText] = useState("10");
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [book, setBook] = useState<{ bid: string | null; ask: string | null }>({
    bid: null,
    ask: null,
  });

  const selling = tab === "sell";
  // Sell is Neutral-only; ignore any conviction rung while selling.
  const mode: "prediction" | "conviction" =
    !selling && selected.rung >= 1 ? "conviction" : "prediction";
  const rungSteps = useMemo(() => [0, ...market.rungs], [market.rungs]);
  const rungIndex = Math.max(0, rungSteps.indexOf(selected.rung));
  const code = ticketAssetCode(market.id, selected.side);

  // --- Sell: DEX order book (best bid we'd sell into) ---
  const loadBook = useCallback(async () => {
    try {
      const url =
        `${CONFIG.horizonUrl}/order_book?selling_asset_type=credit_alphanum12` +
        `&selling_asset_code=${code}&selling_asset_issuer=${CONFIG.ticketIssuer}` +
        `&buying_asset_type=credit_alphanum4&buying_asset_code=USDC` +
        `&buying_asset_issuer=${CONFIG.usdcIssuer}&limit=1`;
      const data = (await (await fetch(url)).json()) as {
        bids?: { price: string }[];
        asks?: { price: string }[];
      };
      setBook({ bid: data.bids?.[0]?.price ?? null, ask: data.asks?.[0]?.price ?? null });
    } catch {
      setBook({ bid: null, ask: null });
    }
  }, [code]);
  useEffect(() => {
    if (!selling) return;
    loadBook();
    const t = setInterval(loadBook, 15_000);
    return () => clearInterval(t);
  }, [selling, loadBook]);

  // --- Buy: Neutral shares dynamically priced (D2); conviction = USDC stake ---
  const sideMoneyUsd = (sd: number) =>
    Number(ladder.filter((r) => r.side === sd).reduce((a, r) => a + r.stake, 0n)) / 1e7;
  const dpmQuote = useMemo(() => {
    if (selling || mode !== "prediction") return null;
    const shares = Number(stakeText) || 0;
    if (shares <= 0) return null;
    const mSide = sideMoneyUsd(selected.side);
    const mOther = sideMoneyUsd(1 - selected.side);
    const cost = dollarsForShares(mSide, mOther, shares);
    return { shares, cost, perShare: cost / shares, marketPrice: sharePrice(mSide, mOther) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selling, mode, stakeText, ladder, selected.side]);

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
    if (selling || stake <= 0n) return null;
    return impliedRange(ladder, selected.side, selected.rung, market.rungs, market.rakeBps, stake);
  }, [selling, ladder, selected, market.rungs, market.rakeBps, stake]);
  const mult = demandMult(ladder, selected.side, selected.rung);
  const rangePoint = range !== null && Math.abs(range.max - range.min) < 0.005;

  const bidN = book.bid ? Number(book.bid) : null;
  const sellShares = Number(stakeText) || 0;
  const sellProceeds = bidN ? sellShares * bidN : null;

  const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);
  const rungLabel = (rung: number) =>
    rung === 0
      ? "None (neutral)"
      : market.oracle === "Reflector"
        ? `≥ ${(rung / 100).toFixed(2)}%`
        : `≥ ${rung}`;

  const busy = phase.step === "busy";
  const canSubmit =
    address === null ||
    (selling ? sellShares > 0 && bidN !== null : stake > 0n);

  function pickTab(next: "buy" | "sell") {
    setTab(next);
    setPhase({ step: "idle" });
    if (next === "sell" && selected.rung !== 0) onSelect(selected.side, 0); // Neutral only
  }

  async function submit() {
    if (!address) {
      await connect();
      return;
    }
    if (selling) return sell();
    if (stake <= 0n) return;
    try {
      setPhase({ step: "busy", what: "Checking trustlines…" });
      const trusts = [await buildTrustlineXdr(address)];
      if (mode === "prediction") {
        trusts.push(
          await buildAssetTrustlineXdr(address, code, CONFIG.ticketIssuer),
        );
      }
      for (const t of trusts) {
        if (t) await submitAndWait(await signTransaction(t));
      }
      setPhase({ step: "busy", what: "Sign in Freighter…" });
      const entryRoi = range?.max ?? 0;
      const xdr =
        mode === "prediction"
          ? await buildMintTicketsXdr(address, BigInt(market.id), selected.side, stake)
          : await buildConvictionXdr(address, BigInt(market.id), selected.side, selected.rung, stake);
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

  // Market sell: a crossing classic offer fills against the best bid.
  async function sell() {
    if (!address || !bidN || sellShares <= 0) return;
    try {
      setPhase({ step: "busy", what: "Sign in Freighter…" });
      const [n, d] = toFraction(bidN);
      const share = new Asset(code, CONFIG.ticketIssuer);
      const usdc = new Asset("USDC", CONFIG.usdcIssuer);
      const account = await server.getAccount(address);
      const op = Operation.manageSellOffer({
        selling: share,
        buying: usdc,
        amount: sellShares.toFixed(7),
        price: { n, d },
      });
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: CONFIG.networkPassphrase,
      })
        .addOperation(op)
        .setTimeout(120)
        .build();
      const signed = await signTransaction(tx.toXDR());
      setPhase({ step: "busy", what: "Submitting…" });
      const txHash = await submitAndWait(signed);
      setPhase({ step: "done", txHash, kind: "sell" });
      loadBook();
      onPlaced();
    } catch (e) {
      setPhase({ step: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Trade</h2>
        <HonestyTip />
      </div>

      {/* Buy / Sell flipper */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(["buy", "sell"] as const).map((t) => (
          <button
            key={t}
            onClick={() => pickTab(t)}
            className={`rounded border px-3 py-1.5 text-sm font-medium capitalize ${
              tab === t
                ? "border-neutral-200 bg-neutral-100 text-neutral-900"
                : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Side toggle */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        {[0, 1].map((side) => (
          <button
            key={side}
            onClick={() => onSelect(side, selling ? 0 : selected.rung)}
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

      {/* Dominance margin slider — disabled when selling (Neutral only) */}
      <div className={`mb-2 ${selling ? "opacity-40" : ""}`}>
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-neutral-400">Dominance margin</span>
          <span className="font-medium">{selling ? "None (neutral)" : rungLabel(selected.rung)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={rungSteps.length - 1}
          step={1}
          value={selling ? 0 : rungIndex}
          disabled={selling}
          onChange={(e) => onSelect(selected.side, rungSteps[Number(e.target.value)])}
          className="w-full accent-neutral-200 disabled:cursor-not-allowed"
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
          selling
            ? "border-sky-900 bg-sky-950/30 text-sky-200"
            : mode === "prediction"
              ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
              : "border-amber-900 bg-amber-950/30 text-amber-200"
        }`}
      >
        {selling ? (
          <>
            <b>Sell shares</b> — sell your held {sideName(selected.side)} shares into the
            best DEX bid. The claim moves to the buyer; the pot stays escrowed. (Convictions
            are locked and can&apos;t be sold.)
          </>
        ) : mode === "prediction" ? (
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

      {/* Amount */}
      <div className="mb-4">
        <label className="mb-1 block text-sm text-neutral-400">
          {selling || mode === "prediction" ? "Shares" : "Stake (USDC)"}
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

      {/* Quote box — one line: price/multiplier + return; detail in the tooltip */}
      {selling ? (
        <div className="mb-4 flex items-center justify-between rounded border border-neutral-800 bg-neutral-900/50 px-3 py-2.5 text-sm">
          <span className="tabular-nums text-neutral-300">
            {book.bid ? `$${Number(book.bid).toFixed(3)} / sh` : "no bid"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-emerald-400 tabular-nums">
              {sellProceeds !== null ? `≈ $${sellProceeds.toFixed(2)}` : "—"}
            </span>
            <InfoDot text={`Fills at market against the best bid on Stellar's DEX (${code}). Any unfilled remainder rests as an offer.`} />
          </span>
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between rounded border border-neutral-800 bg-neutral-900/50 px-3 py-2.5 text-sm">
          <span className="tabular-nums text-neutral-300">×{mult ? mult.toFixed(2) : "—"}</span>
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-emerald-400 tabular-nums">
              {range === null
                ? "—"
                : rangePoint
                  ? `+${(range.max * 100).toFixed(1)}%`
                  : `+${(range.min * 100).toFixed(0)}% to +${(range.max * 100).toFixed(0)}%`}
            </span>
            <InfoDot
              text={
                rangePoint
                  ? "Quote includes your stake; the pool reprices as money moves."
                  : selected.rung === 0
                    ? "The range is the honest bracket: you earn the high end when convictions on your side die (banked into the pool), the low end when they land and take their cut."
                    : "The range spans the final margin: the high end if your side wins by just your margin, the low end if deeper convictions also land."
              }
            />
          </span>
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !canSubmit}
        className="w-full rounded bg-neutral-100 py-2.5 font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
      >
        {!address
          ? "Connect wallet to trade"
          : busy
            ? phase.what
            : selling
              ? bidN === null
                ? "No bids to sell into"
                : "Trade"
              : mode === "conviction"
                ? "Lock conviction"
                : "Trade"}
      </button>

      {phase.step === "done" && (
        <p className="mt-3 text-sm text-emerald-400">
          {phase.kind === "prediction"
            ? "Shares minted"
            : phase.kind === "conviction"
              ? "Conviction locked"
              : "Sold at market"}{" "}
          —{" "}
          <a href={explorerTxUrl(phase.txHash)} target="_blank" rel="noreferrer" className="underline">
            view transaction
          </a>{" "}
          ·{" "}
          <Link href="/portfolio" className="underline">
            portfolio
          </Link>
        </p>
      )}
      {phase.step === "error" && <p className="mt-3 text-sm text-red-400">{phase.message}</p>}
    </div>
  );
}

/** Tiny hover-tooltip dot — carries the honest-bracket / fill detail. */
function InfoDot({ text }: { text: string }) {
  return (
    <span title={text} className="cursor-help select-none text-xs text-neutral-600">
      ⓘ
    </span>
  );
}

/** Decimal price -> integer fraction for classic offers. */
function toFraction(x: number): [number, number] {
  const d = 10_000_000;
  const n = Math.round(x * d);
  const g = gcd(n, d);
  return [n / g, d / g];
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
