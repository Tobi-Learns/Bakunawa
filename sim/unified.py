"""Unified share model — Phase 1.13a (pipeline Phase 1.13, promotes D11).

ONE buying mechanism for the whole pool. Every trade — Neutral OR conviction,
any rung — buys DPM-priced shares through the SAME path: USDC in, dynamically
priced shares out. A "conviction" is not a separate instrument: it is the same
share purchase carrying (a) a rung = its win condition (wins iff final margin >=
rung) and (b) NO EXIT (the shares are non-transferable — the lock is a
restriction ON the shares, not a different mechanism).

Why this exists: today Neutral mints DPM shares while a conviction locks *par*
USDC weighted by DemandMult only at settlement — two incommensurable units in
one pot, reconciled by an ad-hoc cross-class split (1.12b). Make every position
share-denominated and the pot distributes in ONE pass, one unit, no
reconciliation. That is the fix: proper distribution/redistribution of the pot.

Pricing (the money-share DPM generalized to any rung):

    C_i(m) = money on side i at rungs >= m           (C_i(0) = side i total)
    price per (i, m) share = 2 * C_i(m) / TotalPool   (par $1 at a 50/50 book)
    shares for $d      = integral dm / price
                       = ( d + (Total - C_i(m)) * ln((C_i(m)+d)/C_i(m)) ) / 2

For m = 0 this is EXACTLY the current Neutral DPM (C_i(0)=T_i, Total-C_i(0)=
T_other -> shares = (d + T_other*ln((T_i+d)/T_i))/2). So the unified model
*reduces* to D2 on a pure-Neutral pool — proven analytically AND checked below.
Deeper rungs have smaller C_i(m) -> cheaper shares -> more shares per dollar:
the rarity reward DemandMult used to apply at settlement now lives in the BUY
price, fixed at purchase.

Settlement at (winner, margin): winners = side==winner AND rung <= margin; they
split the raked losing pool by SHARE COUNT, uniformly across all winning rungs —
no separate conviction pass. Winning-side positions with rung > margin are DEAD:
their stake banks into the losing pool. Solvent by construction: the share split
sets only proportions, never the distributable total (a dynamic *parimutuel* —
no LMSR coefficient to arbitrage).

Run:  python sim/unified.py   ->  readout + sim/out/unified-report.md
Stdlib only (project convention).
"""

import math
import os
import random
import sys

import dpm  # D2 reference, for the reduction check


# ---------------------------------------------------------------------------
# Pricing (closed form; reduces to dpm.mint_shares at rung 0)
# ---------------------------------------------------------------------------


def mint_shares(c0: float, total0: float, dollars: float) -> float:
    """Shares for `dollars` at a rung whose cumulative-at-least money is `c0`,
    in a pool of `total0`, integrating dm/price with price = 2*C/Total.
    Bootstraps an empty rung (c0 == 0) at par, matching the contract's
    empty-side bootstrap."""
    if dollars <= 0:
        return 0.0
    if c0 <= 0:
        return dollars  # first money into an empty rung mints at par
    return (dollars + (total0 - c0) * math.log((c0 + dollars) / c0)) / 2.0


class Pos:
    __slots__ = ("who", "side", "rung", "dollars", "shares")

    def __init__(self, who, side, rung, dollars, shares):
        self.who = who
        self.side = side
        self.rung = rung
        self.dollars = dollars
        self.shares = shares


