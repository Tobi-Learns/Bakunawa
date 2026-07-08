"use client";

import { useWallet } from "@/lib/wallet-context";

export default function ConnectPage() {
  const { address, isConnecting: connecting, connect, error } = useWallet();
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Connect your wallet</h1>
      <p className="max-w-md text-sm text-neutral-400">
        Bakunawa is non-custodial: stakes go straight to the market contract and
        winnings are claimed by your wallet. Freighter on testnet is supported.
      </p>
      {address ? (
        <p className="rounded border border-emerald-900 bg-emerald-950/40 px-4 py-2 text-sm">
          Connected: <span className="font-mono">{address}</span>
        </p>
      ) : (
        <>
          <button
            onClick={connect}
            disabled={connecting}
            className="rounded bg-neutral-100 px-5 py-2.5 font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect Freighter"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
}
