"use client";

// 5c/5d: the Google profile — identity (editable display name), sign-out,
// and the wallet binder (bind-on-connect per Phase 5 decision 4; the Google
// account organizes wallets, it never holds keys — D13 is the deferred
// Google-based wallet).

import Link from "next/link";
import { signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { useAccount } from "@/lib/use-account";
import { useWallet } from "@/lib/wallet-context";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

export default function ProfilePage() {
  const { configured, account, loaded, refresh } = useAccount();
  const { address, connect } = useWallet();
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (account) setNameDraft(account.displayName ?? "");
  }, [account]);

  async function saveName() {
    setBusy("name");
    setNotice(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: nameDraft }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      await refresh();
      setNotice("Display name saved.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function bindWallet(addr: string) {
    setBusy("bind");
    setNotice(null);
    try {
      const res = await fetch("/api/me/wallets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      await refresh();
      setNotice("Wallet bound to your profile.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function unbindWallet(addr: string) {
    setBusy(`unbind-${addr}`);
    setNotice(null);
    try {
      const res = await fetch("/api/me/wallets", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      await refresh();
      setNotice("Wallet unbound.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!loaded) return <p className="py-16 text-center text-sm text-neutral-500">Loading…</p>;

  if (!configured)
    return (
      <p className="py-16 text-center text-sm text-neutral-400">
        Google sign-in isn&apos;t configured on this deployment yet.
      </p>
    );

  if (!account)
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="max-w-md text-sm text-neutral-400">
          Sign in with Google to group your wallets into one portfolio and set a
          display name. Your wallets stay yours — the account only organizes them.
        </p>
        <button
          onClick={() => signIn("google")}
          className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          Sign in with Google
        </button>
      </div>
    );

  const connectedIsBound = address
    ? account.wallets.some((w) => w.address === address)
    : false;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
        >
          Sign out
        </button>
      </div>

      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      <section className="flex items-center gap-4">
        {account.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.image} alt="" className="h-12 w-12 rounded-full" />
        )}
        <div>
          <p className="text-neutral-100">{account.name ?? account.email}</p>
          <p className="text-sm text-neutral-500">{account.email}</p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-neutral-300">Display name</h2>
        <div className="flex gap-2">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={40}
            placeholder={account.name ?? "Your name"}
            className="w-64 rounded border border-neutral-700 bg-transparent px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          />
          <button
            onClick={saveName}
            disabled={busy === "name"}
            className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {busy === "name" ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-300">Bound wallets</h2>
        <p className="text-xs text-neutral-500">
          Binding groups a wallet&apos;s positions into your portfolio. Connect a
          wallet to bind it — keys never leave your wallet extension.
        </p>
        {account.wallets.length === 0 && (
          <p className="text-sm text-neutral-500">No wallets bound yet.</p>
        )}
        {account.wallets.map((w) => (
          <div
            key={w.address}
            className="flex items-center justify-between rounded border border-neutral-800 px-3 py-2"
          >
            <span className="text-sm text-neutral-200" title={w.address}>
              {short(w.address)}
              {address === w.address && (
                <span className="ml-2 text-xs text-emerald-400">connected</span>
              )}
            </span>
            <button
              onClick={() => unbindWallet(w.address)}
              disabled={busy === `unbind-${w.address}`}
              className="text-xs text-neutral-500 underline hover:text-neutral-300"
            >
              unbind
            </button>
          </div>
        ))}
        {address && !connectedIsBound && (
          <button
            onClick={() => bindWallet(address)}
            disabled={busy === "bind"}
            className="self-start rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {busy === "bind" ? "Binding…" : `Bind connected wallet (${short(address)})`}
          </button>
        )}
        {!address && (
          <button
            onClick={connect}
            className="self-start rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-500"
          >
            Connect a wallet to bind it
          </button>
        )}
      </section>

      <p className="text-xs text-neutral-600">
        See your combined holdings in the{" "}
        <Link href="/portfolio" className="underline">
          portfolio
        </Link>
        .
      </p>
    </div>
  );
}
