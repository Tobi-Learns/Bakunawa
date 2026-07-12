//! Bakunawa — dominance parimutuel market contract (v4 + 1.13 unified shares).
//!
//! One shared pool per market. Every buy — regular OR conviction — is priced
//! through the SAME dynamic path (DPM): USDC in, share out, priced against the
//! side's cumulative-at-least money `C_i(m)` = money at rungs >= m. Two
//! instrument classes differ only in the LOCK, not the mechanism:
//! - REGULAR predictions (rung 0): per-side ticket tokens (classic assets
//!   pre-minted into custody at listing) — freely tradable on the DEX; trades
//!   move claims, never cash; settlement pays whoever HOLDS tickets, via
//!   `redeem`. `C_i(0)` = the side's whole stake.
//! - CONVICTIONS (rung >= 1): winner + minimum margin, LOCKED at entry (no
//!   exit/transfer), all-or-nothing; wins iff correct side AND actual margin >=
//!   rung (exact hit wins). Share-denominated too; claimed via `claim`. Deeper
//!   rung -> smaller `C_i(m)` -> cheaper -> more shares/$ (the rarity reward is
//!   in the buy price, not a settlement multiplier).
//!
//! Settlement is ONE uniform share split (no cross-class pass): every winning
//! share (regular + convictions with rung <= margin) takes an equal slice of the
//! raked losing pool; dead deeper rungs bank. Regular shares are fungible, so
//! `redeem` pays the class-average money-backing per share; convictions are
//! locked, so `claim` returns the own stake — both plus `shares/SumShares * dist`.
//!
//!   redeem  = amount * RegMoney/RegShares  +  amount * dist/SumShares
//!   claim_i = Stake_i                      +  Shares_i * dist/SumShares
//!   dist    = LosingPool - Rake  (S1: 3% off the losing pool)
//!
//! Reduces identically to the D2 Neutral DPM on pure-regular pools. Solvent by
//! construction: shares set only proportions, never the distributable total.
//! All payouts pull-based; integer dust stays in the contract. Reference:
//! sim/unified.py `worked_example()` — test.rs replicates it exactly.

#![no_std]

mod dpm;
mod reflector;
mod types;

use reflector::{ReflectorAsset, ReflectorClient};
use soroban_sdk::{
    contract, contractimpl, panic_with_error, contracterror, token, Address, Env, Symbol, Vec,
};
use types::{DataKey, LadderRow, Market, MarketParams, MarketStatus, OracleKind, Outcome, Position};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    MarketExists = 3,
    MarketNotFound = 4,
    MarketNotOpen = 5,
    PredictionsClosed = 6,
    InvalidRung = 7,
    InvalidAmount = 8,
    InvalidSide = 9,
    TooEarlyToSettle = 10,
    PriceUnavailable = 11,
    NothingToClaim = 12,
    NotSettled = 13,
    InvalidConfig = 14,
}

#[contract]
pub struct Bakunawa;

#[contractimpl]
impl Bakunawa {
    pub fn initialize(env: Env, admin: Address, token: Address, treasury: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().extend_ttl(518_400, 518_400); // ~30 days
    }

