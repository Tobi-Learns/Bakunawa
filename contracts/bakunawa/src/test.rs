#![cfg(test)]
//! Contract tests (v4 + 1.13 unified shares). Every buy is DPM-priced; the
//! reference is sim/unified.py `worked_example()` — replicated exactly in
//! `unified_worked_example_seeded_ladder`. The OKC/SAS scenarios still exercise
//! the settlement math, but under the unified model their convictions sit on
//! COLD rungs (one buyer each, shallow->deep), so they bootstrap at par
//! (shares==stake): payouts are exact integers, just flat (no depth reward
//! without a rung seed — the 1.13a finding). Coverage: DPM-priced convictions,
//! uniform share settlement, banking, traded tickets settle to the HOLDER,
//! after-lock rejection, losing-side redeem, cancel via both paths.

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
const DISPUTE_SECS: u64 = 500; // Admin-market dispute window used in tests (Phase 2)
const DISPUTE_BPS: u32 = 100; // 1% pool-proportional bond (2a default)

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
    // Admin markets run the optimistic oracle (need a positive window); Reflector
    // markets settle instantly and ignore the dispute fields.
    let dispute_secs = if oracle == OracleKind::Admin { DISPUTE_SECS } else { 0 };
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
        dispute_secs,
        dispute_bond_bps: DISPUTE_BPS,
    });
    (ticket_a, ticket_b)
}

