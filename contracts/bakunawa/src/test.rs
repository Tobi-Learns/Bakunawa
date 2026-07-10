#![cfg(test)]
//! Contract tests (v4). The hand-settled worked example is still the
//! settlement reference — v4 restores v2's shared-pool math, so the expected
//! numbers are unchanged; regular predictions (A, F) now enter via ticket
//! minting and exit via `redeem`, convictions via `place_conviction`/`claim`.
//! New v4 coverage: tickets that changed hands settle to the HOLDER,
//! mint-after-lock, losing-side redeem, cancel refunds via both paths.

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
const TICKET_SUPPLY: i128 = 1_000_000_000 * USDC;

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
    admin: Address,
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
    Setup { env, client, token, sac, admin, treasury }
}

/// Register a fresh ticket-token pair and pre-mint supply into the contract's
/// custody (the classic-asset pre-mint pattern from the 1.8a spike).
fn make_tickets(s: &Setup) -> (Address, Address) {
    let mut out = [None, None];
    for slot in out.iter_mut() {
        let t = s.env.register_stellar_asset_contract_v2(s.admin.clone());
        StellarAssetClient::new(&s.env, &t.address())
            .mint(&s.client.address, &TICKET_SUPPLY);
        *slot = Some(t.address());
    }
    (out[0].clone().unwrap(), out[1].clone().unwrap())
}

fn create_market(s: &Setup, id: u64, rungs: &[u32], oracle: OracleKind, feed: &Address,
                 rake_bps: u32, min_pool: i128) -> (Address, Address) {
    let (ticket_a, ticket_b) = make_tickets(s);
    let mut rung_vec = vec![&s.env];
    for r in rungs {
        rung_vec.push_back(*r);
    }
    s.client.create_market(&MarketParams {
        id,
        side_a: symbol_short!("OKC"),
        side_b: symbol_short!("SAS"),
        rungs: rung_vec,
        close_ts: 1_000,
        settle_ts: 2_000,
        oracle,
        feed: feed.clone(),
        asset: symbol_short!("BTC"),
        rake_bps,
        min_pool,
        ticket_a: ticket_a.clone(),
        ticket_b: ticket_b.clone(),
    });
    (ticket_a, ticket_b)
}

/// The worked example: OKC vs SAS, $1,000 pool. A and F are regular
/// (ticket-minting) predictors; the rest are convictions. Returns A..I.
fn worked_example(s: &Setup, id: u64, rake_bps: u32) -> ([Address; 9], Address, Address) {
    let (ta, tb) = create_market(s, id, &[5, 10, 15, 20, 25, 30], OracleKind::Admin,
                                 &s.client.address, rake_bps, 0);
    let specs: [(u32, u32, i128); 9] = [
        (0, 0, 200),  // A OKC regular (tickets)
        (0, 5, 100),  // B OKC +5
        (0, 10, 100), // C OKC +10
        (0, 20, 100), // D OKC +20
        (0, 30, 50),  // E OKC +30
        (1, 0, 200),  // F SAS regular (tickets)
        (1, 5, 100),  // G SAS +5
        (1, 15, 100), // H SAS +15
        (1, 25, 50),  // I SAS +25
    ];
    let who: [Address; 9] = core::array::from_fn(|i| {
        let (side, rung, amt) = specs[i];
        let p = Address::generate(&s.env);
        s.sac.mint(&p, &(amt * USDC));
        if rung == 0 {
            s.client.mint_tickets(&p, &id, &side, &(amt * USDC));
        } else {
            s.client.place_conviction(&p, &id, &side, &rung, &(amt * USDC));
        }
        p
    });
    (who, ta, tb)
}

fn assert_close(actual: i128, expected: i128, tol: i128, label: &str) {
    assert!(
        (actual - expected).abs() <= tol,
        "{label}: got {actual}, expected {expected}"
    );
}

// --- Worked example scenarios (settlement math unchanged under v4) ---

