"use client";

import { useWallet } from "@/lib/wallet-context";

export default function ConnectPage() {
  const { address, isConnecting: connecting, connect, error } = useWallet();
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Connect your wallet</h1>
      <p className="max-w-md text-sm leading-relaxed text-ink-muted">
        Bakunawa is non-custodial: stakes go straight to the market contract and
        winnings are claimed by your wallet. Freighter on testnet is supported.
      </p>
      {address ? (
        <p className="rounded-xl border border-positive/35 bg-positive/8 px-4 py-3 text-sm text-positive">
          Connected: <span className="font-mono">{address}</span>
        </p>
      ) : (
        <>
          <button
            onClick={connect}
            disabled={connecting}
            className="inline-flex min-h-11 items-center rounded-md bg-action px-5 font-semibold text-action-ink hover:bg-action-hover disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect Freighter"}
          </button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </>
      )}
    </div>
  );
}
