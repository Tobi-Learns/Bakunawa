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
    Settled,
    Cancelled,
}

/// Market definition. Sides are indexed 0 (side_a) and 1 (side_b).
/// Margins are integers in "margin units": points for sports, hundredths of
/// a percent for crypto moves. Rung 0 (winner-only) is always available and
/// never listed in `rungs`.
///
/// Per S7 (2026-07-08): settlement weights are always demand-based; any stats
/// curve is off-chain display metadata and never enters this contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Market {
    pub id: u64,
    pub side_a: Symbol,
    pub side_b: Symbol,
    pub rungs: Vec<u32>,       // listed dominance rungs, ascending, no 0
    pub close_ts: u64,         // lock: no bets at/after this time (S3)
    pub settle_ts: u64,        // measurement / event-end timestamp
    pub oracle: OracleKind,
    pub feed: Address,         // Reflector contract (== contract's own address for Admin markets, unused)
    pub asset: Symbol,         // Reflector asset symbol, e.g. "BTC" (unused for Admin)
    pub baseline: i128,        // price snapshot at listing (Reflector markets)
    pub rake_bps: u32,         // e.g. 300 = 3% of the losing pool (S1)
    pub min_pool: i128,        // viability threshold at settlement (S5)
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
}

/// Written once at settlement; claims are computed from this + the stake
/// aggregates (never recomputed from the outcome side).
#[contracttype]
#[derive(Clone, Debug)]
pub struct Outcome {
    pub winner: u32,           // 0 = side_a, 1 = side_b
    pub margin: u32,           // actual margin in margin units
    pub losing_pool: i128,
    pub rake_amount: i128,     // transferred to treasury at settlement
    pub sum_weights: i128,     // total winning weight
    pub winner_stake: i128,    // SideStake of the winning side (mult numerator)
}

/// One bet. A bettor may hold several positions per market.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    pub side: u32,
    pub rung: u32,             // 0 = winner-only
    pub stake: i128,
    pub claimed: bool,
}

/// Ladder row for UI reads (implied payouts are computed client-side).
#[contracttype]
#[derive(Clone, Debug)]
pub struct LadderRow {
    pub side: u32,
    pub rung: u32,
    pub stake: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,      // stake asset SAC (USDC)
    Treasury,   // rake destination
    Market(u64),
    Outcome(u64),
    /// (market, side, rung) -> total stake at exactly this rung (rung 0 incl.)
    Agg(u64, u32, u32),
    /// (market, side) -> total stake on the side
    SideStake(u64, u32),
    /// (market, bettor) -> Vec<Position>
    Pos(u64, Address),
}