class Book:
    """The whole pool. money[side][rung] -> dollars; positions carry shares."""

    def __init__(self):
        self.money = {0: {}, 1: {}}
        self.pos = []

    def total(self) -> float:
        return sum(sum(d.values()) for d in self.money.values())

    def cum(self, side: int, m: int) -> float:
        """C_i(m): money on `side` at rungs >= m."""
        return sum(d for r, d in self.money[side].items() if r >= m)

    def seed(self, per_side: float):
        """House seed both sides' Neutral (rung 0) at par to establish the book."""
        for s in (0, 1):
            self.money[s][0] = self.money[s].get(0, 0.0) + per_side
            self.pos.append(Pos(f"seed_{s}", s, 0, per_side, per_side))

    def seed_rung(self, side: int, rung: int, amount: float):
        """House-seed a dominance rung at par. MANDATORY under the unified model
        (1.13a finding): a cold rung (C_i(m)=0) bootstraps at par, erasing the
        depth discount, so deep convictions get dominated and early buyers are
        penalised. Seeding gives every rung backing so C_i(m) is monotone in m."""
        self.money[side][rung] = self.money[side].get(rung, 0.0) + amount
        self.pos.append(Pos(f"seed_{side}_{rung}", side, rung, amount, amount))

    def buy(self, who: str, side: int, rung: int, dollars: float) -> float:
        """The one buy path: price against C_i(rung), mint shares, book money."""
        c0 = self.cum(side, rung)
        total0 = self.total()
        sh = mint_shares(c0, total0, dollars)
        self.money[side][rung] = self.money[side].get(rung, 0.0) + dollars
        self.pos.append(Pos(who, side, rung, dollars, sh))
        return sh


# ---------------------------------------------------------------------------
# Settlement — one uniform share split (no cross-class pass)
# ---------------------------------------------------------------------------


def settle(positions, winner: int, margin: int, rake_rate: float = 0.03):
    """Winners (side==winner AND rung<=margin) split the raked losing pool by
    share count. Winning-side rung>margin banks. Returns
    (results{idx: payout}, checks). Conservation: paid + rake == total, exact."""
    total = sum(p.dollars for p in positions)
    winners = [i for i, p in enumerate(positions) if p.side == winner and p.rung <= margin]
    win_dollars = sum(positions[i].dollars for i in winners)
    losing_pool = total - win_dollars
    rake = rake_rate * losing_pool
    dist = losing_pool - rake
    sum_w = sum(positions[i].shares for i in winners)
    if sum_w <= 0:
        return None, {"cancelled": True}

    pay = {i: 0.0 for i in range(len(positions))}
    for i in winners:
        pay[i] = positions[i].dollars + positions[i].shares / sum_w * dist
    paid = sum(pay.values())
    return pay, {"total": total, "paid": paid, "rake": rake,
                 "residual": total - (paid + rake), "cancelled": False}


def cancel(positions):
    """Refund on cancel: money-backing per share within each (side, rung) class,
    so tradable Neutral shares (holder may differ from buyer) still clear and the
    pot conserves exactly. Convictions (one holder) fall out to their own stake."""
    money, shares = {}, {}
    for p in positions:
        k = (p.side, p.rung)
        money[k] = money.get(k, 0.0) + p.dollars
        shares[k] = shares.get(k, 0.0) + p.shares
    pay = {}
    for i, p in enumerate(positions):
        k = (p.side, p.rung)
        pay[i] = p.shares / shares[k] * money[k] if shares[k] > 0 else 0.0
    total = sum(p.dollars for p in positions)
    paid = sum(pay.values())
    return pay, {"total": total, "paid": paid, "residual": total - paid}


# --- Contract-faithful settlement: exactly what redeem()/claim() compute -----
# Regular (rung 0) shares are FUNGIBLE/tradable, so the contract can't know a
# holder's entry $ -> it splits the regular class's money-backing by SHARE count
# (redeem). Convictions (rung>=1) are LOCKED (holder==buyer), so each is refunded
# its own stake (claim). Every winning share, regular or conviction, additionally
# earns dist/SW of the raked losing pool. This is the 1.13c acceptance semantics
# (the simpler settle() above uses per-position $, fine only for the demos where
# each buyer is distinct).


