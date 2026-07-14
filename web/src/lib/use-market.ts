"use client";

// Polling market state hook: on-chain market + ladder + outcome, plus the
// live Reflector move for crypto markets. All numbers come from chain reads
// in the browser — the UI never trusts a backend for prices or payouts.

import { useEffect, useRef, useState } from "react";
import {
  getDispute,
  getLadder,
  getMarket,
  getOutcome,
  getProposal,
  type DisputeView,
  type LadderRowView,
  type MarketView,
  type OutcomeView,
  type ProposalView,
} from "./bakunawa";
import { getLiveMove, type LiveMove } from "./reflector";

export interface MarketState {
  market: MarketView | null;
  ladder: LadderRowView[];
  outcome: OutcomeView | null;
  move: LiveMove | null;
  proposal: ProposalView | null; // Phase 2: posted Admin result + dispute window
  dispute: DisputeView | null; // Phase 2: the single open dispute, if any
  error: string | null;
  loading: boolean;
}

export function useMarket(id: string | number, pollMs = 12_000): MarketState {
  const [state, setState] = useState<MarketState>({
    market: null,
    ladder: [],
    outcome: null,
    move: null,
    proposal: null,
    dispute: null,
    error: null,
    loading: true,
  });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let live = true;

    async function refresh() {
      try {
        const market = await getMarket(BigInt(id));
        const [ladder, outcome, move, proposal, dispute] = await Promise.all([
          getLadder(BigInt(id)),
          market.status === "Settled" ? getOutcome(BigInt(id)) : Promise.resolve(null),
          market.oracle === "Reflector" && market.status === "Open"
            ? getLiveMove(market.asset, market.baseline).catch(() => null)
            : Promise.resolve(null),
          market.status === "Proposed" ? getProposal(BigInt(id)) : Promise.resolve(null),
          market.status === "Proposed" ? getDispute(BigInt(id)) : Promise.resolve(null),
        ]);
        if (!live) return;
        setState({ market, ladder, outcome, move, proposal, dispute, error: null, loading: false });
        // Terminal markets never change again — stop polling. "Proposed" is NOT
        // terminal (the window counts down and disputes can open), so keep polling.
        if (market.status !== "Open" && market.status !== "Proposed" && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      } catch (e) {
        if (live)
          setState((s) => ({
            ...s,
            error: e instanceof Error ? e.message : String(e),
            loading: false,
          }));
      }
    }

    refresh();
    timer.current = setInterval(refresh, pollMs);
    return () => {
      live = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [id, pollMs]);

  return state;
}
