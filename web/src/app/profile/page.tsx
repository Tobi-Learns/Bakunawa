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
    if (!account) return;
    const initial = setTimeout(() => setNameDraft(account.displayName ?? ""), 0);
    return () => clearTimeout(initial);
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

  if (!loaded) return <p className="py-16 text-center text-sm text-ink-muted">Loading…</p>;

  if (!configured)
    return (
      <p className="py-16 text-center text-sm text-ink-muted">
        Google sign-in isn&apos;t configured on this deployment yet.
      </p>
    );

  if (!account)
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Profile</h1>
        <p className="max-w-md text-sm leading-relaxed text-ink-muted">
          Sign in with Google to group your wallets into one portfolio and set a
          display name. Your wallets stay yours — the account only organizes them.
        </p>
        <button
          onClick={() => signIn("google")}
          className="inline-flex min-h-11 items-center rounded-md bg-action px-4 text-sm font-semibold text-action-ink hover:bg-action-hover"
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
          className="inline-flex min-h-11 items-center rounded-md border border-line-strong bg-panel px-3 text-sm text-ink-secondary hover:border-ink-subtle"
        >
          Sign out
        </button>
      </div>

      {notice && <p className="text-sm text-positive">{notice}</p>}

      <section className="flex items-center gap-4">
        {account.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.image} alt="" className="h-12 w-12 rounded-full" />
        )}
        <div>
          <p className="text-ink">{account.name ?? account.email}</p>
          <p className="text-sm text-ink-muted">{account.email}</p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink-secondary">Display name</h2>
        <div className="flex gap-2">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={40}
            placeholder={account.name ?? "Your name"}
            className="min-h-11 w-full max-w-64 rounded-md border border-line-strong bg-panel px-3 text-sm text-ink focus:border-focus"
          />
          <button
            onClick={saveName}
            disabled={busy === "name"}
            className="min-h-11 rounded-md bg-action px-3 text-sm font-semibold text-action-ink hover:bg-action-hover disabled:opacity-50"
          >
            {busy === "name" ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-ink-secondary">Bound wallets</h2>
        <p className="text-xs text-ink-muted">
          Binding groups a wallet&apos;s positions into your portfolio. Connect a
          wallet to bind it — keys never leave your wallet extension.
        </p>
        {account.wallets.length === 0 && (
          <p className="text-sm text-ink-muted">No wallets bound yet.</p>
        )}
        {account.wallets.map((w) => (
          <div
            key={w.address}
            className="flex items-center justify-between rounded-xl border border-line bg-panel/80 px-3 py-2"
          >
            <span className="text-sm text-ink-secondary" title={w.address}>
              {short(w.address)}
              {address === w.address && (
                <span className="ml-2 text-xs text-positive">connected</span>
              )}
            </span>
            <button
              onClick={() => unbindWallet(w.address)}
              disabled={busy === `unbind-${w.address}`}
              className="inline-flex min-h-11 items-center text-xs text-ink-muted underline hover:text-ink-secondary"
            >
              unbind
            </button>
          </div>
        ))}
        {address && !connectedIsBound && (
          <button
            onClick={() => bindWallet(address)}
            disabled={busy === "bind"}
            className="min-h-11 self-start rounded-md bg-action px-3 text-sm font-semibold text-action-ink hover:bg-action-hover disabled:opacity-50"
          >
            {busy === "bind" ? "Binding…" : `Bind connected wallet (${short(address)})`}
          </button>
        )}
        {!address && (
          <button
            onClick={connect}
            className="min-h-11 self-start rounded-md border border-line-strong bg-panel px-3 text-sm text-ink-secondary hover:border-ink-subtle"
          >
            Connect a wallet to bind it
          </button>
        )}
      </section>

      <p className="text-xs leading-relaxed text-ink-subtle">
        See your combined holdings in the{" "}
        <Link href="/portfolio" className="underline">
          portfolio
        </Link>
        .
      </p>
    </div>
  );
}
