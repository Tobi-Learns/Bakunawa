"use client";

// Curator gate: connected wallet must be the contract admin (the contract
// enforces admin.require_auth() anyway — this is UX), plus the app secret
// for DB metadata routes (entered once per session).

import { useState } from "react";
import { getAdminSecret, setAdminSecret } from "@/lib/admin";
import { CONFIG } from "@/lib/config";
import { useWallet } from "@/lib/wallet-context";

export function AdminGate({ children }: { children: React.ReactNode }) {
  const { address, connect } = useWallet();
  const [secret, setSecret] = useState(getAdminSecret());
  const [draft, setDraft] = useState("");

  if (!address || address !== CONFIG.adminAddress)
    return (
      <div className="py-16 text-center text-sm text-ink-muted">
        <h1 className="mb-2 text-xl font-semibold text-ink">Curator tools</h1>
        <p>
          Connect the admin wallet (<span className="font-mono">{CONFIG.adminAddress.slice(0, 6)}…{CONFIG.adminAddress.slice(-6)}</span>) to continue.
        </p>
        {!address && (
          <button
            onClick={connect}
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-action px-4 font-semibold text-action-ink hover:bg-action-hover"
          >
            Connect wallet
          </button>
        )}
        {address && <p className="mt-2 text-danger">Connected wallet is not the admin.</p>}
      </div>
    );

  if (!secret)
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <h1 className="mb-2 text-xl font-semibold">Admin secret</h1>
        <p className="mb-4 text-sm text-ink-muted">
          Needed for metadata writes (BAKUNAWA_ADMIN_SECRET from web/.env).
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAdminSecret(draft);
            setSecret(draft);
          }}
          className="flex gap-2"
        >
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-11 flex-1 rounded-md border border-line-strong bg-panel px-3 text-sm text-ink"
          />
          <button className="min-h-11 rounded-md bg-action px-4 text-sm font-semibold text-action-ink hover:bg-action-hover">
            Unlock
          </button>
        </form>
      </div>
    );

  return <>{children}</>;
}
