// Client-side dynamic-mint-pricing quote (D2 / phase 1.12) — the display
// mirror of contracts/bakunawa/src/dpm.rs. The contract does the authoritative
// integer math on submit; this is the live estimate the prediction slip shows.
//
// Mint price per Neutral share = the side's money-share, so shares for `d`
// USDC on a side (pre-mint money `mSide`, other side `mOther`) =
//     shares = d + mOther * ln((mSide + d) / mSide)     (par when mSide == 0).
// The slip lets the user enter SHARES, so we also invert (shares -> USDC).
// Amounts here are in USDC (floats) — display only.

/** Shares minted for `dollars` USDC on a side. */
export function sharesForDollars(mSide: number, mOther: number, dollars: number): number {
  if (dollars <= 0) return 0;
  if (mSide <= 0) return dollars; // bootstrap / seed: 1 share = $1
  return dollars + mOther * Math.log((mSide + dollars) / mSide);
}

/** USDC needed to mint `shares` on a side (inverts the above; monotonic). */
export function dollarsForShares(mSide: number, mOther: number, shares: number): number {
  if (shares <= 0) return 0;
  if (mSide <= 0) return shares; // bootstrap: par
  // shares >= dollars always (log bonus >= 0), so dollars is in [0, shares]
  let lo = 0;
  let hi = shares;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (sharesForDollars(mSide, mOther, mid) < shares) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Current marginal mint price per share on a side == its money share. */
export function sharePrice(mSide: number, mOther: number): number {
  const tot = mSide + mOther;
  return tot > 0 ? mSide / tot : 0.5;
}
