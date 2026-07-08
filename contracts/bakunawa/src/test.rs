#![cfg(test)]
//! Contract tests. The hand-settled worked example (docs/Bakunawa-worked-example.md,
//! replicated by sim/engine.py) is the reference: scenarios 1-3 are asserted here
//! in stroops with a <=3-stroop integer-division dust tolerance, plus exact
//! conservation (payouts + rake + dust == pool).

use super::*;
use crate::reflector::{PriceData, ReflectorAsset};
use crate::types::{MarketParams, MarketStatus, OracleKind};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, Env,
};

const USDC: i128 = 10_000_000; // 7 decimals

// --- Mock Reflector feed ---

#[contract]
pub struct MockFeed;

#[contractimpl]
impl MockFeed {
    pub fn set(env: Env, price: i128, ts: u64) {
        env.storage().instance().set(&symbol_short!("p"), &price);
        env.storage().instance().set(&symbol_short!("t"), &ts);
    }
    pub fn lastprice(env: Env, _asset: ReflectorAsset) -> Option<PriceData> {
        let price: i128 = env.storage().instance().get(&symbol_short!("p"))?;
        let timestamp: u64 = env.storage().instance().get(&symbol_short!("t"))?;
        Some(PriceData { price, timestamp })
    }
    pub fn price(env: Env, asset: ReflectorAsset, _timestamp: u64) -> Option<PriceData> {
        Self::lastprice(env, asset)
    }
    pub fn resolution(_env: Env) -> u32 {
        300
    }
    pub fn decimals(_env: Env) -> u32 {
        14
    }
}

// --- Harness ---

struct Setup {
    env: Env,
    client: BakunawaClient<'static>,
    token: TokenClient<'static>,
    sac: StellarAssetClient<'static>,
    treasury: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(admin.clone());
    let contract_id = env.register(Bakunawa, ());
    let client = BakunawaClient::new(&env, &contract_id);
    client.initialize(&admin, &asset.address(), &treasury);
    let token = TokenClient::new(&env, &asset.address());
    let sac = StellarAssetClient::new(&env, &asset.address());
    Setup { env, client, token, sac, treasury }
}

/// The worked example: OKC vs SAS, 9 bettors, $1,000 pool.
/// Returns bettors in order A..I.
fn worked_example(s: &Setup, id: u64, rake_bps: u32) -> [Address; 9] {
    s.client.create_market(&MarketParams {
        id,
        side_a: symbol_short!("OKC"),
        side_b: symbol_short!("SAS"),
        rungs: vec![&s.env, 5u32, 10, 15, 20, 25, 30],
        close_ts: 1_000,
        settle_ts: 2_000,
        oracle: OracleKind::Admin,
        feed: s.client.address.clone(),
        asset: symbol_short!("NA"),
        rake_bps,
        min_pool: 0,
    });
    let specs: [(u32, u32, i128); 9] = [
        (0, 0, 200),  // A OKC winner-only
        (0, 5, 100),  // B OKC +5
        (0, 10, 100), // C OKC +10
        (0, 20, 100), // D OKC +20
        (0, 30, 50),  // E OKC +30
        (1, 0, 200),  // F SAS winner-only
        (1, 5, 100),  // G SAS +5
        (1, 15, 100), // H SAS +15
        (1, 25, 50),  // I SAS +25
    ];
    core::array::from_fn(|i| {
        let (side, rung, amt) = specs[i];
        let bettor = Address::generate(&s.env);
        s.sac.mint(&bettor, &(amt * USDC));
        s.client.place_bet(&bettor, &id, &side, &rung, &(amt * USDC));
        bettor
    })
}

fn assert_close(actual: i128, expected: i128, tol: i128, label: &str) {
    assert!(
        (actual - expected).abs() <= tol,
        "{label}: got {actual}, expected {expected}"
    );
}

// --- Worked example scenarios (the acceptance gate for settlement math) ---

