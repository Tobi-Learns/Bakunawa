"use client";

// Curator dashboard (1.7): every market with status + quick actions.

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminGate } from "@/components/admin-gate";
import { StatusPill } from "@/components/status-pill";
import type { MarketView } from "@/lib/bakunawa";
import { uiStatus } from "@/lib/market-status";

interface Row {
  id: string;
  title?: string;
  sideA: string;
  sideB: string;
  oracle: string;
  asset?: string;
  status: string;
  closeTs: number;
  settleTs: number;
  pool: string;
  category?: string;
}

export default function AdminHome() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    fetch("/api/markets")
      .then((r) => r.json())
      .then((d) => setRows(d.markets ?? []));
  }, []);

  return (
    <AdminGate>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Curator dashboard</h1>
          <div className="flex gap-2">
            <Link
              href="/admin/curves"
              className="inline-flex min-h-11 items-center rounded-md border border-line-strong bg-panel px-3 text-sm text-ink-secondary hover:border-ink-subtle"
            >
              Metadata & curves
            </Link>
            <Link
              href="/admin/events/new"
              className="inline-flex min-h-11 items-center rounded-md bg-action px-3 text-sm font-semibold text-action-ink hover:bg-action-hover"
            >
              List an event
            </Link>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-ink-muted">
            <tr>
              <th className="py-2 font-normal">Market</th>
              <th className="py-2 font-normal">Oracle</th>
              <th className="py-2 font-normal">Status</th>
              <th className="py-2 font-normal">Pool</th>
              <th className="py-2 font-normal">Settles</th>
              <th className="py-2 font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className="py-2.5">
                  <Link href={`/markets/${m.id}`} className="hover:underline">
                    {m.title ?? `${m.sideA} vs ${m.sideB}`}{" "}
                    <span className="text-ink-subtle">#{m.id}</span>
                  </Link>
                </td>
                <td className="py-2.5">{m.oracle === "Reflector" ? `Reflector · ${m.asset}` : "Admin"}</td>
                <td className="py-2.5">
                  <StatusPill
                    status={uiStatus({ status: m.status, closeTs: m.closeTs, settleTs: m.settleTs } as MarketView)}
                  />
                </td>
                <td className="py-2.5 tabular-nums">
                  {(Number(BigInt(m.pool) / 100000n) / 100).toFixed(2)} USDC
                </td>
                <td className="py-2.5 text-ink-muted">
                  {new Date(m.settleTs * 1000).toLocaleString()}
                </td>
                <td className="py-2.5 text-right">
                  <Link href={`/admin/settle/${m.id}`} className="underline">
                    settle / cancel
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminGate>
  );
}