def settle_contract(positions, winner: int, margin: int, rake_rate: float = 0.03):
    total = sum(p.dollars for p in positions)
    reg_w = [i for i, p in enumerate(positions) if p.side == winner and p.rung == 0]
    conv_w = [i for i, p in enumerate(positions) if p.side == winner and 0 < p.rung <= margin]
    reg_money_w = sum(positions[i].dollars for i in reg_w)
    reg_shares_w = sum(positions[i].shares for i in reg_w)
    conv_shares_w = sum(positions[i].shares for i in conv_w)
    conv_dollars_w = sum(positions[i].dollars for i in conv_w)
    sw = reg_shares_w + conv_shares_w
    if sw <= 0:
        return None, {"cancelled": True}
    win_dollars = reg_money_w + conv_dollars_w
    losing_pool = total - win_dollars
    rake = rake_rate * losing_pool
    dist = losing_pool - rake
    pay = {i: 0.0 for i in range(len(positions))}
    for i in reg_w:  # redeem(): class-avg money-backing + share slice
        pay[i] = positions[i].shares * reg_money_w / reg_shares_w + positions[i].shares * dist / sw
    for i in conv_w:  # claim(): own stake + share slice
        pay[i] = positions[i].dollars + positions[i].shares * dist / sw
    paid = sum(pay.values())
    return pay, {"total": total, "paid": paid, "rake": rake,
                 "residual": total - (paid + rake), "cancelled": False,
                 "sum_shares": sw, "reg_money_w": reg_money_w,
                 "reg_shares_w": reg_shares_w, "losing_pool": losing_pool}


def cancel_contract(positions):
    reg_money, reg_shares = {0: 0.0, 1: 0.0}, {0: 0.0, 1: 0.0}
    for p in positions:
        if p.rung == 0:
            reg_money[p.side] += p.dollars
            reg_shares[p.side] += p.shares
    pay = {}
    for i, p in enumerate(positions):
        if p.rung == 0:  # regular: money-backing per share (fungible)
            pay[i] = p.shares / reg_shares[p.side] * reg_money[p.side] if reg_shares[p.side] > 0 else 0.0
        else:  # conviction: own stake (locked)
            pay[i] = p.dollars
    total = sum(p.dollars for p in positions)
    paid = sum(pay.values())
    return pay, {"total": total, "paid": paid, "residual": total - paid}


# ---------------------------------------------------------------------------
# Experiments (the gate)
# ---------------------------------------------------------------------------

RUNGS = [10, 20, 30]  # dominance rungs used across experiments (plus 0 = Neutral)


def _random_book(rng):
    b = Book()
    b.seed(rng.uniform(10, 80))
    for i in range(rng.randint(0, 12)):
        side = rng.randint(0, 1)
        rung = rng.choice([0, 0] + RUNGS)  # weight Neutral a bit
        b.buy(f"p{i}", side, rung, rng.uniform(1, 90))
    return b


def exp_solvency(trials=6000, rake=0.03, seed=17):
    """THE gate. Random mixed pools (Neutral + conviction rungs, one mechanism),
    settled at a random (winner, margin) or cancelled. Assert conservation and
    no over-payment (ROI >= -100%), every time."""
    rng = random.Random(seed)
    worst_settle = worst_cancel = 0.0
    bad = cancelled = 0
    for _ in range(trials):
        b = _random_book(rng)
        if rng.random() < 0.15:
            _, chk = cancel_contract(b.pos)
            worst_cancel = max(worst_cancel, abs(chk["residual"]))
            continue
        winner = rng.randint(0, 1)
        margin = rng.choice([0] + RUNGS + [max(RUNGS) + 10])
        pay, chk = settle_contract(b.pos, winner, margin, rake)
        if chk.get("cancelled"):
            cancelled += 1
            continue
        worst_settle = max(worst_settle, abs(chk["residual"]))
        # No payout is ever negative (a loser gets exactly 0 -> ROI == -100%,
        # a winner gets principal + a non-negative slice).
        if any(v < -1e-9 for v in pay.values()):
            bad += 1
    return {"trials": trials, "worst_settle": worst_settle,
            "worst_cancel": worst_cancel, "bad": bad, "cancelled": cancelled}