#[test]
fn scenario_1_okc_by_12_demand() {
    let s = setup();
    let b = worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&1, &0, &12);

    // Engine reference: A 407.9207921, B 263.3663366, C 328.7128713 USDC
    let pay_a = s.client.claim(&b[0], &1);
    let pay_b = s.client.claim(&b[1], &1);
    let pay_c = s.client.claim(&b[2], &1);
    assert_close(pay_a, 4_079_207_921, 3, "A payout");
    assert_close(pay_b, 2_633_663_366, 3, "B payout");
    assert_close(pay_c, 3_287_128_712, 3, "C payout");

    // Dead dominance on the winning side (D, E) and the whole SAS side lose.
    for loser in [&b[3], &b[4], &b[5], &b[6], &b[7], &b[8]] {
        assert!(s.client.try_claim(loser, &1).is_err(), "loser must not claim");
    }

    // Conservation: pool == payouts + dust; dust bounded by winner count.
    let dust = s.token.balance(&s.client.address);
    assert_eq!(pay_a + pay_b + pay_c + dust, 1_000 * USDC);
    assert!(dust >= 0 && dust < 3, "dust {dust}");
}

#[test]
fn scenario_2_blowout_by_22() {
    let s = setup();
    let b = worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&1, &0, &22);
    // Engine ROIs: A +52.98%, B +83.25%, C +116.55%, D +194.25%
    assert_close(s.client.claim(&b[0], &1), 3_059_535_822, 3, "A");
    assert_close(s.client.claim(&b[1], &1), 1_832_492_431, 3, "B");
    assert_close(s.client.claim(&b[2], &1), 2_165_489_404, 3, "C");
    assert_close(s.client.claim(&b[3], &1), 2_942_482_340, 3, "D");
    assert!(s.client.try_claim(&b[4], &1).is_err()); // E (+30) died, banked
}

#[test]
fn scenario_3_long_shot_by_33() {
    let s = setup();
    let b = worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&1, &0, &33);
    // Everyone on OKC wins (nested thresholds); LosingPool = SAS side $450.
    // Engine: E ROI +331.37% (multiplier x11 != odds — pool-bounded).
    let pay_e = s.client.claim(&b[4], &1);
    assert_close(pay_e, 2_156_837_743, 3, "E payout");
    let mut total = pay_e;
    for w in [&b[0], &b[1], &b[2], &b[3]] {
        total += s.client.claim(w, &1);
    }
    let dust = s.token.balance(&s.client.address);
    assert_eq!(total + dust, 1_000 * USDC);
    assert!(dust < 5);
}

#[test]
fn exact_hit_wins() {
    let s = setup();
    let b = worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&1, &0, &5); // win by exactly 5
    assert!(s.client.claim(&b[1], &1) > 100 * USDC, "+5 exact hit must win");
    assert!(s.client.try_claim(&b[2], &1).is_err(), "+10 must lose on a 5-pt win");
}

#[test]
fn rake_comes_off_losing_pool() {
    let s = setup();
    let b = worked_example(&s, 1, 300); // 3% (S1)
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&1, &0, &12);
    // Rake = 3% of $600 = 18 USDC, transferred to treasury at settlement.
    assert_eq!(s.token.balance(&s.treasury), 18 * USDC);
    // Engine with rake: A payout 401.6831683 USDC.
    let pay_a = s.client.claim(&b[0], &1);
    assert_close(pay_a, 4_016_831_683, 3, "A raked payout");
    let pay_b = s.client.claim(&b[1], &1);
    let pay_c = s.client.claim(&b[2], &1);
    let dust = s.token.balance(&s.client.address);
    // Conservation with rake: payouts + rake + dust == total pool.
    assert_eq!(pay_a + pay_b + pay_c + 18 * USDC + dust, 1_000 * USDC);
    assert!(dust < 3, "dust {dust}");
}

// --- Lifecycle & guards ---

#[test]
fn bet_after_lock_rejected() {
    let s = setup();
    worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 1_000); // == close_ts
    let late = Address::generate(&s.env);
    s.sac.mint(&late, &(10 * USDC));
    assert!(s
        .client
        .try_place_bet(&late, &1, &0, &0, &(10 * USDC))
        .is_err());
}

