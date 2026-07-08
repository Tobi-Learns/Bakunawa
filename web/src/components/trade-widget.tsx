"use client";

// Ticket trading (v4, 1.8e) — buy/sell a market's side tickets against USDC
// on Stellar's NATIVE DEX (tickets are ordinary classic assets; trades move
// the claim, never the pool's cash). Shows the top of the order book; offers
// are classic manage-offer ops signed by the connected wallet.
// v1 rule: the widget disappears at lock. (On-chain the classic DEX cannot be
// halted — post-lock trading is merely unsupported in the UI, noted in docs.)

import { useCallback, useEffect, useState } from "react";
import { Asset, BASE_FEE, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import {
  buildAssetTrustlineXdr,
  explorerTxUrl,
  submitAndWait,
  ticketAssetCode,
  type MarketView,
} from "@/lib/bakunawa";
import { CONFIG } from "@/lib/config";
import { useWallet } from "@/lib/wallet-context";

const server = new rpc.Server(CONFIG.rpcUrl);

interface Book {
  bid: string | null; // best price someone pays per ticket (USDC)
  ask: string | null; // best price someone sells at
}

export function TradeWidget({ market }: { market: MarketView }) {
  const { address, signTransaction } = useWallet();
  const [side, setSide] = useState(0);
  const [action, setAction] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("10");
  const [price, setPrice] = useState("0.50");
  const [book, setBook] = useState<Book>({ bid: null, ask: null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  const code = ticketAssetCode(market.id, side);

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

  async function place() {
    if (!address) return;
    setBusy(true);
    setMsg(null);
    try {
      const [n, d] = toFraction(Number(price));
      const stroops = BigInt(Math.round(Number(amount) * 1e7)).toString();
      const ticket = new Asset(code, CONFIG.ticketIssuer);
      const usdc = new Asset("USDC", CONFIG.usdcIssuer);
      // buying tickets needs the trustline first
      if (action === "buy") {
        const trust = await buildAssetTrustlineXdr(address, code, CONFIG.ticketIssuer);
        if (trust) await submitAndWait(await signTransaction(trust));
      }
      const account = await server.getAccount(address);
      const op =
        action === "sell"
          ? Operation.manageSellOffer({
              selling: ticket,
              buying: usdc,
              amount: (Number(stroops) / 1e7).toFixed(7),
              price: { n, d },
            })
          : Operation.manageBuyOffer({
              selling: usdc,
              buying: ticket,
              buyAmount: (Number(stroops) / 1e7).toFixed(7),
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
      setMsg({ ok: true, text: `${action === "buy" ? "Buy" : "Sell"} offer placed`, hash });
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
        <h2 className="font-semibold">Trade tickets</h2>
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
            {sideName(s)} tickets
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
      <div className="mb-3 grid grid-cols-3 gap-2 text-sm">
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as "buy" | "sell")}
          className="rounded border border-neutral-700 bg-transparent px-2 py-2"
        >
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="Tickets"
          className="rounded border border-neutral-700 bg-transparent px-2 py-2 tabular-nums"
        />
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="USDC/ticket"
          className="rounded border border-neutral-700 bg-transparent px-2 py-2 tabular-nums"
        />
      </div>
      <button
        onClick={place}
        disabled={busy || !address || Number(amount) <= 0 || Number(price) <= 0}
        className="w-full rounded border border-neutral-600 py-2 text-sm font-medium hover:border-neutral-400 disabled:opacity-50"
      >
        {busy ? "Placing…" : !address ? "Connect wallet to trade" : `Place ${action} offer`}
      </button>
      <p className="mt-2 text-xs text-neutral-600">
        Ticket price ≈ the crowd&apos;s live winner forecast. Trades transfer the claim —
        the pool itself never moves before settlement.
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
