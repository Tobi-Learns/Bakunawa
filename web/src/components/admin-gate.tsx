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
      <div className="py-16 text-center text-sm text-neutral-400">
        <h1 className="mb-2 text-xl font-semibold text-neutral-100">Curator tools</h1>
        <p>
          Connect the admin wallet (<span className="font-mono">{CONFIG.adminAddress.slice(0, 6)}…{CONFIG.adminAddress.slice(-6)}</span>) to continue.
        </p>
        {!address && (
          <button
            onClick={connect}
            className="mt-4 rounded bg-neutral-100 px-4 py-2 font-medium text-neutral-900"
          >
            Connect wallet
          </button>
        )}
        {address && <p className="mt-2 text-red-400">Connected wallet is not the admin.</p>}
      </div>
    );

  if (!secret)
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <h1 className="mb-2 text-xl font-semibold">Admin secret</h1>
        <p className="mb-4 text-sm text-neutral-400">
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
            className="flex-1 rounded border border-neutral-700 bg-transparent px-3 py-2 text-sm"
          />
          <button className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900">
            Unlock
          </button>
        </form>
      </div>
    );

  return <>{children}</>;
}