#[test]
fn scenario_1_okc_by_12() {
    let s = setup();
    let (p, ta, _tb) = worked_example(&s, 1, 0);
    // A holds 200 USDC of side-0 tickets
    assert_eq!(TokenClient::new(&s.env, &ta).balance(&p[0]), 200 * USDC);

    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&1, &0, &12);

    // Engine reference: A 407.9207921 (regular, via redeem), B 263.3663366,
    // C 328.7128713 USDC (convictions, via claim).
    let pay_a = s.client.redeem(&p[0], &1, &0, &(200 * USDC));
    let pay_b = s.client.claim(&p[1], &1);
    let pay_c = s.client.claim(&p[2], &1);
    assert_close(pay_a, 4_079_207_921, 3, "A payout");
    assert_close(pay_b, 2_633_663_366, 3, "B payout");
    assert_close(pay_c, 3_287_128_712, 3, "C payout");

    // Dead convictions (D, E) and the whole SAS side lose; F's tickets are
    // losing-side => redeem refuses.
    for loser in [&p[3], &p[4], &p[6], &p[7], &p[8]] {
        assert!(s.client.try_claim(loser, &1).is_err());
    }
    assert!(s.client.try_redeem(&p[5], &1, &1, &(200 * USDC)).is_err(), "losing tickets");

    // Conservation: USDC pool == payouts + dust.
    let dust = s.token.balance(&s.client.address);
    assert_eq!(pay_a + pay_b + pay_c + dust, 1_000 * USDC);
    assert!(dust >= 0 && dust < 3, "dust {dust}");
    // A's tickets are back in contract custody.
    assert_eq!(TokenClient::new(&s.env, &ta).balance(&s.client.address), TICKET_SUPPLY);
}

#[test]
fn scenario_3_long_shot_by_33() {
    let s = setup();
    let (p, ..) = worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&1, &0, &33);
    // Everyone on OKC wins. Engine: E +331.37% (multiplier != odds).
    let pay_e = s.client.claim(&p[4], &1);
    assert_close(pay_e, 2_156_837_743, 3, "E payout");
    let mut total = pay_e + s.client.redeem(&p[0], &1, &0, &(200 * USDC));
    for w in [&p[1], &p[2], &p[3]] {
        total += s.client.claim(w, &1);
    }
    let dust = s.token.balance(&s.client.address);
    assert_eq!(total + dust, 1_000 * USDC);
    assert!(dust < 5);
}

// --- v4-specific coverage ---

#[test]
fn traded_tickets_settle_to_the_holder() {
    let s = setup();
    let (p, ta, _) = worked_example(&s, 1, 0);
    // A sells half his tickets to X pre-lock (a DEX trade is just a token
    // transfer — the claim moves, the cash stays in the pot).
    let x = Address::generate(&s.env);
    TokenClient::new(&s.env, &ta).transfer(&p[0], &x, &(100 * USDC));

    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&1, &0, &12);

    // Each 100-ticket half redeems to half of A's reference payout.
    let pay_x = s.client.redeem(&x, &1, &0, &(100 * USDC));
    let pay_a = s.client.redeem(&p[0], &1, &0, &(100 * USDC));
    assert_close(pay_x, 4_079_207_921 / 2, 3, "X (buyer) payout");
    assert_close(pay_a, 4_079_207_921 / 2, 3, "A (seller kept half) payout");
    // A can't redeem more than he holds.
    assert!(s.client.try_redeem(&p[0], &1, &0, &(1 * USDC)).is_err());
}

#[test]
fn mint_and_conviction_rejected_after_lock() {
    let s = setup();
    let (_, ..) = worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 1_000);
    let late = Address::generate(&s.env);
    s.sac.mint(&late, &(10 * USDC));
    assert!(s.client.try_mint_tickets(&late, &1, &0, &(10 * USDC)).is_err());
    assert!(s.client.try_place_conviction(&late, &1, &0, &5, &(10 * USDC)).is_err());
}

#[test]
fn rung_zero_conviction_rejected() {
    let s = setup();
    worked_example(&s, 1, 0);
    let p = Address::generate(&s.env);
    s.sac.mint(&p, &(10 * USDC));
    assert!(s.client.try_place_conviction(&p, &1, &0, &0, &(10 * USDC)).is_err());
}

#[test]
fn rake_comes_off_losing_pool() {
    let s = setup();
    let (p, ..) = worked_example(&s, 1, 300); // 3% (S1)
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&1, &0, &12);
    assert_eq!(s.token.balance(&s.treasury), 18 * USDC); // 3% of $600
    // Engine with rake: A payout 401.6831683 USDC.
    let pay_a = s.client.redeem(&p[0], &1, &0, &(200 * USDC));
    assert_close(pay_a, 4_016_831_683, 3, "A raked payout");
    let pay_b = s.client.claim(&p[1], &1);
    let pay_c = s.client.claim(&p[2], &1);
    let dust = s.token.balance(&s.client.address);
    assert_eq!(pay_a + pay_b + pay_c + 18 * USDC + dust, 1_000 * USDC);
    assert!(dust < 3);
}

