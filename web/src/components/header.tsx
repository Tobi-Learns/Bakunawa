"use client";

import Link from "next/link";
import { BrandWordmark } from "@/components/brand";
import { useWallet } from "@/lib/wallet-context";

function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function Header() {
  const { address, isConnecting: connecting, connect, disconnect } = useWallet();
  return (
    <header className="border-b border-neutral-800">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-neutral-100 transition hover:text-white">
            <BrandWordmark size={30} />
          </Link>
          <nav className="flex gap-4 text-sm text-neutral-400">
            <Link href="/markets" className="hover:text-neutral-100">
              Markets
            </Link>
            <Link href="/portfolio" className="hover:text-neutral-100">
              Portfolio
            </Link>
            <Link href="/how-it-works" className="hover:text-neutral-100">
              How it works
            </Link>
          </nav>
        </div>
        {address ? (
          <button
            onClick={disconnect}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
            title={address}
          >
            {short(address)} · disconnect
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}
      </div>
    </header>
  );
}
