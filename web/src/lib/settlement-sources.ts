// Settlement-source registry (Phase 2, item 2g). The approved official source
// per event CATEGORY — no free-form sources. A market's curator category (set
// at listing) pins its settlement authority, which is printed as the SOLE
// authority on the market page + in the settlement terms. Category-neutral;
// extend as new event categories are curated (sports leagues are the first).

export interface SettlementSource {
  /** The sole named authority printed on the market page. */
  authority: string;
  /** One line on how the result is determined from that authority. */
  note?: string;
}

export const SETTLEMENT_SOURCES: Record<string, SettlementSource> = {
  crypto: {
    authority: "Reflector price feed (on-chain oracle)",
    note: "Settled trustlessly from the % move at settle time — no one posts the result.",
  },
  nba: {
    authority: "NBA official final box score (nba.com)",
    note: "Winner and final margin taken from the league's official published result.",
  },
  other: {
    authority: "The official governing body named in the settlement terms",
  },
};

/** Resolve the settlement authority for a market's curator category. Returns
 *  null for an unknown / unset category (callers fall back to generic copy). */
export function settlementSourceFor(
  category: string | null | undefined,
): SettlementSource | null {
  if (!category) return null;
  return SETTLEMENT_SOURCES[category.toLowerCase()] ?? null;
}

/** Category options offered at listing (the select on /admin/events/new). */
export const SETTLEMENT_CATEGORIES = Object.keys(SETTLEMENT_SOURCES);