/// Admin settlement is two-phase now (Phase 2, optimistic oracle): post the
/// result, let the window elapse undisputed, finalize. The prior tests called
/// `settle_admin` as one instant step — this helper preserves that shape.
/// Assumes the ledger is already at/after `settle_ts`.
fn settle_admin(s: &Setup, id: u64, winner: u32, margin: u32) {
    s.client.propose_result(&id, &winner, &margin);
    let secs = s.client.get_market(&id).dispute_secs;
    s.env.ledger().with_mut(|l| l.timestamp += secs + 1);
    s.client.finalize(&id);
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

/// Relative tolerance (in percent) — for DPM payouts that carry fixed-point-ln
/// error vs the float sim reference.
fn assert_rel(actual: i128, expected: i128, pct: i128, label: &str) {
    assert!(
        (actual - expected).abs() * 100 <= expected * pct,
        "{label}: got {actual}, expected ~{expected} (+/-{pct}%)"
    );
}

// --- Worked example scenarios (settlement math unchanged under v4) ---

#[test]
fn scenario_1_okc_by_12() {
    let s = setup();
    let (p, ta, _tb) = worked_example(&s, 1, 0);
    // A minted $200 at $0.50/share -> holds 400 shares
    assert_eq!(TokenClient::new(&s.env, &ta).balance(&p[0]), 400 * USDC);

    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    settle_admin(&s, 1, 0, 12);

    // Unified, cold rungs -> par ($0.50/share): winners A(reg 400sh), B(+5,200sh),
    // C(+10,200sh) split $600 losing pool by share. sum_shares=800; A = 200 +
    // 400*600/800 = 500; B = C = 100 + 200*600/800 = 250 (flat, no depth reward).
    let pay_a = s.client.redeem(&p[0], &1, &0, &(400 * USDC));
    let pay_b = s.client.claim(&p[1], &1);
    let pay_c = s.client.claim(&p[2], &1);
    assert_close(pay_a, 5_000_000_000, 3, "A payout");
    assert_close(pay_b, 2_500_000_000, 3, "B payout");
    assert_close(pay_c, 2_500_000_000, 3, "C payout");

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
    settle_admin(&s, 1, 0, 33);
    // Everyone on OKC wins; cold rungs -> par ($0.50/share). sum_shares =
    // 400+200+200+200+100 = 1100; dist = 450. E(+30, 100 par sh) = 50 +
    // 100*450/1100 = 90.909 USDC (flat ladder without a rung seed).
    let pay_e = s.client.claim(&p[4], &1);
    assert_close(pay_e, 909_090_909, 3, "E payout");
    let mut total = pay_e + s.client.redeem(&p[0], &1, &0, &(400 * USDC));
    for w in [&p[1], &p[2], &p[3]] {
        total += s.client.claim(w, &1);
    }
    let dust = s.token.balance(&s.client.address);
    assert_eq!(total + dust, 1_000 * USDC);
    assert!(dust < 5);
}

/// The canonical UNIFIED worked example — mirrors sim/unified.py
/// `worked_example()` exactly: house seed (Neutral both sides + a rung-
/// distributed UP seed), then ordered DPM buys, settle UP by 10 so the >=20
/// rung dies and banks. Validates the whole unified path: DPM-priced
/// convictions, the depth reward in the buy price, early > late at a rung, one
/// uniform share split, banking, losing side, and EXACT conservation.
#[test]
fn unified_worked_example_seeded_ladder() {
    let s = setup();
    let feed = s.client.address.clone();
    let (ta, _tb) = create_market(&s, 30, &[10, 20], OracleKind::Admin, &feed, 300, 0);

    let mint = |who: &Address, side: u32, amt: i128| {
        s.sac.mint(who, &amt);
        s.client.mint_tickets(who, &30, &side, &amt);
    };
    let convict = |who: &Address, side: u32, rung: u32, amt: i128| {
        s.sac.mint(who, &amt);
        s.client.place_conviction(who, &30, &side, &rung, &amt);
    };

    // Seed (par): UP Neutral 20, DOWN Neutral 20, UP>=10 4, UP>=20 2
    let hun = Address::generate(&s.env);
    mint(&hun, 0, 20 * USDC);
    let hdn = Address::generate(&s.env);
    mint(&hdn, 1, 20 * USDC);
    let h10 = Address::generate(&s.env);
    convict(&h10, 0, 10, 4 * USDC);
    let h20 = Address::generate(&s.env);
    convict(&h20, 0, 20, 2 * USDC);
    // Ordered buys (DPM is order-dependent)
    let p1 = Address::generate(&s.env);
    mint(&p1, 0, 10 * USDC); // UP Neutral
    let p2 = Address::generate(&s.env);
    convict(&p2, 0, 10, 10 * USDC); // early >=10
    let p3 = Address::generate(&s.env);
    convict(&p3, 0, 20, 10 * USDC); // >=20, will bank
    let p5 = Address::generate(&s.env);
    convict(&p5, 0, 10, 10 * USDC); // late >=10
    let p4 = Address::generate(&s.env);
    mint(&p4, 1, 20 * USDC); // DOWN Neutral

    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    settle_admin(&s, 30, 0, 10); // UP by 10: >=20 banks, DOWN loses

    // Convictions >=10 win; early out-earns late; the reference values (from the
    // float sim) hold to within fixed-point-ln tolerance.
    let pay_p2 = s.client.claim(&p2, &30);
    let pay_p5 = s.client.claim(&p5, &30);
    assert!(pay_p2 > pay_p5, "early >=10 {pay_p2} should beat late {pay_p5}");
    assert_rel(pay_p2, 298_774_000, 2, "P2 (early >=10) payout"); // 29.8774
    assert_rel(pay_p5, 188_447_000, 2, "P5 (late >=10) payout"); //  18.8447
    let pay_h10 = s.client.claim(&h10, &30);

    // >=20 rung is dead (banked) on the winning side — claims rejected.
    assert!(s.client.try_claim(&p3, &30).is_err(), ">=20 banked (p3)");
    assert!(s.client.try_claim(&h20, &30).is_err(), ">=20 banked (seed)");
    // DOWN loses; its tickets can't redeem.
    assert!(s.client.try_redeem(&p4, &30, &1, &(20 * USDC)).is_err(), "DOWN loses");

    // Regular UP holders redeem (class-average money-backing per share + slice).
    let tok = TokenClient::new(&s.env, &ta);
    let pay_p1 = s.client.redeem(&p1, &30, &0, &tok.balance(&p1));
    let pay_hun = s.client.redeem(&hun, &30, &0, &tok.balance(&hun));
    assert_rel(pay_p1, 143_221_000, 2, "P1 (UP Neutral) payout"); // 14.3221
    assert_rel(pay_hun, 347_025_000, 2, "seed UP Neutral payout"); // 34.7025

    // EXACT conservation: every payout + rake + dust == the $106 pool.
    let treasury = s.token.balance(&s.treasury);
    let dust = s.token.balance(&s.client.address);
    let paid = pay_p2 + pay_p5 + pay_h10 + pay_p1 + pay_hun;
    assert_eq!(paid + treasury + dust, 106 * USDC, "conservation");
    assert!(dust >= 0 && dust < 10, "dust {dust}");
}

// --- v4-specific coverage ---

#[test]
fn traded_tickets_settle_to_the_holder() {
    let s = setup();
    let (p, ta, _) = worked_example(&s, 1, 0);
    // A sells half his tickets to X pre-lock (a DEX trade is just a token
    // transfer — the claim moves, the cash stays in the pot).
    let x = Address::generate(&s.env);
    TokenClient::new(&s.env, &ta).transfer(&p[0], &x, &(200 * USDC));

    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    settle_admin(&s, 1, 0, 12);

    // A's full 400-share redeem is 500 USDC (unified), so each 200-share half
    // redeems to 250 — the claim follows the tickets regardless of who holds them.
    let pay_x = s.client.redeem(&x, &1, &0, &(200 * USDC));
    let pay_a = s.client.redeem(&p[0], &1, &0, &(200 * USDC));
    assert_close(pay_x, 2_500_000_000, 3, "X (buyer) payout");
    assert_close(pay_a, 2_500_000_000, 3, "A (seller kept half) payout");
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
    settle_admin(&s, 1, 0, 12);
    assert_eq!(s.token.balance(&s.treasury), 18 * USDC); // 3% of $600
    // Unified raked: dist = 600 - 18 = 582; sum_shares=800; A = 200 +
    // 400*582/800 = 491 USDC.
    let pay_a = s.client.redeem(&p[0], &1, &0, &(400 * USDC));
    assert_close(pay_a, 4_910_000_000, 3, "A raked payout");
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
    // Regulars redeem at par (either side; 400 shares -> $200 money-backing),
    // convictions claim their stake.
    assert_eq!(s.client.redeem(&p[0], &1, &0, &(400 * USDC)), 200 * USDC);
    assert_eq!(s.client.redeem(&p[5], &1, &1, &(400 * USDC)), 200 * USDC);
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
    settle_admin(&s, 8, 0, 5); // A wins by 5: nobody wins => cancel
    assert_eq!(s.client.get_market(&8).status, MarketStatus::Cancelled);
    assert_eq!(s.client.claim(&x, &8), 100 * USDC);
    assert_eq!(s.client.redeem(&y, &8, &1, &(200 * USDC)), 100 * USDC); // 200 sh -> $100
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
    settle_admin(&s, 7, 0, 10); // empty side B => cancel
    assert_eq!(s.client.get_market(&7).status, MarketStatus::Cancelled);
    assert_eq!(s.client.redeem(&solo, &7, &0, &(100 * USDC)), 50 * USDC); // 100 sh -> $50
}

// --- Reflector oracle path (unchanged mechanics, v4 entry points) ---

#[test]
fn reflector_settles_up_move_with_tickets() {
    let s = setup();
    let feed_id = s.env.register(MockFeed, ());
    let feed = MockFeedClient::new(&s.env, &feed_id);
    feed.set(&6_000_000_000_000_000_000i128, &0);
    create_market(&s, 11, &[100, 300, 500], OracleKind::Reflector, &feed_id, 300, 0);
    // Reflector markets settle instantly via settle_oracle — the optimistic
    // propose path is rejected on the wrong oracle kind (no dispute window).
    assert!(s.client.try_propose_result(&11, &0, &100).is_err(), "reflector: no propose path");

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
    assert!(s.client.redeem(&up, &11, &0, &(200 * USDC)) > 100 * USDC); // 200 sh
    assert!(s.client.claim(&up5, &11) > 50 * USDC); // exact hit
    assert!(s.client.try_redeem(&down, &11, &1, &(200 * USDC)).is_err());
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
    settle_admin(&s, 20, 0, 10); // OKC wins by 10; SAS loses its $50

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
    s.sac.mint(&seed_a, &(30 * USDC));
    s.sac.mint(&seed_b, &(50 * USDC));
    s.sac.mint(&buyer, &(20 * USDC));
    s.client.mint_tickets(&seed_a, &21, &0, &(30 * USDC)); // bootstrap OKC (underdog)
    s.client.mint_tickets(&seed_b, &21, &1, &(50 * USDC)); // bootstrap SAS
    s.client.mint_tickets(&buyer, &21, &0, &(20 * USDC)); // OKC is cheap => shares > $20

    let tok = TokenClient::new(&s.env, &ta);
    let sh_buyer = tok.balance(&buyer);
    assert!(sh_buyer > 20 * USDC, "buying the cheap side issues > $20 of shares");

    s.client.cancel_market(&21);
    let refund_buyer = s.client.redeem(&buyer, &21, &0, &sh_buyer);
    let refund_seed = s.client.redeem(&seed_a, &21, &0, &tok.balance(&seed_a));
    let refund_b = s.client.redeem(&seed_b, &21, &1, &(100 * USDC)); // 100 sh -> $50

    // OKC's $50 and SAS's $50 each returned in full (split per share on OKC).
    assert_close(refund_buyer + refund_seed, 50 * USDC, 5, "OKC money returned");
    assert_close(refund_b, 50 * USDC, 5, "SAS par refund");
    assert!(refund_buyer > 20 * USDC, "cheap buyer's fungible shares are worth more");
    assert_eq!(s.token.balance(&s.treasury), 0, "no rake on cancel");
    assert!(s.token.balance(&s.client.address) < 10, "pot cleared modulo dust");
}

// --- Phase 2: optimistic oracle (propose / dispute / resolve / finalize) ---

/// Happy path: post -> window -> finalize. Claims/redeems are frozen during
/// the window, and finalize is rejected before the window elapses.
#[test]
fn optimistic_finalize_happy_path() {
    let s = setup();
    let (p, _ta, _tb) = worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.propose_result(&1, &0, &12);
    assert_eq!(s.client.get_market(&1).status, MarketStatus::Proposed);

    // frozen during the dispute window
    assert!(s.client.try_claim(&p[1], &1).is_err(), "claim frozen in window");
    assert!(s.client.try_redeem(&p[0], &1, &0, &(400 * USDC)).is_err(), "redeem frozen");
    // can't finalize before the deadline (2000 + 500)
    assert!(s.client.try_finalize(&1).is_err(), "finalize before window");

    s.env.ledger().with_mut(|l| l.timestamp = 2_600);
    s.client.finalize(&1);
    assert_eq!(s.client.get_market(&1).status, MarketStatus::Settled);
    // settles exactly like the old instant path (scenario 1): A = $500
    assert_close(s.client.redeem(&p[0], &1, &0, &(400 * USDC)), 5_000_000_000, 3, "A after finalize");
}

/// A valid dispute corrects the result: bond refunded, window restarts, the
/// corrected winner is what finalizes.
#[test]
fn dispute_corrected_refunds_and_restarts() {
    let s = setup();
    let (p, ..) = worked_example(&s, 1, 300);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.propose_result(&1, &1, &5); // admin wrongly posts SAS by 5

    let d = Address::generate(&s.env);
    s.sac.mint(&d, &(100 * USDC));
    s.client.dispute(&1, &d);
    assert_eq!(s.token.balance(&d), 90 * USDC, "bond = 1% of $1000 = $10 escrowed");

    s.env.ledger().with_mut(|l| l.timestamp = 2_600);
    assert!(s.client.try_finalize(&1).is_err(), "finalize blocked while dispute open");

    s.client.resolve_dispute(&1, &false, &0, &12); // correct to OKC by 12
    assert_eq!(s.token.balance(&d), 100 * USDC, "bond refunded on correction");
    assert!(s.client.try_finalize(&1).is_err(), "window restarted (deadline now 3100)");

    s.env.ledger().with_mut(|l| l.timestamp = 3_200);
    s.client.finalize(&1);
    // corrected OKC-by-12 settles like the raked scenario 1: A = $491, rake $18
    assert_close(s.client.redeem(&p[0], &1, &0, &(400 * USDC)), 4_910_000_000, 3, "A after corrected finalize");
    assert_eq!(s.token.balance(&s.treasury), 18 * USDC, "only rake in treasury (bond was refunded)");
}

/// A frivolous dispute is upheld: bond forfeited to TREASURY (not the pool),
/// the window continues, and settlement is byte-for-byte unaffected by the
/// bond (2a T3 — the settlement-math-invariance property).
#[test]
fn frivolous_dispute_forfeits_to_treasury_settlement_unchanged() {
    let s = setup();
    let (p, ..) = worked_example(&s, 1, 0); // rake 0: treasury only ever sees the bond
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.propose_result(&1, &0, &12);

    let d = Address::generate(&s.env);
    s.sac.mint(&d, &(100 * USDC));
    s.client.dispute(&1, &d);
    s.client.resolve_dispute(&1, &true, &0, &0); // uphold: frivolous
    assert_eq!(s.token.balance(&s.treasury), 10 * USDC, "frivolous bond -> treasury");
    assert_eq!(s.token.balance(&d), 90 * USDC, "disputer lost the bond");

    // window unchanged (deadline still 2500): finalize after it
    s.env.ledger().with_mut(|l| l.timestamp = 2_600);
    s.client.finalize(&1);
    // A still $500 — the bond never touched the pool
    assert_close(s.client.redeem(&p[0], &1, &0, &(400 * USDC)), 5_000_000_000, 3, "A payout unaffected by the bond");
    assert_eq!(s.token.balance(&s.treasury), 10 * USDC, "treasury still only the bond (rake 0)");
}

/// One open dispute at a time (2a T5), and disputes are rejected once the
/// window has elapsed.
#[test]
fn one_open_dispute_and_none_after_window() {
    let s = setup();
    worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.propose_result(&1, &0, &12);

    let d1 = Address::generate(&s.env);
    let d2 = Address::generate(&s.env);
    s.sac.mint(&d1, &(100 * USDC));
    s.sac.mint(&d2, &(100 * USDC));
    s.client.dispute(&1, &d1);
    assert!(s.client.try_dispute(&1, &d2).is_err(), "second concurrent dispute rejected");

    s.client.resolve_dispute(&1, &true, &0, &0); // clear it (upheld)
    s.env.ledger().with_mut(|l| l.timestamp = 2_600);
    assert!(s.client.try_dispute(&1, &d2).is_err(), "dispute after the window rejected");
}

/// Cancelling during the dispute window refunds an open bond.
#[test]
fn cancel_during_window_refunds_bond() {
    let s = setup();
    worked_example(&s, 1, 0);
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.propose_result(&1, &0, &12);

    let d = Address::generate(&s.env);
    s.sac.mint(&d, &(100 * USDC));
    s.client.dispute(&1, &d);
    s.client.cancel_market(&1);
    assert_eq!(s.client.get_market(&1).status, MarketStatus::Cancelled);
    assert_eq!(s.token.balance(&d), 100 * USDC, "bond refunded on cancel");
}

/// The bond floor applies on a small pool (1% of $4 << $5 floor).
#[test]
fn dispute_bond_hits_floor_on_small_pool() {
    let s = setup();
    let feed = s.client.address.clone();
    create_market(&s, 9, &[10], OracleKind::Admin, &feed, 0, 0);
    let a = Address::generate(&s.env);
    let b = Address::generate(&s.env);
    s.sac.mint(&a, &(2 * USDC));
    s.sac.mint(&b, &(2 * USDC));
    s.client.mint_tickets(&a, &9, &0, &(2 * USDC));
    s.client.mint_tickets(&b, &9, &1, &(2 * USDC));
    s.env.ledger().with_mut(|l| l.timestamp = 2_000);
    s.client.propose_result(&9, &0, &10); // pool = $4

    let d = Address::generate(&s.env);
    s.sac.mint(&d, &(10 * USDC));
    s.client.dispute(&9, &d);
    assert_eq!(s.token.balance(&d), 5 * USDC, "floor bond = $5 (1% of $4 is below the floor)");
}
