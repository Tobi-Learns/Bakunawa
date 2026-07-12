// Client-side dynamic-mint-pricing quote (D2 / phase 1.12) — the display
// mirror of contracts/bakunawa/src/dpm.rs. The contract does the authoritative
// integer math on submit; this is the live estimate the prediction slip shows.
//
// Mint price per Neutral share = the side's money-share (= the crowd-implied
// probability, Polymarket-style): a 50/50 book prices at $0.50, rising toward
// $1 as the side nears certainty (underdog toward $0) — range $0.01–$0.99.
// Shares for `d` USDC on a side (pre-mint money `mSide`, other side `mOther`) =
//     shares = d + mOther * ln((mSide + d) / mSide)   (2*d when mSide==0).
// The slip lets the user enter SHARES, so we also invert (shares -> USDC).
// Amounts here are in USDC (floats) — display only; the contract is authoritative.
// Note: a share PAYS a parimutuel pool split at settlement, not a fixed $1.

/** Shares minted for `dollars` USDC on a side. */
export function sharesForDollars(mSide: number, mOther: number, dollars: number): number {
  if (dollars <= 0) return 0;
  if (mSide <= 0) return dollars * 2; // bootstrap / seed: $0.50/share
  return dollars + mOther * Math.log((mSide + dollars) / mSide);
}

/** USDC needed to mint `shares` on a side (inverts the above; monotonic). */
export function dollarsForShares(mSide: number, mOther: number, shares: number): number {
  if (shares <= 0) return 0;
  if (mSide <= 0) return shares / 2; // bootstrap: $0.50/share
  // price is in ($0, $1], so dollars is in [0, shares]
  let lo = 0;
  let hi = shares;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (sharesForDollars(mSide, mOther, mid) < shares) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Marginal mint price per share on a side = its money-share (= crowd
 *  probability); $0.50 at 50/50, range $0.01–$0.99. Par $0.50 when empty. */
export function sharePrice(mSide: number, mOther: number): number {
  const tot = mSide + mOther;
  return tot > 0 ? mSide / tot : 0.5;
}