#[test]
fn settle_before_settle_ts_rejected() {
    let s = setup();
    worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 1_500);
    assert!(s.client.try_settle_admin(&1, &0, &12).is_err());
}

#[test]
fn double_claim_rejected() {
    let s = setup();
    let b = worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&1, &0, &12);
    s.client.claim(&b[0], &1);
    assert!(s.client.try_claim(&b[0], &1).is_err(), "double claim");
}

#[test]
fn duplicate_market_id_rejected() {
    let s = setup();
    worked_example(&s, 1, 0);
    let r = s.client.try_create_market(&MarketParams {
        id: 1,
        side_a: symbol_short!("X"),
        side_b: symbol_short!("Y"),
        rungs: vec![&s.env, 5u32],
        close_ts: 1_000,
        settle_ts: 2_000,
        oracle: OracleKind::Admin,
        feed: s.client.address.clone(),
        asset: symbol_short!("NA"),
        rake_bps: 0,
        min_pool: 0,
    });
    assert!(r.is_err());
}

#[test]
fn cancel_refunds_in_full_no_rake() {
    let s = setup();
    let b = worked_example(&s, 1, 300);
    s.client.cancel_market(&1);
    let expected: [i128; 9] = [200, 100, 100, 100, 50, 200, 100, 100, 50];
    for (bettor, exp) in b.iter().zip(expected) {
        assert_eq!(s.client.claim(bettor, &1), exp * USDC);
    }
    assert_eq!(s.token.balance(&s.treasury), 0, "no rake on cancel");
    assert_eq!(s.token.balance(&s.client.address), 0, "full refunds");
}

#[test]
fn viability_empty_side_cancels() {
    let s = setup();
    s.client.create_market(&MarketParams {
        id: 7,
        side_a: symbol_short!("UP"),
        side_b: symbol_short!("DOWN"),
        rungs: vec![&s.env, 100u32],
        close_ts: 1_000,
        settle_ts: 2_000,
        oracle: OracleKind::Admin,
        feed: s.client.address.clone(),
        asset: symbol_short!("NA"),
        rake_bps: 300,
        min_pool: 0,
    });
    let solo = Address::generate(&s.env);
    s.sac.mint(&solo, &(50 * USDC));
    s.client.place_bet(&solo, &7, &0, &0, &(50 * USDC));
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&7, &0, &10); // empty DOWN side => cancel, not settle
    assert_eq!(s.client.get_market(&7).status, MarketStatus::Cancelled);
    assert_eq!(s.client.claim(&solo, &7), 50 * USDC);
}

#[test]
fn no_winning_positions_cancels() {
    let s = setup();
    s.client.create_market(&MarketParams {
        id: 8,
        side_a: symbol_short!("A"),
        side_b: symbol_short!("B"),
        rungs: vec![&s.env, 20u32],
        close_ts: 1_000,
        settle_ts: 2_000,
        oracle: OracleKind::Admin,
        feed: s.client.address.clone(),
        asset: symbol_short!("NA"),
        rake_bps: 0,
        min_pool: 0,
    });
    let x = Address::generate(&s.env);
    let y = Address::generate(&s.env);
    s.sac.mint(&x, &(100 * USDC));
    s.sac.mint(&y, &(100 * USDC));
    s.client.place_bet(&x, &8, &0, &20, &(100 * USDC)); // only a +20 on A
    s.client.place_bet(&y, &8, &1, &0, &(100 * USDC));
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&8, &0, &5); // A wins by 5: nobody wins => cancel
    assert_eq!(s.client.get_market(&8).status, MarketStatus::Cancelled);
    assert_eq!(s.client.claim(&x, &8), 100 * USDC);
    assert_eq!(s.client.claim(&y, &8), 100 * USDC);
}

