use soroban_sdk::{contracttype, Address, Symbol, Vec};

/// How a market's result is determined.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum OracleKind {
    /// Curator posts (winner, margin) — MVP path for sports.
    Admin,
    /// Reflector price feed settles trustlessly (crypto % move markets).
    Reflector,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum MarketStatus {
    Open,
    /// Admin oracle only (Phase 2): a result is posted and the dispute window
    /// is running. Claims/redeems are frozen; `finalize` moves it to Settled.
    /// Reflector markets never pass through here (they settle instantly).
    Proposed,
    Settled,
    Cancelled,
}

/// Market definition (v4). Sides are indexed 0 (side_a) and 1 (side_b).
/// Margins are integers in "margin units": points for sports, hundredths of
/// a percent for crypto moves.
///
/// Two instrument classes share the pot:
/// - REGULAR predictions: par-minted per-side ticket tokens (`ticket_a/b` are
///   the SACs of classic assets pre-minted into this contract's custody at
///   listing) — freely tradable on the DEX, settled to whoever HOLDS them.
/// - CONVICTIONS: locked positions on rungs >= 1, all-or-nothing, weighted by
///   DemandMult at settlement.
///
/// Per S7 (2026-07-08): settlement weights are always demand-based; any stats
/// curve is off-chain display metadata and never enters this contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Market {
    pub id: u64,
    pub side_a: Symbol,
    pub side_b: Symbol,
    pub rungs: Vec<u32>,       // listed conviction rungs, ascending, no 0
    pub close_ts: u64,         // lock: no minting/convictions at/after (S3)
    pub settle_ts: u64,        // measurement / event-end timestamp
    pub oracle: OracleKind,
    pub feed: Address,         // Reflector contract (== contract's own address for Admin markets, unused)
    pub asset: Symbol,         // Reflector asset symbol, e.g. "BTC" (unused for Admin)
    pub baseline: i128,        // price snapshot at listing (Reflector markets)
    pub rake_bps: u32,         // e.g. 300 = 3% of the losing pool (S1)
    pub min_pool: i128,        // viability threshold at settlement (S5)
    pub ticket_a: Address,     // side-0 ticket SAC (classic asset, pre-minted here)
    pub ticket_b: Address,     // side-1 ticket SAC
    pub dispute_secs: u64,     // Admin oracle: dispute-window length (Phase 2; 0 for Reflector)
    pub dispute_bond_bps: u32, // Admin oracle: bond = max(FLOOR, bps * pool) (Phase 2)
    pub status: MarketStatus,
}

/// `create_market` arguments (Soroban caps functions at 10 parameters).
#[contracttype]
#[derive(Clone, Debug)]
pub struct MarketParams {
    pub id: u64,
    pub side_a: Symbol,
    pub side_b: Symbol,
    pub rungs: Vec<u32>,
    pub close_ts: u64,
    pub settle_ts: u64,
    pub oracle: OracleKind,
    pub feed: Address,
    pub asset: Symbol,
    pub rake_bps: u32,
    pub min_pool: i128,
    pub ticket_a: Address,
    pub ticket_b: Address,
    pub dispute_secs: u64,     // Admin oracle only (Phase 2); ignored for Reflector
    pub dispute_bond_bps: u32, // Admin oracle only (Phase 2); ignored for Reflector
}

/// Written once at settlement; claims/redeems are computed from this + the
/// aggregates (never recomputed from the outcome side). Unified share model
/// (1.13): every winning share splits the raked losing pool uniformly.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Outcome {
    pub winner: u32,             // 0 = side_a, 1 = side_b
    pub margin: u32,             // actual margin in margin units
    pub losing_pool: i128,
    pub rake_amount: i128,       // transferred to treasury at settlement
    pub sum_shares: i128,        // total WINNING shares (regular + winning convictions)
    pub reg_money_winner: i128,  // regular money on the winning side (redeem money-back)
    pub reg_shares_winner: i128, // regular shares on the winning side (redeem denominator)
}

/// One conviction (rung >= 1 always — regular predictions are ticket tokens,
/// not positions). Locked/non-transferable, but SHARE-denominated (1.13): the
/// stake is DPM-priced into `shares` at entry, which set the settlement split.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    pub side: u32,
    pub rung: u32,
    pub stake: i128,  // USDC put in (returned to the holder if it wins)
    pub shares: i128, // DPM shares minted at entry (the settlement weight)
    pub claimed: bool,
}

/// A posted-but-not-final result during the dispute window (Phase 2, Admin
/// oracle). `pool_at_propose` is frozen here so the dispute bond
/// (`max(FLOOR, bps * pool)`) can't be moved by post-propose activity.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub winner: u32,
    pub margin: u32,
    pub deadline: u64,         // dispute window ends at this ledger timestamp
    pub pool_at_propose: i128, // total pool at propose-time (bond base)
}

/// An open dispute against a `Proposal` (Phase 2). The bond is escrowed USDC
/// held OUTSIDE the pool aggregates — orthogonal to `settle_inner`, so
/// settlement math is unchanged. Resolved to treasury (upheld) or the disputer
/// (corrected). At most one is open per market.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Dispute {
    pub disputer: Address,
    pub bond: i128,
}

/// Ladder row for UI reads (implied payouts are computed client-side). Carries
/// both the money (`stake`) and the DPM `shares` at each rung (1.13).
#[contracttype]
#[derive(Clone, Debug)]
pub struct LadderRow {
    pub side: u32,
    pub rung: u32,
    pub stake: i128,
    pub shares: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,      // stake asset SAC (USDC)
    Treasury,   // rake destination
    Market(u64),
    Outcome(u64),
    /// (market) -> Proposal: posted result + dispute window (Phase 2, Admin)
    Proposal(u64),
    /// (market) -> Dispute: the single open dispute, if any (Phase 2)
    Dispute(u64),
    /// (market, side, rung>=1) -> total CONVICTION stake (money) at exactly this rung
    Agg(u64, u32, u32),
    /// (market, side, rung>=1) -> total CONVICTION SHARES at exactly this rung
    /// (1.13: convictions are DPM-priced; shares set the settlement split)
    AggShares(u64, u32, u32),
    /// (market, side) -> total stake on the side (regular + convictions)
    SideStake(u64, u32),
    /// (market, side) -> total REGULAR (ticket-minted) MONEY on the side
    Regular(u64, u32),
    /// (market, side) -> total REGULAR SHARES issued (== Regular money under
    /// par; > money under dynamic mint pricing / D2). Redeem splits the
    /// regular class's payout by this share count.
    RegularShares(u64, u32),
    /// (market, predictor) -> Vec<Position> (convictions only)
    Pos(u64, Address),
}
