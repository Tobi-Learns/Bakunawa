"use client";

// Sell shares (v4, 1.8e) — sell a market's side shares on Stellar's NATIVE DEX
// (shares are ordinary classic assets; a sell moves the claim to the buyer,
// never the pool's cash). Buying is done by minting in the prediction slip.
// Market sell = a crossing classic offer that fills against the best bid; any
// unfilled remainder rests. v1 rule: hidden at lock (the classic DEX can't be
// halted on-chain — post-lock trading is merely unsupported in the UI).

import { useCallback, useEffect, useState } from "react";
import { Asset, BASE_FEE, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import {
  explorerTxUrl,
  submitAndWait,
  ticketAssetCode,
  type MarketView,
} from "@/lib/bakunawa";
import { CONFIG } from "@/lib/config";
import { useWallet } from "@/lib/wallet-context";

const server = new rpc.Server(CONFIG.rpcUrl);

interface Book {
  bid: string | null; // best price someone pays per share (USDC)
  ask: string | null; // best price someone sells at
}

export function TradeWidget({ market }: { market: MarketView }) {
  const { address, connect, signTransaction } = useWallet();
  const [side, setSide] = useState(0);
  const [amount, setAmount] = useState("10");
  const [book, setBook] = useState<Book>({ bid: null, ask: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  const code = ticketAssetCode(market.id, side);
  const amt = Number(amount) || 0;
  const bidN = book.bid ? Number(book.bid) : null;
  const fmtUsd = (v: number) => `$${v.toFixed(2)}`;

  const loadBook = useCallback(async () => {
    try {
      const url =
        `${CONFIG.horizonUrl}/order_book?selling_asset_type=credit_alphanum12` +
        `&selling_asset_code=${code}&selling_asset_issuer=${CONFIG.ticketIssuer}` +
        `&buying_asset_type=credit_alphanum4&buying_asset_code=USDC` +
        `&buying_asset_issuer=${CONFIG.usdcIssuer}&limit=1`;
      const res = await fetch(url);
      const data = (await res.json()) as {
        bids?: { price: string }[];
        asks?: { price: string }[];
      };
      setBook({
        bid: data.bids?.[0]?.price ?? null,
        ask: data.asks?.[0]?.price ?? null,
      });
    } catch {
      setBook({ bid: null, ask: null });
    }
  }, [code]);

  useEffect(() => {
    loadBook();
    const t = setInterval(loadBook, 15_000);
    return () => clearInterval(t);
  }, [loadBook]);

  // Market sell: a crossing classic sell offer fills against the best bid; any
  // unfilled remainder rests as a resting offer. Refuse if no bid exists.
  async function sell() {
    if (!address || !book.bid || amt <= 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const [n, d] = toFraction(Number(book.bid));
      const share = new Asset(code, CONFIG.ticketIssuer);
      const usdc = new Asset("USDC", CONFIG.usdcIssuer);
      const account = await server.getAccount(address);
      const op = Operation.manageSellOffer({
        selling: share,
        buying: usdc,
        amount: amt.toFixed(7),
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
      const hash = await submitAndWait(signed);
      setMsg({ ok: true, text: "Sold at market", hash });
      loadBook();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);

  return (
    <div className="rounded-lg border border-neutral-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Sell shares</h2>
        <span className="text-xs text-neutral-500">Stellar DEX · {code}</span>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {[0, 1].map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`rounded border px-3 py-1.5 text-sm ${
              side === s
                ? "border-neutral-200 bg-neutral-100 text-neutral-900"
                : "border-neutral-700 text-neutral-300"
            }`}
          >
            {sideName(s)} shares
          </button>
        ))}
      </div>
      <div className="mb-3 flex justify-between rounded border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-sm">
        <span className="text-neutral-400">
          Best bid: <span className="text-neutral-200">{book.bid ?? "—"}</span>
        </span>
        <span className="text-neutral-400">
          Best ask: <span className="text-neutral-200">{book.ask ?? "—"}</span>
        </span>
      </div>
      <label className="mb-1 block text-xs text-neutral-500">Amount (shares)</label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
        placeholder="Shares"
        className="mb-3 w-full rounded border border-neutral-700 bg-transparent px-3 py-2 text-sm tabular-nums"
      />
      {!address ? (
        <button
          onClick={connect}
          className="w-full rounded border border-neutral-600 py-2 text-sm font-medium hover:border-neutral-400"
        >
          Connect wallet to sell
        </button>
      ) : (
        <button
          onClick={sell}
          disabled={busy || amt <= 0 || bidN === null}
          className="w-full rounded border border-rose-900 bg-rose-950/40 py-2 text-sm font-medium text-rose-200 hover:border-rose-600 disabled:opacity-40"
        >
          {busy
            ? "Selling…"
            : bidN === null
              ? "No bids to sell into"
              : `Sell ${amt} · ${fmtUsd(amt * bidN)}`}
        </button>
      )}
      <p className="mt-2 text-xs text-neutral-600">
        Sells at market against the best bid. Share price ≈ the crowd&apos;s live winner
        forecast; a sell transfers your claim to the buyer — the pool itself never moves
        before settlement. Buy more by minting in the prediction slip above.
      </p>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>
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