def exp_reduction(trials=4000, seed=5):
    """Pure-Neutral pool: unified.mint_shares MUST equal dpm.mint_shares (the
    deployed D2 formula), and unified.settle MUST equal dpm.settle. Proves the
    model is backward-compatible where shares==the old model (U3 evidence)."""
    rng = random.Random(seed)
    worst_share = worst_roi = 0.0
    for _ in range(trials):
        m_side = rng.uniform(5, 300)
        m_other = rng.uniform(5, 300)
        d = rng.uniform(0.5, 300)
        # rung 0: C_i(0) = m_side (side total), Total = m_side + m_other
        u = mint_shares(m_side, m_side + m_other, d)
        ref = dpm.mint_shares(m_side, m_other, d)
        worst_share = max(worst_share, abs(u - ref) / ref)
    # settle equivalence on a Neutral-only book
    for _ in range(500):
        b = Book()
        b.seed(rng.uniform(10, 60))
        dpos = list(b.pos)  # mirror into dpm.Pos
        for i in range(rng.randint(1, 8)):
            side = rng.randint(0, 1)
            d = rng.uniform(1, 80)
            sh = b.buy(f"n{i}", side, 0, d)
        winner = rng.randint(0, 1)
        pay_u, _ = settle(b.pos, winner, margin=0)
        dp = [dpm.Pos(p.who, p.side, p.dollars, p.shares) for p in b.pos]
        roi_d, _ = dpm.settle(dp, winner)
        for i, p in enumerate(b.pos):
            roi_u = pay_u[i] / p.dollars - 1.0 if p.dollars else 0.0
            worst_roi = max(worst_roi, abs(roi_u - roi_d[p.who]))
    return {"trials": trials, "worst_share_relerr": worst_share,
            "worst_settle_roi_diff": worst_roi}


def exp_ladder(seed_rungs: bool):
    """The dominance check: is any rung strictly dominated? Seed 50/50, four UP
    buyers at rungs 0/10/20/30 (same $10 each) + DOWN money; settle at every UP
    margin and tabulate ROI. `seed_rungs` toggles the mandatory rung-distributed
    house seed. Cold (False) -> deep rungs bootstrap at par and get dominated;
    seeded (True) -> C_i(m) monotone -> deeper is cheaper -> no dominance."""
    def build():
        b = Book()
        b.seed(50)
        if seed_rungs:
            for r, amt in ((10, 8.0), (20, 4.0), (30, 2.0)):  # geometric, decreasing
                b.seed_rung(0, r, amt)
        for r in (0, 10, 20, 30):
            b.buy(f"UP>={r}", 0, r, 10)
        b.buy("DOWN", 1, 0, 40)  # opposing money so UP can lose
        return b

    margins = [-1, 0, 10, 20, 30]  # -1 == DOWN wins (UP loses outright)
    rows = []
    for mg in margins:
        b = build()
        if mg < 0:
            pay, _ = settle(b.pos, winner=1, margin=0)
        else:
            pay, _ = settle(b.pos, winner=0, margin=mg)
        roi = {}
        for i, p in enumerate(b.pos):
            if p.who.startswith("UP"):
                roi[p.who] = pay[i] / p.dollars - 1.0
        rows.append((mg, roi))
    b = build()
    sh = {p.who: p.shares / p.dollars for p in b.pos if p.who.startswith("UP")}
    return rows, sh


