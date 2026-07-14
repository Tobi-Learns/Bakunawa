"use client";

// 5c: client hook over /api/me — Google account state for the header and
// /profile. Deliberately not SessionProvider/useSession: one fetch, no
// context tree, and the server stays the only identity authority.

import { useCallback, useEffect, useState } from "react";

export interface BoundWallet {
  address: string;
  label: string | null;
  boundAt: string;
}

export interface Account {
  email: string;
  name: string | null;
  image: string | null;
  displayName: string | null;
  wallets: BoundWallet[];
}

export function useAccount() {
  const [configured, setConfigured] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return;
      const data = (await res.json()) as { configured: boolean; user: Account | null };
      setConfigured(data.configured);
      setAccount(data.user);
    } catch {
      /* header stays wallet-only on failure */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    return () => clearTimeout(initial);
  }, [refresh]);

  return { configured, account, loaded, refresh };
}
