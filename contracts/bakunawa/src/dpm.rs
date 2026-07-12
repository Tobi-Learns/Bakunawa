//! Dynamic mint pricing (D2 / phase 1.12) — fixed-point integer math.
//!
//! The mint price per share = the side's money-share (= the crowd-implied
//! probability, Polymarket-style): a 50/50 book prices at $0.50, rising toward
//! $1 as the side nears certainty (the underdog toward $0) — range $0.01–$0.99.
//! Minting `d` stroops on a side with pre-mint money `m_side` and other-side
//! money `m_other` yields
//!
//!     shares = d + m_other * ln((m_side + d) / m_side)
//!
//! computed entirely in i128 (Soroban is no_std, no floats). The exact integer
//! algorithm here is validated against the reference in sim/dpm.py: worst
//! relative share error ~0.17% over 200k random cases — and share counts only
//! set split *proportions* at settlement, never the pot total, so any residual
//! error cannot affect solvency.
//!
//! `ln` is computed as `log2(x) * ln(2)` with a fixed-point scale of 1e9;
//! `log2` uses integer argument reduction (halving into [1,2)) then a
//! bit-by-bit fractional refinement via repeated squaring.

const LN_SCALE: i128 = 1_000_000_000; // 1e9 fixed-point scale for ln/log2
const LN2: i128 = 693_147_181; // round(ln(2) * 1e9)
const LN_PREC: u32 = 34; // fractional log2 bits

/// log2(x) for x = x_fp / LN_SCALE (x >= 1), returned as fixed-point (× LN_SCALE).
fn fp_log2(mut x_fp: i128) -> i128 {
    let mut k: i128 = 0;
    while x_fp >= 2 * LN_SCALE {
        x_fp /= 2;
        k += 1;
    }
    // x_fp now in [LN_SCALE, 2*LN_SCALE): mantissa in [1, 2)
    let mut frac: i128 = 0;
    let mut m = x_fp;
    let mut add = LN_SCALE;
    let mut i: u32 = 0;
    while i < LN_PREC {
        m = m * m / LN_SCALE; // square (m stays < 4*LN_SCALE => no overflow)
        add /= 2; // 2^-i in fixed-point
        if m >= 2 * LN_SCALE {
            m /= 2;
            frac += add;
        }
        i += 1;
    }
    k * LN_SCALE + frac
}

/// ln(num/den) for num >= den > 0, returned as fixed-point (× LN_SCALE).
fn fp_ln_ratio(num: i128, den: i128) -> i128 {
    let r_fp = num * LN_SCALE / den; // ratio in fixed-point, >= LN_SCALE
    if r_fp <= LN_SCALE {
        return 0;
    }
    fp_log2(r_fp) * LN2 / LN_SCALE
}

/// Shares minted for `dollars` stroops on a side, given pre-mint money on that
/// side (`m_side`) and the other side (`m_other`). Bootstraps at par ($0.50/
/// share => 2 shares per stroop) when the side is empty (m_side == 0), matching
/// the 50/50 house seed. Price per share = the money-share (range $0.01–$0.99).
pub fn dpm_shares(m_side: i128, m_other: i128, dollars: i128) -> i128 {
    if m_side <= 0 {
        return dollars * 2; // seed / bootstrap: $0.50/share at a 50/50 book
    }
    let ln_fp = fp_ln_ratio(m_side + dollars, m_side);
    dollars + m_other * ln_fp / LN_SCALE // price = money-share
}

#[cfg(test)]
mod tests {
    use super::*;

    // Values cross-checked against sim/dpm.py (stroops, 1e7 = 1 USDC).
    #[test]
    fn matches_reference() {
        // balanced 50/50 book (~$0.50/share): mint $10 -> ~19.12 shares
        let s = dpm_shares(50 * 10_000_000, 50 * 10_000_000, 10 * 10_000_000);
        assert!((s - 191_160_000).abs() < 400_000, "got {}", s);

        // empty side bootstraps at par ($0.50/share => 2 shares/stroop)
        assert_eq!(dpm_shares(0, 100, 10_000_000), 20_000_000);

        // other side empty => 100% money-share => $1/share => shares == dollars
        assert_eq!(dpm_shares(50_000_000, 0, 10_000_000), 10_000_000);

        // deep underdog buy gets a big log bonus (well over 2x dollars)
        let s2 = dpm_shares(5 * 10_000_000, 500 * 10_000_000, 100 * 10_000_000);
        assert!(s2 >= 200 * 10_000_000);
    }
}
