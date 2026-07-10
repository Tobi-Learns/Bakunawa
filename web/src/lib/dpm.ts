// Client-side dynamic-mint-pricing quote (D2 / phase 1.12) — the display
// mirror of contracts/bakunawa/src/dpm.rs. The contract does the authoritative
// integer math on submit; this is the live estimate the prediction slip shows.
//
// Mint price per Neutral share = 2 * the side's money-share, so a 50/50 book
// prices at par ($1, matching the house seed) and rises to $2 as the side
// nears certainty (underdog toward $0). Shares for `d` USDC on a side (pre-mint
// money `mSide`, other side `mOther`) =
//     shares = (d + mOther * ln((mSide + d) / mSide)) / 2   (par when mSide==0).
// The slip lets the user enter SHARES, so we also invert (shares -> USDC).
// Amounts here are in USDC (floats) — display only; the contract is authoritative.

/** Shares minted for `dollars` USDC on a side. */
export function sharesForDollars(mSide: number, mOther: number, dollars: number): number {
  if (dollars <= 0) return 0;
  if (mSide <= 0) return dollars; // bootstrap / seed: 1 share = $1 (par)
  return (dollars + mOther * Math.log((mSide + dollars) / mSide)) / 2;
}

/** USDC needed to mint `shares` on a side (inverts the above; monotonic). */
export function dollarsForShares(mSide: number, mOther: number, shares: number): number {
  if (shares <= 0) return 0;
  if (mSide <= 0) return shares; // bootstrap: par
  // price is in ($0, $2], so dollars is in [0, 2*shares]
  let lo = 0;
  let hi = 2 * shares;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (sharesForDollars(mSide, mOther, mid) < shares) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Marginal mint price per share on a side = 2 * its money-share ($1 at 50/50,
 *  up to $2 at certainty). Distinct from the forecast (the raw money-share). */
export function sharePrice(mSide: number, mOther: number): number {
  const tot = mSide + mOther;
  return tot > 0 ? (2 * mSide) / tot : 1;
}