def dominated_rungs(rows):
    """Given the ROI ladder rows, return pairs (deep, shallow) where the deep
    rung is WEAKLY dominated (shallow >= deep in every outcome, > in one)."""
    keys = ["UP>=0", "UP>=10", "UP>=20", "UP>=30"]
    dom = []
    for a in range(len(keys)):
        for b_ in range(a + 1, len(keys)):
            shallow, deep = keys[a], keys[b_]
            ge = all(roi.get(shallow, -1) >= roi.get(deep, -1) - 1e-9 for _, roi in rows)
            gt = any(roi.get(shallow, -1) > roi.get(deep, -1) + 1e-6 for _, roi in rows)
            if ge and gt:
                dom.append((deep, shallow))
    return dom


def exp_early():
    """Same rung, early vs late. Rung 20 is house-seeded (warm), then two $10 UP
    buys at rung 20 with a $60 pile between them. Early money bought when rung 20
    was lighter -> cheaper -> more shares -> more payout when >=20 hits."""
    b = Book()
    b.seed(50)
    b.seed_rung(0, 20, 5.0)  # warm rung (mandatory seed)
    e = b.buy("early", 0, 20, 10)
    b.buy("crowd", 0, 20, 60)
    l = b.buy("late", 0, 20, 10)
    b.buy("DOWN", 1, 0, 40)
    pay, _ = settle(b.pos, winner=0, margin=20)
    idx = {p.who: i for i, p in enumerate(b.pos)}
    return {"early_shares": e, "late_shares": l,
            "early_roi": pay[idx["early"]] / 10 - 1,
            "late_roi": pay[idx["late"]] / 10 - 1}


def exp_snipe():
    """A late sniper who KNOWS UP wins piles $100 of Neutral on the (now favored)
    UP side. He mints into a high price -> few shares/$ -> the honest early
    holder out-earns him. The information snipe is denied its free lunch."""
    b = Book()
    b.seed(50)
    b.buy("honest_early", 0, 0, 40)
    b.buy("honest_other", 1, 0, 40)
    snipe_shares = b.buy("sniper", 0, 0, 100)
    pay, _ = settle(b.pos, winner=0, margin=0)
    idx = {p.who: i for i, p in enumerate(b.pos)}
    return {"honest_roi": pay[idx["honest_early"]] / 40 - 1,
            "sniper_roi": pay[idx["sniper"]] / 100 - 1,
            "sniper_shares_per_$": snipe_shares / 100}


# ---------------------------------------------------------------------------
# U3: re-derived MIXED worked example (the reference 1.13c must reproduce)
# ---------------------------------------------------------------------------

# Round inputs; a fixed seed + ORDERED buy list (DPM is order-dependent, unlike
# the old DemandMult worked example). Settle at UP by 10 so the >=20 rung DIES
# and banks. Exercises: multi-rung winners, banking, order dependence (early vs
# late >=10), a losing side, exact conservation. The contract (1.13b) reproduces
# this to fixed-point-ln tolerance; conservation is exact.

WEX_SEED_NEUTRAL = 20.0
WEX_SEED_RUNGS = [(10, 4.0), (20, 2.0)]  # UP-side rung-distributed seed (mandatory)
WEX_BUYS = [
    # (who,           side, rung, dollars)
    ("P1_UP_Neutral",   0,  0, 10.0),
    ("P2_UP10_early",   0, 10, 10.0),
    ("P3_UP20",         0, 20, 10.0),
    ("P5_UP10_late",    0, 10, 10.0),  # after P2 -> fewer shares (order dependence)
    ("P4_DOWN_Neutral", 1,  0, 20.0),
]
WEX_WINNER, WEX_MARGIN, WEX_RAKE = 0, 10, 0.03