#[test]
fn min_pool_viability_cancels() {
    let s = setup();
    s.client.create_market(&MarketParams {
        id: 9,
        side_a: symbol_short!("A"),
        side_b: symbol_short!("B"),
        rungs: vec![&s.env, 10u32],
        close_ts: 1_000,
        settle_ts: 2_000,
        oracle: OracleKind::Admin,
        feed: s.client.address.clone(),
        asset: symbol_short!("NA"),
        rake_bps: 300,
        min_pool: 1_000 * USDC, // min pool $1,000
    });
    for side in 0u32..2 {
        let b = Address::generate(&s.env);
        s.sac.mint(&b, &(10 * USDC));
        s.client.place_bet(&b, &9, &side, &0, &(10 * USDC));
    }
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&9, &0, &3);
    assert_eq!(s.client.get_market(&9).status, MarketStatus::Cancelled);
}

// --- Reflector oracle path ---

fn reflector_market(s: &Setup, id: u64, feed: &Address) -> (Address, Address, Address) {
    s.client.create_market(&MarketParams {
        id,
        side_a: symbol_short!("UP"),
        side_b: symbol_short!("DOWN"),
        rungs: vec![&s.env, 100u32, 300, 500], // 1%, 3%, 5% in hundredths
        close_ts: 1_000,
        settle_ts: 2_000,
        oracle: OracleKind::Reflector,
        feed: feed.clone(),
        asset: symbol_short!("BTC"),
        rake_bps: 300,
        min_pool: 0,
    });
    let mut out = [None, None, None];
    for (i, (side, rung, amt)) in [(0u32, 0u32, 100i128), (0, 500, 50), (1, 0, 100)]
        .iter()
        .enumerate()
    {
        let b = Address::generate(&s.env);
        s.sac.mint(&b, &(amt * USDC));
        s.client.place_bet(&b, &id, side, rung, &(amt * USDC));
        out[i] = Some(b);
    }
    (out[0].clone().unwrap(), out[1].clone().unwrap(), out[2].clone().unwrap())
}

#[test]
fn reflector_settles_up_move() {
    let s = setup();
    let feed_id = s.env.register(MockFeed, ());
    let feed = MockFeedClient::new(&s.env, &feed_id);
    feed.set(&6_000_000_000_000_000_000i128, &0); // $60,000 @ 14dp
    let (up0, up5, down0) = reflector_market(&s, 11, &feed_id);
    assert_eq!(s.client.get_market(&11).baseline, 6_000_000_000_000_000_000);

    feed.set(&6_300_000_000_000_000_000i128, &2_000); // +5.00%
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_oracle(&11);

    let out = s.client.get_outcome(&11);
    assert_eq!((out.winner, out.margin), (0, 500)); // UP by 5.00%
    assert!(s.client.claim(&up0, &11) > 100 * USDC);
    assert!(s.client.claim(&up5, &11) > 50 * USDC); // exact hit at +5.00%
    assert!(s.client.try_claim(&down0, &11).is_err());
    assert_eq!(s.token.balance(&s.treasury), 3 * USDC); // 3% of $100
}

#[test]
fn reflector_zero_move_cancels() {
    let s = setup();
    let feed_id = s.env.register(MockFeed, ());
    let feed = MockFeedClient::new(&s.env, &feed_id);
    feed.set(&6_000_000_000_000_000_000i128, &0);
    let (up0, ..) = reflector_market(&s, 12, &feed_id);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_oracle(&12); // price unchanged => 0.00% => cancel
    assert_eq!(s.client.get_market(&12).status, MarketStatus::Cancelled);
    assert_eq!(s.client.claim(&up0, &12), 100 * USDC);
}

// --- Views ---

#[test]
fn ladder_view_matches_stakes() {
    let s = setup();
    worked_example(&s, 1, 0);
    let ladder = s.client.get_ladder(&1);
    assert_eq!(ladder.len(), 14); // 2 sides x (winner-only + 6 rungs)
    let mut okc_total: i128 = 0;
    for row in ladder.iter() {
        if row.side == 0 {
            okc_total += row.stake;
        }
    }
    assert_eq!(okc_total, 550 * USDC);
    assert_eq!(s.client.get_side_stake(&1, &1), 450 * USDC);
}