    /// List a market (curated model: admin only). `params.id` is a
    /// caller-supplied Snowflake u64, asserted unique. For Reflector markets
    /// the baseline price is snapshotted from the feed at listing time.
    pub fn create_market(env: Env, params: MarketParams) {
        let admin = admin(&env);
        admin.require_auth();
        let id = params.id;
        if env.storage().persistent().has(&DataKey::Market(id)) {
            panic_with_error!(&env, Error::MarketExists);
        }
        if params.close_ts > params.settle_ts || params.rake_bps > 10_000 || params.min_pool < 0 {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        let mut prev = 0u32;
        for r in params.rungs.iter() {
            if r == 0 || r <= prev {
                panic_with_error!(&env, Error::InvalidConfig); // ascending, no 0
            }
            prev = r;
        }
        let baseline = match params.oracle {
            OracleKind::Reflector => {
                let c = ReflectorClient::new(&env, &params.feed);
                match c.lastprice(&ReflectorAsset::Other(params.asset.clone())) {
                    Some(p) => p.price,
                    None => panic_with_error!(&env, Error::PriceUnavailable),
                }
            }
            OracleKind::Admin => 0,
        };
        let market = Market {
            id,
            side_a: params.side_a,
            side_b: params.side_b,
            rungs: params.rungs,
            close_ts: params.close_ts,
            settle_ts: params.settle_ts,
            oracle: params.oracle,
            feed: params.feed,
            asset: params.asset,
            baseline,
            rake_bps: params.rake_bps,
            min_pool: params.min_pool,
            ticket_a: params.ticket_a,
            ticket_b: params.ticket_b,
            status: MarketStatus::Open,
        };
        env.storage().persistent().set(&DataKey::Market(id), &market);
        env.events()
            .publish((Symbol::new(&env, "create"), id), baseline);
    }

    /// REGULAR prediction (v4 + D2): mint tradable pool tickets at a DYNAMIC
    /// price. `amount` USDC enters the pot; the predictor receives
    /// `dpm_shares(M_side, M_other, amount)` side tickets from the contract's
    /// pre-minted custody — priced at the side's money-share, so the heavier
    /// side costs more per share (kills the par-mint snipe, rewards early
    /// money). Price uses PRE-mint side money. Tickets are ordinary classic
    /// assets — trade them on the DEX; settlement pays whoever holds them
    /// (redeem). Minting is rejected at/after `close_ts` (S3).
    pub fn mint_tickets(env: Env, predictor: Address, id: u64, side: u32, amount: i128) {
        predictor.require_auth();
        let market = get_market(&env, id);
        require_open_entry(&env, &market, side, amount);

        // dynamic share count from pre-mint side money (SideStake = reg + conv)
        let m_side = side_stake(&env, id, side);
        let m_other = side_stake(&env, id, 1 - side);
        let shares = dpm::dpm_shares(m_side, m_other, amount);

        token::Client::new(&env, &stake_token(&env)).transfer(
            &predictor,
            &env.current_contract_address(),
            &amount,
        );
        token::Client::new(&env, &ticket_for(&market, side)).transfer(
            &env.current_contract_address(),
            &predictor,
            &shares,
        );

        // money aggregate (pot accounting) and share aggregate (redeem split)
        let reg_key = DataKey::Regular(id, side);
        let reg: i128 = env.storage().persistent().get(&reg_key).unwrap_or(0);
        env.storage().persistent().set(&reg_key, &(reg + amount));
        let sh_key = DataKey::RegularShares(id, side);
        let sh: i128 = env.storage().persistent().get(&sh_key).unwrap_or(0);
        env.storage().persistent().set(&sh_key, &(sh + shares));
        bump_side_stake(&env, id, side, amount);

        env.events().publish(
            (Symbol::new(&env, "mint"), id, predictor),
            (side, amount, shares),
        );
    }

    /// CONVICTION (v4 + 1.13): winner + minimum margin, locked at entry — no
    /// exit, no transfer, all-or-nothing. SHARE-denominated like a regular buy
    /// (the unified model): the stake is DPM-priced into shares against the
    /// side's cumulative-at-least money `C_i(rung)` = conviction money at rungs
    /// >= rung. Deeper rungs have smaller `C_i` -> cheaper -> more shares/$: the
    /// rarity reward now lives in the buy price, not a settlement multiplier.
    /// The only difference from a regular mint is the LOCK (no ticket token, no
    /// exit). Rejected at/after `close_ts` (S3).
    pub fn place_conviction(
        env: Env,
        predictor: Address,
        id: u64,
        side: u32,
        rung: u32,
        amount: i128,
    ) {
        predictor.require_auth();
        let market = get_market(&env, id);
        require_open_entry(&env, &market, side, amount);
        if rung == 0 || !market.rungs.contains(rung) {
            panic_with_error!(&env, Error::InvalidRung);
        }

        // DPM price against C_i(rung) (pre-buy): cumulative-at-least conviction
        // money on the side, vs the rest of the pool. Reduces to the regular
        // formula at rung 0 (C = side total); a cold rung bootstraps at par.
        let c = s_of(&env, &market, side, rung);
        let total = side_stake(&env, id, 0) + side_stake(&env, id, 1);
        let shares = dpm::dpm_shares(c, total - c, amount);

        token::Client::new(&env, &stake_token(&env)).transfer(
            &predictor,
            &env.current_contract_address(),
            &amount,
        );

        let agg_key = DataKey::Agg(id, side, rung);
        let agg: i128 = env.storage().persistent().get(&agg_key).unwrap_or(0);
        env.storage().persistent().set(&agg_key, &(agg + amount));
        let ash_key = DataKey::AggShares(id, side, rung);
        let ash: i128 = env.storage().persistent().get(&ash_key).unwrap_or(0);
        env.storage().persistent().set(&ash_key, &(ash + shares));
        bump_side_stake(&env, id, side, amount);

        let pos_key = DataKey::Pos(id, predictor.clone());
        let mut positions: Vec<Position> = env
            .storage()
            .persistent()
            .get(&pos_key)
            .unwrap_or(Vec::new(&env));
        positions.push_back(Position {
            side,
            rung,
            stake: amount,
            shares,
            claimed: false,
        });
        env.storage().persistent().set(&pos_key, &positions);

        env.events().publish(
            (Symbol::new(&env, "conviction"), id, predictor),
            (side, rung, amount, shares),
        );
    }

    /// Redeem winning-side tickets after settlement (or any side's at par
    /// after cancellation). Pays whoever HOLDS the tickets — including buyers
    /// on the DEX who never staked. Tickets return to contract custody.
    pub fn redeem(env: Env, holder: Address, id: u64, side: u32, amount: i128) -> i128 {
        holder.require_auth();
        let market = get_market(&env, id);
        if side > 1 {
            panic_with_error!(&env, Error::InvalidSide);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        // Regular shares are dynamically priced (D2), so a ticket represents a
        // pool CLAIM, not $1. Redeem splits the regular class's value by share
        // count. Both paths reduce to the old par behaviour when shares==money.
        let reg_money = regular(&env, id, side);
        let reg_shares = regular_shares(&env, id, side);
        let payout = match market.status {
            MarketStatus::Open => panic_with_error!(&env, Error::NotSettled),
            MarketStatus::Cancelled => {
                // full refund = the money backing each share (never par, or
                // shares > dollars would over-pay and break solvency)
                if reg_shares <= 0 {
                    panic_with_error!(&env, Error::NothingToClaim);
                }
                amount * reg_money / reg_shares
            }
            MarketStatus::Settled => {
                let outcome: Outcome = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Outcome(id))
                    .unwrap();
                if side != outcome.winner {
                    panic_with_error!(&env, Error::NothingToClaim);
                }
                if outcome.reg_shares_winner <= 0 {
                    panic_with_error!(&env, Error::NothingToClaim);
                }
                let dist = outcome.losing_pool - outcome.rake_amount;
                // Unified split (1.13): each regular share gets the class-average
                // money-backing (fungible/tradable — holder may != buyer) plus a
                // uniform slice of the raked losing pool by share count.
                amount * outcome.reg_money_winner / outcome.reg_shares_winner
                    + amount * dist / outcome.sum_shares
            }
        };
        // pull the tickets back into custody, pay from the pot
        token::Client::new(&env, &ticket_for(&market, side)).transfer(
            &holder,
            &env.current_contract_address(),
            &amount,
        );
        token::Client::new(&env, &stake_token(&env)).transfer(
            &env.current_contract_address(),
            &holder,
            &payout,
        );
        env.events()
            .publish((Symbol::new(&env, "redeem"), id, holder), (side, amount, payout));
        payout
    }

    /// Admin-oracle settlement (MVP sports path): curator posts the result.
    pub fn settle_admin(env: Env, id: u64, winner: u32, margin: u32) {
        admin(&env).require_auth();
        let market = get_market(&env, id);
        if market.oracle != OracleKind::Admin {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        if winner > 1 {
            panic_with_error!(&env, Error::InvalidSide);
        }
        require_settleable(&env, &market);
        settle_inner(&env, market, winner, margin);
    }

    /// Reflector settlement (crypto markets) — permissionless trigger.
    /// Reads the feed price at `settle_ts` (aligned to feed resolution),
    /// margin = |% move| from the listing baseline in hundredths of a percent
    /// (rounded half-up). Exactly 0.00% => cancelled, full refunds.
    pub fn settle_oracle(env: Env, id: u64) {
        let market = get_market(&env, id);
        if market.oracle != OracleKind::Reflector {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        require_settleable(&env, &market);
        let c = ReflectorClient::new(&env, &market.feed);
        let resolution = c.resolution() as u64;
        let ts = market.settle_ts - market.settle_ts % resolution;
        let price = match c.price(&ReflectorAsset::Other(market.asset.clone()), &ts) {
            Some(p) => p.price,
            None => panic_with_error!(&env, Error::PriceUnavailable),
        };
        let b = market.baseline;
        let diff = price - b;
        // |diff| * 10000 / b, rounded half-up => hundredths of a percent
        let move_units = ((diff.abs() * 10_000) + b / 2) / b;
        if move_units == 0 {
            cancel_inner(&env, market);
            return;
        }
        let winner = if diff > 0 { 0u32 } else { 1u32 };
        settle_inner(&env, market, winner, move_units as u32);
    }

    /// Cancel (postponement past deadline, abandoned event, or manual
    /// viability call). Full refunds via claim, no rake.
    pub fn cancel_market(env: Env, id: u64) {
        admin(&env).require_auth();
        let market = get_market(&env, id);
        if market.status != MarketStatus::Open {
            panic_with_error!(&env, Error::MarketNotOpen);
        }
        cancel_inner(&env, market);
    }

    /// Pull-based CONVICTION claim: pays out all of the caller's unclaimed
    /// winning convictions (Settled) or refunds all unclaimed conviction
    /// stakes (Cancelled). Regular tickets use `redeem` instead.
    pub fn claim(env: Env, predictor: Address, id: u64) -> i128 {
        predictor.require_auth();
        let market = get_market(&env, id);
        let pos_key = DataKey::Pos(id, predictor.clone());
        let positions: Vec<Position> = env
            .storage()
            .persistent()
            .get(&pos_key)
            .unwrap_or(Vec::new(&env));
        let mut updated: Vec<Position> = Vec::new(&env);
        let mut payout: i128 = 0;

        match market.status {
            MarketStatus::Cancelled => {
                for p in positions.iter() {
                    if !p.claimed {
                        payout += p.stake;
                    }
                    updated.push_back(Position { claimed: true, ..p });
                }
            }
            MarketStatus::Settled => {
                let outcome: Outcome = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Outcome(id))
                    .unwrap();
                let dist = outcome.losing_pool - outcome.rake_amount;
                for p in positions.iter() {
                    let won = p.side == outcome.winner && p.rung <= outcome.margin;
                    if won && !p.claimed {
                        // Unified split (1.13): own stake back + a uniform slice of
                        // the raked losing pool by this conviction's DPM shares.
                        payout += p.stake + p.shares * dist / outcome.sum_shares;
                        updated.push_back(Position { claimed: true, ..p });
                    } else {
                        updated.push_back(p);
                    }
                }
            }
            MarketStatus::Open => panic_with_error!(&env, Error::NotSettled),
        }

        if payout <= 0 {
            panic_with_error!(&env, Error::NothingToClaim);
        }
        env.storage().persistent().set(&pos_key, &updated);
        token::Client::new(&env, &stake_token(&env)).transfer(
            &env.current_contract_address(),
            &predictor,
            &payout,
        );
        env.events()
            .publish((Symbol::new(&env, "claim"), id, predictor), payout);
        payout
    }

    // --- Views (the UI computes implied payouts from these via RPC) ---

    pub fn get_market(env: Env, id: u64) -> Market {
        get_market(&env, id)
    }

    pub fn get_outcome(env: Env, id: u64) -> Outcome {
        env.storage()
            .persistent()
            .get(&DataKey::Outcome(id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotSettled))
    }

    /// Full stake ladder: rung 0 = REGULAR (ticket-minted) stake per side,
    /// higher rungs = conviction stakes.
    pub fn get_ladder(env: Env, id: u64) -> Vec<LadderRow> {
        let market = get_market(&env, id);
        let mut rows: Vec<LadderRow> = Vec::new(&env);
        for side in 0u32..2 {
            rows.push_back(LadderRow {
                side,
                rung: 0,
                stake: regular(&env, id, side),
                shares: regular_shares(&env, id, side),
            });
            for r in market.rungs.iter() {
                rows.push_back(LadderRow {
                    side,
                    rung: r,
                    stake: agg(&env, id, side, r),
                    shares: agg_shares(&env, id, side, r),
                });
            }
        }
        rows
    }

    pub fn get_positions(env: Env, id: u64, predictor: Address) -> Vec<Position> {
        env.storage()
            .persistent()
            .get(&DataKey::Pos(id, predictor))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_side_stake(env: Env, id: u64, side: u32) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::SideStake(id, side))
            .unwrap_or(0)
    }
}

// --- Internals ---

fn admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn stake_token(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Token).unwrap()
}

