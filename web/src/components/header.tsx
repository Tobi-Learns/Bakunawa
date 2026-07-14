"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { BrandWordmark } from "@/components/brand";
import { useAccount } from "@/lib/use-account";
import { ui } from "@/lib/ui";
import { useWallet } from "@/lib/wallet-context";

function short(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export function Header() {
  const { address, isConnecting: connecting, connect, disconnect } = useWallet();
  const { configured, account } = useAccount();

  return (
    <header className="border-b border-line bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-col px-4 py-2 md:grid md:grid-cols-[auto_1fr_auto_auto] md:items-center md:gap-x-4 md:py-3">
        <div className="flex items-center justify-between gap-3 md:contents">
          <Link href="/" className="min-w-0 justify-self-start text-ink transition hover:text-white md:col-start-1">
            <BrandWordmark size={30} />
          </Link>

          <div className="flex items-center justify-end md:col-start-4 md:row-start-1">
            {address ? (
              <button
                onClick={disconnect}
                className={`${ui.buttonSecondary} whitespace-nowrap px-3 text-sm`}
                title={address}
              >
                {short(address)} <span className="hidden lg:inline">· disconnect</span>
              </button>
            ) : (
              <button
                onClick={connect}
                disabled={connecting}
                className={`${ui.buttonPrimary} whitespace-nowrap px-3 text-sm`}
              >
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 md:contents">
          <nav
            aria-label="Primary navigation"
            className="flex min-w-0 items-center gap-0 whitespace-nowrap text-ink-muted md:col-start-2 md:row-start-1 md:gap-2"
          >
            <Link href="/markets" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-1 text-[13px] hover:bg-panel-raised hover:text-ink sm:px-2 sm:text-sm">
              Markets
            </Link>
            <Link href="/portfolio" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-1 text-[13px] hover:bg-panel-raised hover:text-ink sm:px-2 sm:text-sm">
              Portfolio
            </Link>
            <Link href="/how-it-works" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-1 text-[13px] hover:bg-panel-raised hover:text-ink sm:px-2 sm:text-sm">
              How it works
            </Link>
          </nav>

          <div className="flex min-w-0 items-center justify-end md:col-start-3 md:row-start-1">
            {account ? (
              <Link
                href="/profile"
                className={`${ui.buttonSecondary} min-w-0 px-2 text-xs sm:px-2.5 sm:text-sm`}
                title={account.email}
              >
                {account.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={account.image} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                )}
                <span className="max-w-12 truncate sm:max-w-28 lg:max-w-40">
                  {account.displayName ?? account.name ?? account.email}
                </span>
              </Link>
            ) : configured ? (
              <button
                onClick={() => signIn("google")}
                className={`${ui.buttonSecondary} px-2 text-xs sm:px-3 sm:text-sm`}
              >
                Sign in
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