#[test]
fn cancel_refunds_tickets_at_par_and_convictions_in_full() {
    let s = setup();
    let (p, ..) = worked_example(&s, 1, 300);
    s.client.cancel_market(&1);
    // Regulars redeem at par (either side), convictions claim their stake.
    assert_eq!(s.client.redeem(&p[0], &1, &0, &(200 * USDC)), 200 * USDC);
    assert_eq!(s.client.redeem(&p[5], &1, &1, &(200 * USDC)), 200 * USDC);
    let expected: [i128; 7] = [100, 100, 100, 50, 100, 100, 50];
    for (i, exp) in [1usize, 2, 3, 4, 6, 7, 8].iter().zip(expected) {
        assert_eq!(s.client.claim(&p[*i], &1), exp * USDC);
    }
    assert_eq!(s.token.balance(&s.treasury), 0, "no rake on cancel");
    assert_eq!(s.token.balance(&s.client.address), 0, "full refunds");
}

#[test]
fn no_winning_positions_cancels() {
    let s = setup();
    let feed = s.client.address.clone();
    create_market(&s, 8, &[20], OracleKind::Admin, &feed, 0, 0);
    let x = Address::generate(&s.env);
    let y = Address::generate(&s.env);
    s.sac.mint(&x, &(100 * USDC));
    s.sac.mint(&y, &(100 * USDC));
    s.client.place_conviction(&x, &8, &0, &20, &(100 * USDC)); // only a +20 on A
    s.client.mint_tickets(&y, &8, &1, &(100 * USDC));
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&8, &0, &5); // A wins by 5: nobody wins => cancel
    assert_eq!(s.client.get_market(&8).status, MarketStatus::Cancelled);
    assert_eq!(s.client.claim(&x, &8), 100 * USDC);
    assert_eq!(s.client.redeem(&y, &8, &1, &(100 * USDC)), 100 * USDC);
}

#[test]
fn viability_empty_side_cancels() {
    let s = setup();
    let feed = s.client.address.clone();
    create_market(&s, 7, &[100], OracleKind::Admin, &feed, 300, 0);
    let solo = Address::generate(&s.env);
    s.sac.mint(&solo, &(50 * USDC));
    s.client.mint_tickets(&solo, &7, &0, &(50 * USDC));
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&7, &0, &10); // empty side B => cancel
    assert_eq!(s.client.get_market(&7).status, MarketStatus::Cancelled);
    assert_eq!(s.client.redeem(&solo, &7, &0, &(50 * USDC)), 50 * USDC);
}

// --- Reflector oracle path (unchanged mechanics, v4 entry points) ---

#[test]
fn reflector_settles_up_move_with_tickets() {
    let s = setup();
    let feed_id = s.env.register(MockFeed, ());
    let feed = MockFeedClient::new(&s.env, &feed_id);
    feed.set(&6_000_000_000_000_000_000i128, &0);
    create_market(&s, 11, &[100, 300, 500], OracleKind::Reflector, &feed_id, 300, 0);

    let up = Address::generate(&s.env);
    let up5 = Address::generate(&s.env);
    let down = Address::generate(&s.env);
    s.sac.mint(&up, &(100 * USDC));
    s.sac.mint(&up5, &(50 * USDC));
    s.sac.mint(&down, &(100 * USDC));
    s.client.mint_tickets(&up, &11, &0, &(100 * USDC));
    s.client.place_conviction(&up5, &11, &0, &500, &(50 * USDC));
    s.client.mint_tickets(&down, &11, &1, &(100 * USDC));

    feed.set(&6_300_000_000_000_000_000i128, &2_000); // +5.00%
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_oracle(&11);

    let out = s.client.get_outcome(&11);
    assert_eq!((out.winner, out.margin), (0, 500));
    assert!(s.client.redeem(&up, &11, &0, &(100 * USDC)) > 100 * USDC);
    assert!(s.client.claim(&up5, &11) > 50 * USDC); // exact hit
    assert!(s.client.try_redeem(&down, &11, &1, &(100 * USDC)).is_err());
    assert_eq!(s.token.balance(&s.treasury), 3 * USDC); // 3% of $100
}

// --- Views ---

#[test]
fn ladder_shows_regular_and_conviction_rows() {
    let s = setup();
    worked_example(&s, 1, 0);
    let ladder = s.client.get_ladder(&1);
    assert_eq!(ladder.len(), 14);
    let row0 = ladder.get(0).unwrap();
    assert_eq!((row0.side, row0.rung, row0.stake), (0, 0, 200 * USDC)); // regular
    assert_eq!(s.client.get_side_stake(&1, &0), 550 * USDC);
    assert_eq!(s.client.get_side_stake(&1, &1), 450 * USDC);
}

// --- Dynamic mint pricing (D2 / phase 1.12) ---