fn get_market(env: &Env, id: u64) -> Market {
    env.storage()
        .persistent()
        .get(&DataKey::Market(id))
        .unwrap_or_else(|| panic_with_error!(env, Error::MarketNotFound))
}

fn agg(env: &Env, id: u64, side: u32, rung: u32) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Agg(id, side, rung))
        .unwrap_or(0)
}

fn regular(env: &Env, id: u64, side: u32) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Regular(id, side))
        .unwrap_or(0)
}

fn regular_shares(env: &Env, id: u64, side: u32) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::RegularShares(id, side))
        .unwrap_or(0)
}

fn agg_shares(env: &Env, id: u64, side: u32, rung: u32) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::AggShares(id, side, rung))
        .unwrap_or(0)
}

fn side_stake(env: &Env, id: u64, side: u32) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::SideStake(id, side))
        .unwrap_or(0)
}

fn ticket_for(market: &Market, side: u32) -> Address {
    if side == 0 {
        market.ticket_a.clone()
    } else {
        market.ticket_b.clone()
    }
}

fn bump_side_stake(env: &Env, id: u64, side: u32, amount: i128) {
    let key = DataKey::SideStake(id, side);
    let ss: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    env.storage().persistent().set(&key, &(ss + amount));
}

fn require_open_entry(env: &Env, market: &Market, side: u32, amount: i128) {
    if market.status != MarketStatus::Open {
        panic_with_error!(env, Error::MarketNotOpen);
    }
    if env.ledger().timestamp() >= market.close_ts {
        panic_with_error!(env, Error::PredictionsClosed);
    }
    if side > 1 {
        panic_with_error!(env, Error::InvalidSide);
    }
    if amount <= 0 {
        panic_with_error!(env, Error::InvalidAmount);
    }
}

