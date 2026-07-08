"use client";

// Wallet connection (Freighter via stellar-wallets-kit 2.5, static API) —
// StellarPay pattern, including the stale-address guard: if the active
// Freighter account changed since connect, signing is refused with a clear
// message instead of producing a cryptic txBadAuth at submission.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  KitEventType,
  Networks,
  StellarWalletsKit,
} from "@creit.tech/stellar-wallets-kit";
import {
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { TransactionBuilder } from "@stellar/stellar-sdk";

interface WalletState {
  address: string | null;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (xdr: string) => Promise<string>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    StellarWalletsKit.init({
      modules: [new FreighterModule()],
      selectedWalletId: FREIGHTER_ID,
      network: Networks.TESTNET,
    });
    // Restore a previous session if the wallet still grants access.
    StellarWalletsKit.getAddress()
      .then(({ address }) => setAddress(address))
      .catch(() => {
        /* no prior session */
      });
    const unsub = StellarWalletsKit.on(KitEventType.DISCONNECT, () =>
      setAddress(null),
    );
    return () => {
      unsub?.();
    };
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const { address } = await StellarWalletsKit.authModal();
      setAddress(address);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await StellarWalletsKit.disconnect();
    setAddress(null);
  }, []);

  const signTransaction = useCallback(async (xdr: string): Promise<string> => {
    try {
      const { address: current } = await StellarWalletsKit.getAddress();
      const parsed = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      const txSource =
        "innerTransaction" in parsed ? parsed.feeSource : parsed.source;
      if (current && txSource !== current) {
        setAddress(current);
        throw new Error("Connected wallet changed — please reconnect and try again.");
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Connected wallet changed"))
        throw e;
      // otherwise let signing surface its own error path
    }
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: Networks.TESTNET,
    });
    return signedTxXdr;
  }, []);

  return (
    <WalletContext.Provider
      value={{ address, isConnecting, error, connect, disconnect, signTransaction }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
