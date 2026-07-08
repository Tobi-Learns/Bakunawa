"use client";

// Portfolio scaffold: reads the connected wallet's positions for the known
// demo markets. Full position history needs the indexer (1.6); richer states
// (open / banked / settled / claimable) are Phase 1.5.

import Link from "next/link";
import { useEffect, useState } from "react";
import { getPositions, type PositionView } from "@/lib/bakunawa";
import { formatUsdc } from "@/lib/config";
import { useWallet } from "@/lib/wallet-context";

const DEMO_MARKET_IDS = [1001, 1002];

export default function PortfolioPage() {
  const { address } = useWallet();
  const [rows, setRows] = useState<{ marketId: number; pos: PositionView }[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!address) return;
    let live = true;
    (async () => {
      const found: { marketId: number; pos: PositionView }[] = [];
      for (const id of DEMO_MARKET_IDS) {
        try {
          for (const pos of await getPositions(id, address)) {
            found.push({ marketId: id, pos });
          }
        } catch {
          // market missing — skip
        }
      }
      if (live) {
        setRows(found);
        setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [address]);

  if (!address)
    return (
      <p className="py-16 text-center text-sm text-neutral-400">
        <Link href="/connect" className="underline">
          Connect a wallet
        </Link>{" "}
        to see your positions.
      </p>
    );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Portfolio</h1>
      {!loaded ? (
        <p className="text-sm text-neutral-500">Loading positions…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-400">No positions on the demo markets yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-2 font-normal">Market</th>
              <th className="py-2 font-normal">Side</th>
              <th className="py-2 font-normal">Rung</th>
              <th className="py-2 font-normal">Stake</th>
              <th className="py-2 font-normal">Claimed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ marketId, pos }, i) => (
              <tr key={i} className="border-t border-neutral-900">
                <td className="py-2">
                  <Link href={`/markets/${marketId}`} className="underline">
                    #{marketId}
                  </Link>
                </td>
                <td className="py-2">{pos.side === 0 ? "A" : "B"}</td>
                <td className="py-2">{pos.rung === 0 ? "winner only" : `≥ ${pos.rung}`}</td>
                <td className="py-2">{formatUsdc(pos.stake)} USDC</td>
                <td className="py-2">{pos.claimed ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-xs text-neutral-600">
        Live implied payouts, banked-into-pool states, and claims land in Phase 1.5;
        indexer-backed history in 1.6.
      </p>
    </div>
  );
}