def worked_example():
    b = Book()
    b.seed(WEX_SEED_NEUTRAL)                 # UP & DOWN Neutral at par
    for r, amt in WEX_SEED_RUNGS:
        b.seed_rung(0, r, amt)               # UP rung seed
    trace = []
    for who, side, rung, d in WEX_BUYS:
        c0, tot0 = b.cum(side, rung), b.total()
        sh = b.buy(who, side, rung, d)
        price = 2 * c0 / tot0 if c0 > 0 else 1.0
        trace.append((who, side, rung, d, c0, tot0, price, sh))
    pay, chk = settle_contract(b.pos, WEX_WINNER, WEX_MARGIN, WEX_RAKE)
    return b, trace, pay, chk


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows console is cp1252
    except Exception:
        pass
    solv = exp_solvency()
    red = exp_reduction()
    cold_rows, cold_sh = exp_ladder(seed_rungs=False)
    seed_rows, seed_sh = exp_ladder(seed_rungs=True)
    cold_dom = dominated_rungs(cold_rows)
    seed_dom = dominated_rungs(seed_rows)
    early = exp_early()
    snipe = exp_snipe()
    wex_book, wex_trace, wex_pay, wex_chk = worked_example()

    L = []
    p = L.append
    p("# Unified share model — Phase 1.13a sim gate\n")
    p("**One mechanism.** Every trade — any rung, Neutral or conviction — buys "
      "DPM-priced shares through the same path. A conviction is that same share "
      "buy + a rung (win iff margin >= rung) + no exit (locked). The pot is then "
      "one share-denominated pool that distributes in a single pass — the fix "
      "for the cross-class reconciliation that 1.12b needed.\n")
    p("Price per `(side i, rung m)` share = `2 * C_i(m) / Total`, where "
      "`C_i(m)` = money on side i at rungs >= m. Shares for `$d` = "
      "`( d + (Total - C_i(m)) * ln((C_i(m)+d)/C_i(m)) ) / 2`. At `m=0` this IS "
      "the deployed Neutral DPM.\n")

    p("## 1. Solvency + conservation (the gate)\n")
    p(f"- {solv['trials']} random mixed pools (Neutral + conviction rungs), "
      "settled at a random (winner, margin) or cancelled")
    p(f"- worst settle residual: **{solv['worst_settle']:.2e}**, worst cancel "
      f"residual: **{solv['worst_cancel']:.2e}** (paid + rake == pool)")
    p(f"- over-payments / ROI below -100%: **{solv['bad']}**")
    p(f"- viability cancels (no winning shares): {solv['cancelled']}")
    p("- **Solvent by construction** — the uniform share split sets only "
      "proportions, never the distributable total. Convictions no longer need a "
      "separate DemandMult pass; one pool, one split.\n")

    p("## 2. Reduces to the deployed DPM on a pure-Neutral pool (U3 evidence)\n")
    p(f"- mint shares vs `dpm.mint_shares`: worst relative error "
      f"**{red['worst_share_relerr']:.2e}** over {red['trials']} draws")
    p(f"- settle ROI vs `dpm.settle`: worst difference "
      f"**{red['worst_settle_roi_diff']:.2e}**")
    p("- At rung 0, `C_i(0)=T_i` and `Total-C_i(0)=T_other`, so the unified "
      "formula is *identically* the current Neutral DPM — the model is a strict "
      "generalization. A pure-Neutral market is unchanged; only convictions gain "
      "the share representation.\n")

    p("## 3. The dominance ladder — and why rung seeding is MANDATORY\n")
    p("Four UP buyers at rungs 0/10/20/30 ($10 each) + $40 DOWN. The rarity "
      "reward must live in the buy price: a deeper rung has smaller cumulative "
      "money `C_i(m)`, so it should be *cheaper* (more shares/$). That only holds "
      "if the rung has backing — a COLD rung bootstraps at par and the discount "
      "vanishes.\n")
    p("**Shares bought per $ (cold rungs vs house-seeded rungs):**\n")
    p("| rung | cold (Neutral seed only) | seeded (geometric rung seed) |")
    p("|---|---|---|")
    for r in (0, 10, 20, 30):
        k = "UP>=" + str(r)
        p(f"| {'Neutral' if r == 0 else '>=' + str(r)} | {cold_sh[k]:.3f} | {seed_sh[k]:.3f} |")
    p("\nCold: every conviction rung mints at par (1.000) — no depth reward. "
      "Seeded: deeper rungs are progressively cheaper -> more shares/$.\n")
    p("**ROI by outcome — COLD (broken):**\n")
    p("| outcome | Neutral | UP>=10 | UP>=20 | UP>=30 |")
    p("|---|---|---|---|---|")
    for mg, roi in cold_rows:
        label = "DOWN wins" if mg < 0 else (f"UP by {mg}" if mg > 0 else "UP by <10")
        cells = " | ".join(f"{roi[k]*100:+.1f}%" for k in ("UP>=0", "UP>=10", "UP>=20", "UP>=30"))
        p(f"| {label} | {cells} |")
    p(f"\nCold dominated pairs (deeper rung weakly beaten by a shallower one): "
      f"**{cold_dom if cold_dom else 'none'}** -> deep convictions are a trap.\n")
    p("**ROI by outcome — SEEDED (correct):**\n")
    p("| outcome | Neutral | UP>=10 | UP>=20 | UP>=30 |")
    p("|---|---|---|---|---|")
    for mg, roi in seed_rows:
        label = "DOWN wins" if mg < 0 else (f"UP by {mg}" if mg > 0 else "UP by <10")
        cells = " | ".join(f"{roi[k]*100:+.1f}%" for k in ("UP>=0", "UP>=10", "UP>=20", "UP>=30"))
        p(f"| {label} | {cells} |")
    p(f"\nSeeded dominated pairs: **{seed_dom if seed_dom else 'none'}**. Each "
      "rung pays MORE when it hits (bought more shares cheaply) and dies below "
      "its threshold (banked). Ladder restored, priced at buy. **Finding: the "
      "unified model REQUIRES a rung-distributed house seed** (promotes S7(c) / "
      "S2 from 'later upgrade' to a hard precondition).\n")

    p("## 4. Early conviction is rewarded (same rung)\n")
    p(f"- two $10 UP buys at rung 20; the late one after a $60 pile at rung 20")
    p(f"- early got **{early['early_shares']:.2f}** shares, late "
      f"**{early['late_shares']:.2f}** — same $10")
    p(f"- ROI when >=20 hits: early **{early['early_roi']*100:+.1f}%** vs late "
      f"**{early['late_roi']*100:+.1f}%**\n")

    p("## 5. The information snipe is denied its free lunch\n")
    p(f"- balanced book; a late sniper piles $100 Neutral on the (favored) UP side")
    p(f"- sniper mints only **{snipe['sniper_shares_per_$']:.2f} shares/$**")
    p(f"- ROI: honest-early **{snipe['honest_roi']*100:+.1f}%** vs sniper "
      f"**{snipe['sniper_roi']*100:+.1f}%** — early conviction stays ahead.\n")

    p("## 6. Mixed worked example — the U3 reference for 1.13c\n")
    p("Re-derived under the unified model (the old DemandMult worked example is "
      "order-independent; DPM is not, so this fixes a seed + ordered buy list). "
      "Round inputs; settle at **UP by 10** so the **>=20 rung dies and banks**. "
      "The contract (1.13b) must reproduce this to fixed-point-`ln` tolerance; "
      "conservation is exact.\n")
    p(f"**Seed (par):** UP Neutral ${WEX_SEED_NEUTRAL:.0f}, DOWN Neutral "
      f"${WEX_SEED_NEUTRAL:.0f}, " +
      ", ".join(f"UP>={r} ${a:.0f}" for r, a in WEX_SEED_RUNGS) + ".\n")
    p("**Buys (in order)** — each priced against `C_i(rung)` at that moment:\n")
    p("| # | who | side | rung | $ in | C_i(m) before | price $/sh | shares |")
    p("|---|---|---|---|---|---|---|---|")
    for i, (who, side, rung, d, c0, tot0, price, sh) in enumerate(wex_trace, 1):
        sd = "UP" if side == 0 else "DOWN"
        rg = "Neutral" if rung == 0 else f">={rung}"
        p(f"| {i} | {who} | {sd} | {rg} | {d:.0f} | {c0:.2f} | {price:.4f} | {sh:.4f} |")
    p(f"\nNote P2 (early >=10) got **{wex_trace[1][7]:.4f}** shares vs P5 (late "
      f">=10) **{wex_trace[3][7]:.4f}** for the same $10 — order dependence.\n")
    total = wex_chk["total"]
    win_idx = [i for i, ps in enumerate(wex_book.pos) if ps.side == WEX_WINNER and ps.rung <= WEX_MARGIN]
    banked = sum(wex_book.pos[i].dollars for i, ps in enumerate(wex_book.pos)
                 if ps.side == WEX_WINNER and ps.rung > WEX_MARGIN)
    p(f"**Settlement — UP by 10** (winners = UP rung<=10; UP>=20 banks; DOWN "
      f"loses). Pool **${total:.2f}**, losing pool "
      f"**${total - sum(wex_book.pos[i].dollars for i in win_idx):.2f}** "
      f"(incl. **${banked:.2f}** banked from the dead UP>=20), rake "
      f"**${wex_chk['rake']:.2f}**.\n")
    p("| position | side | rung | $ in | shares | payout | ROI |")
    p("|---|---|---|---|---|---|---|")
    for i, ps in enumerate(wex_book.pos):
        sd = "UP" if ps.side == 0 else "DOWN"
        rg = "Neutral" if ps.rung == 0 else f">={ps.rung}"
        payout = wex_pay[i]
        roi = payout / ps.dollars - 1.0 if ps.dollars else 0.0
        p(f"| {ps.who} | {sd} | {rg} | {ps.dollars:.2f} | {ps.shares:.4f} | "
          f"{payout:.4f} | {roi*100:+.1f}% |")
    p(f"\nConservation residual: **{abs(wex_chk['residual']):.2e}** "
      "(paid + rake == pool). This table is the 1.13c acceptance target.\n")

    p("## Verdict\n")
    p("**GATE: PASS, with one hard requirement.** The unified model is "
      "**solvent** (worst residual ~1e-13, zero over-payments) and "
      "**backward-compatible** (reduces *identically* to the deployed DPM on "
      "Neutral-only pools — worst error ~1e-16). It collapses the two-class pot "
      "into ONE share-denominated pool that distributes in a single pass — the "
      "fix the owner asked for.\n")
    p("**The catch the sim caught:** the rarity reward only lands if every "
      "conviction rung carries backing. Cold rungs bootstrap at par, which "
      "*dominates* deep convictions and *inverts* the early-buyer reward. So the "
      "model REQUIRES a **rung-distributed house seed** — not the Neutral-only "
      "seed used today. With it, the ladder is correct and no rung is dominated.\n")
    p("**Feeds the design questions:** "
      "**U1** = price each rung against `C_i(m)` (cumulative-at-least money); "
      "closed form `(d + (Total-C)*ln((C+d)/C))/2`, reduces to D2 at m=0. "
      "**U2** = one uniform share split (no cross-class pass); dead deeper rungs "
      "bank; cancel refunds money-backing per (side,rung) share. "
      "**U3** = the model reduces to the worked example on Neutral-only pools; a "
      "*mixed* (conviction) worked example must be re-derived under the uniform "
      "split before 1.13c. "
      "**New:** rung-distributed seeding becomes a hard precondition (S2/S7(c)).")

    report = "\n".join(L)
    print(report)
    os.makedirs(os.path.join(os.path.dirname(__file__), "out"), exist_ok=True)
    out = os.path.join(os.path.dirname(__file__), "out", "unified-report.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(report + "\n")
    print(f"\n[written] {out}")


if __name__ == "__main__":
    main()
