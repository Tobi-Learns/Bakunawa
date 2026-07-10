"use client";

// The trade panel (v4 + D2) — Polymarket-style: Buy/Sell tabs, per-side price
// buttons, a big $ amount with quick-adds, and a "To win" line. Our one extra
// is the dominance-margin slider (rung 0 = tradable Neutral shares, >=1 = a
// locked conviction). Amount is in USDC for buys (what the contract mints) and
// in shares for sells. Buys chain trustline setup -> sign -> submit; sells post
// a crossing classic offer against the best DEX bid.

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
import { sharePrice, sharesForDollars } from "@/lib/dpm";
import { demandMult, impliedRange } from "@/lib/parimutuel";
import { recordPositionMeta } from "@/lib/positions-meta";
import { useWallet } from "@/lib/wallet-context";
import { HonestyTip } from "./honesty-tip";

const server = new rpc.Server(CONFIG.rpcUrl);
const QUICK = [1, 5, 10, 100];

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
  const [amountText, setAmountText] = useState("10");
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [book, setBook] = useState<{ bid: string | null; ask: string | null }>({
    bid: null,
    ask: null,
  });

  const selling = tab === "sell";
  const mode: "prediction" | "conviction" =
    !selling && selected.rung >= 1 ? "conviction" : "prediction";
  const rungSteps = useMemo(() => [0, ...market.rungs], [market.rungs]);
  const rungIndex = Math.max(0, rungSteps.indexOf(selected.rung));
  const code = ticketAssetCode(market.id, selected.side);
  const amt = Number(amountText) || 0;

  const sideMoneyUsd = (sd: number) =>
    Number(ladder.filter((r) => r.side === sd).reduce((a, r) => a + r.stake, 0n)) / 1e7;
  const sidePrice = (s: number) => sharePrice(sideMoneyUsd(s), sideMoneyUsd(1 - s));

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

  // --- Buy: amount is USDC (what mint_tickets takes) ---
  const stake = useMemo(() => {
    if (selling) return 0n;
    try {
      return parseUsdc(amountText || "0");
    } catch {
      return 0n;
    }
  }, [selling, amountText]);

  // Neutral buy: shares received + average price/share (D2 dynamic pricing)
  const neutralQuote = useMemo(() => {
    if (selling || mode !== "prediction" || amt <= 0) return null;
    const shares = sharesForDollars(sideMoneyUsd(selected.side), sideMoneyUsd(1 - selected.side), amt);
    return shares > 0 ? { shares, avg: amt / shares } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selling, mode, amt, ladder, selected.side]);

  const range = useMemo(() => {
    if (selling || stake <= 0n) return null;
    return impliedRange(ladder, selected.side, selected.rung, market.rungs, market.rakeBps, stake);
  }, [selling, ladder, selected, market.rungs, market.rakeBps, stake]);
  const mult = demandMult(ladder, selected.side, selected.rung);
  const rangePoint = range !== null && Math.abs(range.max - range.min) < 0.005;
  // "To win" = gross payout if the side wins (principal + winnings), in USDC
  const toWin = useMemo(() => {
    if (!range || stake <= 0n) return null;
    const s = Number(stake) / 1e7;
    return { lo: s * (1 + range.min), hi: s * (1 + range.max) };
  }, [range, stake]);

  const bidN = book.bid ? Number(book.bid) : null;
  const sellShares = selling ? amt : 0;
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
    address === null || (selling ? sellShares > 0 && bidN !== null : stake > 0n);
  const winNote = rangePoint
    ? "Quote includes your stake; the pool reprices as money moves."
    : selected.rung === 0
      ? "The range is the honest bracket: you earn the high end when convictions on your side die (banked into the pool), the low end when they land and take their cut."
      : "The range spans the final margin: the high end if your side wins by just your margin, the low end if deeper convictions also land.";

  function pickTab(next: "buy" | "sell") {
    setTab(next);
    setPhase({ step: "idle" });
    if (next === "sell" && selected.rung !== 0) onSelect(selected.side, 0); // Neutral only
  }
  const addQuick = (v: number) => setAmountText(String(Math.round(((Number(amountText) || 0) + v) * 100) / 100));

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
        trusts.push(await buildAssetTrustlineXdr(address, code, CONFIG.ticketIssuer));
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

  const winValue = selling
    ? sellProceeds !== null
      ? `$${sellProceeds.toFixed(2)}`
      : "—"
    : toWin
      ? Math.abs(toWin.hi - toWin.lo) < 0.01
        ? `$${toWin.hi.toFixed(2)}`
        : `$${toWin.lo.toFixed(0)}–$${toWin.hi.toFixed(0)}`
      : "—";
  const winSub = selling
    ? book.bid
      ? `best bid $${Number(book.bid).toFixed(3)}`
      : "no bid"
    : neutralQuote
      ? `avg $${neutralQuote.avg.toFixed(3)} / share`
      : mode === "conviction"
        ? `×${mult ? mult.toFixed(2) : "—"} multiplier`
        : " ";

  return (
    <div className="rounded-lg border border-neutral-800 p-4">
      {/* Buy / Sell tabs */}
      <div className="mb-4 flex items-center justify-between border-b border-neutral-800">
        <div className="flex gap-4">
          {(["buy", "sell"] as const).map((t) => (
            <button
              key={t}
              onClick={() => pickTab(t)}
              className={`-mb-px border-b-2 pb-2 text-sm font-medium capitalize ${
                tab === t
                  ? "border-neutral-100 text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <span className="pb-2">
          <HonestyTip />
        </span>
      </div>

      {/* Outcome price buttons */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        {[0, 1].map((side) => (
          <button
            key={side}
            onClick={() => onSelect(side, selling ? 0 : selected.rung)}
            className={`flex items-center justify-center gap-1.5 rounded-md py-2.5 text-sm font-semibold ${
              selected.side === side
                ? "bg-emerald-600 text-white"
                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
            }`}
          >
            {sideName(side)}
            <span className="tabular-nums opacity-90">${sidePrice(side).toFixed(2)}</span>
          </button>
        ))}
      </div>

      {/* Dominance margin slider — our extra; disabled when selling */}
      <div className={`mb-4 ${selling ? "opacity-40" : ""}`}>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-neutral-500">Dominance margin</span>
          <span className="font-medium text-neutral-300">
            {selling ? "None (neutral)" : rungLabel(selected.rung)}
          </span>
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
      </div>

      {/* Amount */}
      <div className="flex items-center justify-between">
        <span className="text-neutral-400">Amount</span>
        <div className="flex items-baseline gap-1">
          {!selling && <span className="text-2xl font-semibold text-neutral-500">$</span>}
          <input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="w-28 bg-transparent text-right text-3xl font-semibold tabular-nums outline-none"
          />
          {selling && <span className="text-sm text-neutral-500">sh</span>}
        </div>
      </div>
      <div className="mb-4 mt-2 flex justify-end gap-2">
        {QUICK.map((v) => (
          <button
            key={v}
            onClick={() => addQuick(v)}
            className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:border-neutral-500"
          >
            {selling ? `+${v}` : `+$${v}`}
          </button>
        ))}
      </div>

      {/* To win / Proceeds */}
      <div className="flex items-end justify-between border-t border-neutral-800 pt-4">
        <div>
          <div className="text-neutral-300">{selling ? "Proceeds" : "To win 💵"}</div>
          <div className="flex items-center gap-1 text-xs text-neutral-500">
            {winSub}
            <InfoDot
              text={
                selling
                  ? `Fills at market against the best bid on Stellar's DEX (${code}). Any unfilled remainder rests as an offer.`
                  : winNote
              }
            />
          </div>
        </div>
        <div className="text-2xl font-bold tabular-nums text-emerald-400">{winValue}</div>
      </div>

      <button
        onClick={submit}
        disabled={busy || !canSubmit}
        className="mt-4 w-full rounded-md bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
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
    <span title={text} className="cursor-help select-none text-neutral-600">
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