/// The dynamic-mint path (a second mint on a side is DPM-priced): the same $10
/// buys more shares EARLY (side light) than LATE (side heavy), so the early
/// buyer out-earns the late one — and the pool still conserves exactly.
#[test]
fn dpm_dynamic_mint_rewards_early_and_conserves() {
    let s = setup();
    let (ta, _tb) = create_market(&s, 20, &[10], OracleKind::Admin, &s.client.address, 0, 0);
    // bootstrap both sides at par (first mint per side, M_side == 0)
    let seed_a = Address::generate(&s.env);
    let seed_b = Address::generate(&s.env);
    s.sac.mint(&seed_a, &(50 * USDC));
    s.sac.mint(&seed_b, &(50 * USDC));
    s.client.mint_tickets(&seed_a, &20, &0, &(50 * USDC)); // OKC bootstrap
    s.client.mint_tickets(&seed_b, &20, &1, &(50 * USDC)); // SAS bootstrap (will lose)

    // early buys OKC at ~50c; crowd piles OKC; late buys the same $10 dear
    let early = Address::generate(&s.env);
    let crowd = Address::generate(&s.env);
    let late = Address::generate(&s.env);
    for a in [&early, &crowd, &late] {
        s.sac.mint(a, &(80 * USDC));
    }
    s.client.mint_tickets(&early, &20, &0, &(10 * USDC));
    s.client.mint_tickets(&crowd, &20, &0, &(80 * USDC));
    s.client.mint_tickets(&late, &20, &0, &(10 * USDC));

    let tok = TokenClient::new(&s.env, &ta);
    let sh_early = tok.balance(&early);
    let sh_late = tok.balance(&late);
    assert!(sh_early > sh_late, "early {sh_early} should exceed late {sh_late} shares");

    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.settle_admin(&20, &0, &10); // OKC wins by 10; SAS loses its $50

    let pay_early = s.client.redeem(&early, &20, &0, &sh_early);
    let pay_late = s.client.redeem(&late, &20, &0, &sh_late);
    assert!(pay_early > pay_late, "early {pay_early} should out-earn late {pay_late}");
    let pay_seed = s.client.redeem(&seed_a, &20, &0, &tok.balance(&seed_a));
    let pay_crowd = s.client.redeem(&crowd, &20, &0, &tok.balance(&crowd));

    // OKC (winner) sweeps the whole $200 pool; conservation holds.
    let dust = s.token.balance(&s.client.address);
    assert_eq!(pay_early + pay_late + pay_seed + pay_crowd + dust, 200 * USDC);
    assert!((0..10).contains(&dust), "dust {dust}");
    assert!(s.client.try_redeem(&seed_b, &20, &1, &(50 * USDC)).is_err(), "losing side");
}

/// Cancel with dynamically-priced shares: tickets are fungible, so a side's
/// whole money is refunded split by SHARE count (not par). Each side's total
/// clears exactly; a DPM-cheap buyer gets back more than they paid, a par
/// holder less — inherent to a fungible dynamic-priced claim.
#[test]
fn dpm_cancel_refunds_money_backing_by_share() {
    let s = setup();
    let (ta, _tb) = create_market(&s, 21, &[10], OracleKind::Admin, &s.client.address, 300, 0);
    let seed_a = Address::generate(&s.env);
    let seed_b = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);
    s.sac.mint(&seed_a, &(50 * USDC));
    s.sac.mint(&seed_b, &(50 * USDC));
    s.sac.mint(&buyer, &(20 * USDC));
    s.client.mint_tickets(&seed_a, &21, &0, &(50 * USDC)); // bootstrap OKC
    s.client.mint_tickets(&seed_b, &21, &1, &(50 * USDC)); // bootstrap SAS
    s.client.mint_tickets(&buyer, &21, &0, &(20 * USDC)); // dynamic: shares > $20

    let tok = TokenClient::new(&s.env, &ta);
    let sh_buyer = tok.balance(&buyer);
    assert!(sh_buyer > 20 * USDC, "dynamic mint should issue > $20 of shares");

    s.client.cancel_market(&21);
    let refund_buyer = s.client.redeem(&buyer, &21, &0, &sh_buyer);
    let refund_seed = s.client.redeem(&seed_a, &21, &0, &tok.balance(&seed_a));
    let refund_b = s.client.redeem(&seed_b, &21, &1, &(50 * USDC));

    // OKC's $70 and SAS's $50 each returned in full (split per share on OKC).
    assert_close(refund_buyer + refund_seed, 70 * USDC, 5, "OKC money returned");
    assert_close(refund_b, 50 * USDC, 5, "SAS par refund");
    assert!(refund_buyer > 20 * USDC, "cheap buyer's fungible shares are worth more");
    assert_eq!(s.token.balance(&s.treasury), 0, "no rake on cancel");
    assert!(s.token.balance(&s.client.address) < 10, "pot cleared modulo dust");
}
