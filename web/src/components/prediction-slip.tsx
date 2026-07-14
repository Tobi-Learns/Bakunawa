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
  getUsdcBalance,
  submitAndWait,
  ticketAssetCode,
  type LadderRowView,
  type MarketView,
} from "@/lib/bakunawa";
import { CONFIG, formatUsdc, parseUsdc } from "@/lib/config";
import { sharePrice, sharesForDollars } from "@/lib/dpm";
import { quoteBuy } from "@/lib/parimutuel";
import { recordNeutralEntry, recordPositionMeta } from "@/lib/positions-meta";
import { ui } from "@/lib/ui";
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
    const initial = setTimeout(loadBook, 0);
    const t = setInterval(loadBook, 15_000);
    return () => {
      clearTimeout(initial);
      clearInterval(t);
    };
  }, [selling, loadBook]);


  // --- Buy: amount is USDC (what mint_tickets takes) ---
  const stake = (() => {
    if (selling) return 0n;
    try {
      return parseUsdc(amountText || "0");
    } catch {
      return 0n;
    }
  })();

  // Neutral buy: shares received + average price/share (D2 dynamic pricing)
  const neutralQuote = useMemo(() => {
    if (selling || mode !== "prediction" || amt <= 0) return null;
    const shares = sharesForDollars(sideMoneyUsd(selected.side), sideMoneyUsd(1 - selected.side), amt);
    return shares > 0 ? { shares, avg: amt / shares } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selling, mode, amt, ladder, selected.side]);

  // Unified quote: DPM shares this $ buys + the self-priced implied-payout range.
  const quote = useMemo(() => {
    if (selling || stake <= 0n) return null;
    return quoteBuy(ladder, selected.side, selected.rung, Number(stake), market.rungs, market.rakeBps);
  }, [selling, ladder, selected, market.rungs, market.rakeBps, stake]);
  const range = quote?.range ?? null;
  const pricePerShare = quote?.pricePerShare ?? sidePrice(selected.side);
  const rangePoint = range !== null && Math.abs(range.max - range.min) < 0.005;
  // "To win" = gross payout if the side wins, in USDC. The unified ROI already
  // accounts for share pricing (quoteBuy mints the probe's shares), so this is
  // just stake x (1 + ROI) for both Neutral and convictions.
  const toWin = useMemo(() => {
    if (!range || stake <= 0n) return null;
    const d = Number(stake) / 1e7;
    return { lo: d * (1 + range.min), hi: d * (1 + range.max) };
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
      // Pre-flight: fail fast with an exact-number message before any signing.
      // The chokepoint in buildTxXdr still catches this generically, but here
      // we can tell the user what they have vs. what the buy costs.
      setPhase({ step: "busy", what: "Checking balance…" });
      const bal = await getUsdcBalance(address);
      if (bal < stake) {
        setPhase({
          step: "error",
          message: `Insufficient balance — you have ${formatUsdc(bal)} USDC but this costs ${formatUsdc(stake)} USDC.`,
        });
        return;
      }
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
          // eslint-disable-next-line react-hooks/purity -- transaction completion timestamp is event data
          at: Date.now(),
        });
      } else if (neutralQuote) {
        // Fungible Neutral shares: record this mint's cost basis for the
        // portfolio's weighted-average "Bought at" (contract can't track it).
        recordNeutralEntry({
          marketId: Number(market.id),
          side: selected.side,
          dollars: stake.toString(),
          shares: BigInt(Math.round(neutralQuote.shares * 1e7)).toString(),
          // eslint-disable-next-line react-hooks/purity -- transaction completion timestamp is event data
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
        : `$${toWin.lo.toFixed(2)}–$${toWin.hi.toFixed(2)}`
      : "—";
  const winSub = selling
    ? book.bid
      ? `best bid $${Number(book.bid).toFixed(3)}`
      : "no bid"
    : neutralQuote
      ? `avg $${neutralQuote.avg.toFixed(3)} / share`
      : mode === "conviction"
        ? `$${pricePerShare.toFixed(4)} / share`
        : " ";

  return (
    <div className="rounded-xl border border-line bg-panel/90 p-4 shadow-lg shadow-black/20">
      {/* Title — market + selected outcome */}
      <div className="mb-4">
        <div className="text-sm text-ink-muted">
          {market.oracle === "Reflector"
            ? `${market.asset} · ${sideName(0)} vs ${sideName(1)}`
            : `${sideName(0)} vs ${sideName(1)}`}
        </div>
        <div className="text-xl font-semibold">
          {sideName(selected.side)}
          <span className="font-normal text-ink-muted">
            {" "}
            · {selling ? "Sell" : selected.rung === 0 ? "Neutral" : rungLabel(selected.rung)}
          </span>
        </div>
      </div>

      {/* Buy / Sell tabs */}
      <div className="mb-5 flex items-center justify-between border-b border-line">
        <div className="flex gap-4">
          {(["buy", "sell"] as const).map((t) => (
            <button
              key={t}
              onClick={() => pickTab(t)}
              className={`-mb-px inline-flex min-h-11 items-center border-b-2 text-sm font-medium capitalize ${
                tab === t
                  ? "border-action text-action-hover"
                  : "border-transparent text-ink-muted hover:text-ink"
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
      <div className="mb-5 grid grid-cols-2 gap-2">
        {[0, 1].map((side) => (
          <button
            key={side}
            onClick={() => onSelect(side, selling ? 0 : selected.rung)}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-semibold ${
              selected.side === side
                ? "bg-action text-action-ink"
                : "border border-line bg-panel-muted text-ink-secondary hover:border-line-strong hover:bg-panel-raised"
            }`}
          >
            {sideName(side)}
            <span className="tabular-nums opacity-90">${sidePrice(side).toFixed(2)}</span>
          </button>
        ))}
      </div>

      {/* Dominance margin slider — our extra; disabled when selling */}
      <div className={`mb-6 ${selling ? "opacity-40" : ""}`}>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-ink-muted">Dominance margin</span>
          <span className="font-medium text-ink-secondary">
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
          className="h-11 w-full accent-action disabled:cursor-not-allowed"
        />
      </div>

      {/* Amount */}
      <div className="flex items-center justify-between">
        <span className="text-ink-muted">Amount</span>
        <div className="flex items-baseline">
          {!selling && (
            <span className={`text-5xl ${amountText ? "text-ink-muted" : "text-ink-subtle"}`}>$</span>
          )}
          <input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            placeholder="0"
            size={Math.max(amountText.length, 1)}
            className="min-w-[1ch] bg-transparent text-5xl tabular-nums text-ink outline-none placeholder:text-ink-subtle [field-sizing:content]"
          />
          {selling && <span className="ml-1 text-base text-ink-muted">sh</span>}
        </div>
      </div>
      <div className="mb-6 mt-3 flex justify-end gap-2">
        {QUICK.map((v) => (
          <button
            key={v}
            onClick={() => addQuick(v)}
            className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-3 text-xs text-ink-secondary hover:border-ink-subtle hover:text-ink"
          >
            {selling ? `+${v}` : `+$${v}`}
          </button>
        ))}
      </div>

      {/* To win / Proceeds — only once there's an amount */}
      {amt > 0 && (
        <div className="flex items-start justify-between gap-3 border-t border-line pt-5">
          {/* label column */}
          <div className="min-w-0">
            <div className="text-ink-secondary">{selling ? "Proceeds" : "To win 💵"}</div>
            <div className="flex items-center gap-1 text-xs text-ink-muted">
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
          {/* value column — Min / Max on their own rows, label beside the number */}
          {!selling && toWin && Math.abs(toWin.hi - toWin.lo) >= 0.01 ? (
            <div className="shrink-0 space-y-1">
              <div className="flex items-baseline justify-end gap-1.5">
                <span className="text-xs text-ink-muted">Min</span>
                <span className="text-4xl tabular-nums text-positive">${toWin.lo.toFixed(2)}</span>
              </div>
              <div className="flex items-baseline justify-end gap-1.5">
                <span className="text-xs text-ink-muted">Max</span>
                <span className="text-4xl tabular-nums text-positive">${toWin.hi.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="shrink-0 text-4xl tabular-nums text-positive">{winValue}</div>
          )}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !canSubmit}
        className={`${ui.buttonPrimary} mt-5 w-full`}
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
        <p className="mt-3 text-sm text-positive">
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
      {phase.step === "error" && <p className="mt-3 text-sm text-danger">{phase.message}</p>}
    </div>
  );
}

/** Tiny hover-tooltip dot — carries the honest-bracket / fill detail. */
function InfoDot({ text }: { text: string }) {
  return (
    <span title={text} className="cursor-help select-none text-ink-subtle">
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