/// S(m): total stake on `side` at threshold >= m (rung 0 => whole side).
fn s_of(env: &Env, market: &Market, side: u32, m: u32) -> i128 {
    if m == 0 {
        return env
            .storage()
            .persistent()
            .get(&DataKey::SideStake(market.id, side))
            .unwrap_or(0);
    }
    let mut total: i128 = 0;
    for r in market.rungs.iter() {
        if r >= m {
            total += agg(env, market.id, side, r);
        }
    }
    total
}

fn require_settleable(env: &Env, market: &Market) {
    if market.status != MarketStatus::Open {
        panic_with_error!(env, Error::MarketNotOpen);
    }
    if env.ledger().timestamp() < market.settle_ts {
        panic_with_error!(env, Error::TooEarlyToSettle);
    }
}

fn settle_inner(env: &Env, mut market: Market, winner: u32, margin: u32) {
    let id = market.id;
    let side_a: i128 = env
        .storage()
        .persistent()
        .get(&DataKey::SideStake(id, 0))
        .unwrap_or(0);
    let side_b: i128 = env
        .storage()
        .persistent()
        .get(&DataKey::SideStake(id, 1))
        .unwrap_or(0);
    let total = side_a + side_b;

    // Viability (S5): empty side or under-min pool at settlement => cancel.
    if side_a == 0 || side_b == 0 || total < market.min_pool {
        cancel_inner(env, market);
        return;
    }

    // Unified share split (1.13): winners = the winning side's REGULAR shares
    // plus every winning conviction rung's shares (rung <= margin). Every
    // winning share splits the raked losing pool uniformly — no DemandMult, no
    // cross-class pass. `winning_money` (their stake) is what they get back;
    // the rest of the pool (dead deeper rungs + losers) is the losing pool.
    let reg_money = regular(env, id, winner);
    let reg_shares = regular_shares(env, id, winner);
    let mut sum_shares: i128 = reg_shares;
    let mut winning_money: i128 = reg_money;
    for r in market.rungs.iter() {
        if r <= margin {
            let a = agg(env, id, winner, r);
            if a > 0 {
                winning_money += a;
                sum_shares += agg_shares(env, id, winner, r);
            }
        }
    }

    // No winning shares at all (e.g. the winning side held only unmet dominance
    // rungs and no regular): listing this as "settled" would be theater => cancel.
    if sum_shares == 0 {
        cancel_inner(env, market);
        return;
    }

    let losing_pool = total - winning_money;
    let rake_amount = losing_pool * (market.rake_bps as i128) / 10_000;
    if rake_amount > 0 {
        let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
        token::Client::new(env, &stake_token(env)).transfer(
            &env.current_contract_address(),
            &treasury,
            &rake_amount,
        );
    }

    let outcome = Outcome {
        winner,
        margin,
        losing_pool,
        rake_amount,
        sum_shares,
        reg_money_winner: reg_money,
        reg_shares_winner: reg_shares,
    };
    env.storage().persistent().set(&DataKey::Outcome(id), &outcome);
    market.status = MarketStatus::Settled;
    env.storage().persistent().set(&DataKey::Market(id), &market);
    env.events()
        .publish((Symbol::new(env, "settle"), id), (winner, margin));
}

fn cancel_inner(env: &Env, mut market: Market) {
    let id = market.id;
    market.status = MarketStatus::Cancelled;
    env.storage().persistent().set(&DataKey::Market(id), &market);
    env.events().publish((Symbol::new(env, "cancel"), id), ());
}

#[cfg(test)]
mod test;
