"use client";

// Predictor-facing dispute UI (Phase 2, item 2f). Shown on a market's page
// while it's in the "Proposed" state (an Admin result is posted and the dispute
// window is running). Shows the posted result, a countdown, and — before the
// window closes — a "Dispute this result" action that escrows the
// pool-proportional bond. Once the window elapses with no open dispute, anyone
// may finalize (permissionless). No "spirit of the bet" framing: a dispute is
// only valid if the posted result contradicts the named official source.

import { useState } from "react";
import { buildDisputeXdr, buildFinalizeXdr } from "@/lib/admin";
import {
  explorerTxUrl,
  submitAndWait,
  type DisputeView,
  type MarketView,
  type ProposalView,
} from "@/lib/bakunawa";
import { disputeBond, formatUsdc } from "@/lib/config";
import { isPast } from "@/lib/market-status";
import { ui } from "@/lib/ui";
import { useWallet } from "@/lib/wallet-context";
import { Countdown } from "./countdown";

type Phase =
  | { step: "idle" }
  | { step: "busy"; what: string }
  | { step: "done"; txHash: string }
  | { step: "error"; message: string };

export function DisputePanel({
  market,
  proposal,
  dispute,
  authority,
  onDone,
}: {
  market: MarketView;
  proposal: ProposalView;
  dispute: DisputeView | null;
  authority: string | null;
  onDone: () => void;
}) {
  const { address, connect, signTransaction } = useWallet();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  const sideName = (s: number) => (s === 0 ? market.sideA : market.sideB);
  const marginUnit = (m: number) =>
    market.oracle === "Reflector" ? `${(m / 100).toFixed(2)}%` : `${m}`;
  const bond = disputeBond(proposal.poolAtPropose, market.disputeBondBps);
  const windowElapsed = isPast(proposal.deadline);
  const busy = phase.step === "busy";

  async function act(what: string, build: () => Promise<string>) {
    if (!address) {
      await connect();
      return;
    }
    setPhase({ step: "busy", what });
    try {
      const txHash = await submitAndWait(await signTransaction(await build()));
      setPhase({ step: "done", txHash });
      onDone();
    } catch (e) {
      setPhase({ step: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/8 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Result posted: <b>{sideName(proposal.winner)}</b> by{" "}
          <b>{marginUnit(proposal.margin)}</b> — under review.
        </span>
        <span className="text-ink-muted">
          {windowElapsed ? (
            "dispute window closed"
          ) : (
            <>
              disputable for <b><Countdown to={proposal.deadline} /></b>
            </>
          )}
        </span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink-muted">
        Claims are frozen until this finalizes. Dispute only if the posted result
        contradicts {authority ? <b>{authority}</b> : "the named official source"} — a
        frivolous dispute forfeits its bond. One dispute may be open at a time.
      </p>

      {dispute ? (
        <p className="mt-3 text-ink-secondary">
          🛡 A dispute is open (bond {formatUsdc(dispute.bond)} USDC) — awaiting the
          curator&rsquo;s review against the named source.
        </p>
      ) : !windowElapsed ? (
        <button
          onClick={() => act("Disputing…", () => buildDisputeXdr(address!, market.id))}
          disabled={busy}
          className="mt-3 min-h-11 rounded-md border border-danger/50 bg-danger/10 px-3 text-sm font-medium text-danger hover:border-danger disabled:opacity-50"
        >
          {!address
            ? "Connect wallet to dispute"
            : busy
              ? phase.what
              : `Dispute this result — bond ${formatUsdc(bond)} USDC`}
        </button>
      ) : (
        <button
          onClick={() => act("Finalizing…", () => buildFinalizeXdr(address!, market.id))}
          disabled={busy}
          className={`${ui.buttonPrimary} mt-3`}
        >
          {!address ? "Connect wallet to finalize" : busy ? phase.what : "Finalize settlement"}
        </button>
      )}

      {phase.step === "done" && (
        <p className="mt-2 text-positive">
          Done —{" "}
          <a href={explorerTxUrl(phase.txHash)} target="_blank" rel="noreferrer" className="underline">
            view transaction
          </a>
        </p>
      )}
      {phase.step === "error" && <p className="mt-2 text-danger">{phase.message}</p>}
    </div>
  );
}
