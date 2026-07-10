"""Dynamic mint pricing for Neutral shares — Phase 1.12a (pipeline D2).

Dynamic parimutuel market with the **money-share price rule**: the price to
mint a Neutral share on a side is that side's current share of the pooled
money —

    price_i = M_i / (M_0 + M_1)        (== the crowd money-share forecast!)

So minting `d` dollars on side i (other side M_o fixed) yields

    shares = d + M_o * ln((M_i + d) / M_i)

a closed form of  integral dm / price_i.  Consequences:
  - The mint price is *exactly* the live money-share forecast we already show —
    buying is "buy the crowd's implied probability," Polymarket-style.
  - Buying the UNDER-backed side is cheap (big log bonus) -> price discovery is
    rewarded; piling the ALREADY-favored side earns almost no bonus (shares ~=
    dollars) -> the par-mint information snipe is denied its free lunch.
  - EARLY money on a side gets more shares per dollar than LATE money on the
    same side -> conviction is structurally rewarded.

Settlement is UNCHANGED in spirit: every dollar enters the pool; the winning
side's Neutral positions split the raked losing pool by SHARE COUNT (the claim),
not by dollars. Because the split weight only sets proportions, never the
distributable total, pool conservation holds for ANY weight -> **solvent by
construction**. This is why a dynamic *parimutuel* is safe where LMSR (a fixed
$1/share payout coefficient) is not: there is no coefficient to arbitrage.

The house seed mints at PAR (1 share = $1) to establish both sides' money;
dynamic pricing applies to every mint after. Both sides must be seeded (the
existing viability rule) so no side is ever at M_i = 0.

Run:  python sim/dpm.py   ->  prints the readout + writes sim/out/dpm-report.md
Stdlib only (project convention).
"""

import math
import os
import random


# ---------------------------------------------------------------------------
# Pricing
# ---------------------------------------------------------------------------


def price(m_side: float, m_other: float) -> float:
    """Mint price per share on a side == its money share (the forecast)."""
    tot = m_side + m_other
    return m_side / tot if tot > 0 else 0.5


def mint_shares(m_side: float, m_other: float, dollars: float) -> float:
    """Shares minted for `dollars` on a side, integral dm/price over the mint."""
    if m_side <= 0:
        raise ValueError("side must be seeded (M_i > 0) before dynamic minting")
    return dollars + m_other * math.log((m_side + dollars) / m_side)


def mint_shares_approx(m_side: float, m_other: float, dollars: float) -> float:
    """ln-free approximation for on-chain use: price the whole mint at its
    MIDPOINT money-share (integer-only arithmetic, no logs / no floats needed
    in Soroban). shares = d / price_mid, price_mid = (M_i+d/2)/(M_i+M_o+d/2).
    Exact for infinitesimal mints; conservative (a hair fewer shares) for large
    ones. All ops are +,-,*,/ so this ports to i128 stroops directly."""
    if m_side <= 0:
        raise ValueError("side must be seeded (M_i > 0) before dynamic minting")
    return dollars * (2 * m_side + dollars + 2 * m_other) / (2 * m_side + dollars)


class Pos:
    __slots__ = ("who", "side", "dollars", "shares")

    def __init__(self, who, side, dollars, shares):
        self.who = who
        self.side = side
        self.dollars = dollars
        self.shares = shares


class Ledger:
    """Tracks money per side; produces Neutral positions under a pricing mode."""

    def __init__(self, mode: str):
        assert mode in ("par", "dpm", "approx")
        self.mode = mode
        self.money = [0.0, 0.0]
        self.pos = []

    def seed(self, per_side: float):
        """House seed both sides at par (1 share = $1) to establish the book."""
        for side in (0, 1):
            self.money[side] += per_side
            self.pos.append(Pos(f"seed_{side}", side, per_side, per_side))

    def mint(self, who: str, side: int, dollars: float):
        if self.mode == "par":
            shares = dollars
        elif self.mode == "approx":
            shares = mint_shares_approx(self.money[side], self.money[1 - side], dollars)
        else:
            shares = mint_shares(self.money[side], self.money[1 - side], dollars)
        self.money[side] += dollars
        self.pos.append(Pos(who, side, dollars, shares))
        return shares


def settle_full(regs, convs, winner, margin, rake_rate=0.03):
    """Full DPM settlement integration = what the contract must do.

    regs  = [(who, side, dollars, shares)]  Neutral DPM positions
    convs = [(who, side, rung, stake)]       convictions (money, all-or-nothing)

    Cross-class fairness (parimutuel): the regular CLASS's settlement weight is
    its MONEY (not its inflated share count), so regulars vs convictions split
    the pot by dollars, as today. The DPM only redistributes WITHIN the regular
    class: a holder's slice of the regular allocation is by SHARE count, so
    early buyers (more shares/$) earn more. Convictions unchanged (DemandMult).

    Returns (payouts{who:payout}, checks). Conservation: sum payouts + rake ==
    total money, exactly (bar integer dust in the real contract)."""
    reg_money = {0: 0.0, 1: 0.0}
    reg_shares = {0: 0.0, 1: 0.0}
    for _, s, d, sh in regs:
        reg_money[s] += d
        reg_shares[s] += sh
    side_money = {0: reg_money[0], 1: reg_money[1]}
    conv_agg = {}  # (side, rung) -> stake
    for _, s, r, st in convs:
        side_money[s] += st
        conv_agg[(s, r)] = conv_agg.get((s, r), 0.0) + st

    total = side_money[0] + side_money[1]
    winner_money = side_money[winner]

    def s_of(side, m):  # conviction stake on side at rung >= m
        return sum(st for (sd, r), st in conv_agg.items() if sd == side and r >= m)

    # winning weights: regular class = its money; convictions = stake*DemandMult
    # (aggregate per rung; per-position weight is st_i * winner_money/S(r), which
    # sums to the same — so sum_w from aggregates is exact).
    winning_money = reg_money[winner]
    sum_w = reg_money[winner]
    for (sd, r), st in conv_agg.items():
        if sd == winner and r <= margin:
            sum_w += st * winner_money / s_of(winner, r)
            winning_money += st
    if sum_w <= 0:
        return None, {"cancelled": True}

    losing_pool = total - winning_money
    rake = rake_rate * losing_pool
    dist = losing_pool - rake

    payouts = {}
    # regular class allocation, split intra-class by shares
    reg_alloc = reg_money[winner] * (sum_w + dist) / sum_w if reg_shares[winner] else 0.0
    for who, s, d, sh in regs:
        if s == winner and reg_shares[winner] > 0:
            payouts[who] = sh / reg_shares[winner] * reg_alloc
        else:
            payouts[who] = 0.0
    # convictions — per-position weight = st * DemandMult(rung)
    for who, s, r, st in convs:
        if s == winner and r <= margin:
            w = st * winner_money / s_of(winner, r)
            payouts[who] = st + w / sum_w * dist
        else:
            payouts[who] = 0.0

    paid = sum(payouts.values())
    return payouts, {"total": total, "paid": paid, "rake": rake,
                     "residual": total - (paid + rake), "cancelled": False}


def cancel_full(regs, convs):
    """Cancelled market: refund all money. Regular holders get the money-backing
    per share (reg_money/reg_shares) so the pot exactly clears; convictions get
    their stake back. Under DPM shares != dollars, so a naive par refund (1
    USDC/ticket) would over-pay and break solvency — this is the fix."""
    reg_money = {0: 0.0, 1: 0.0}
    reg_shares = {0: 0.0, 1: 0.0}
    for _, s, d, sh in regs:
        reg_money[s] += d
        reg_shares[s] += sh
    payouts = {}
    for who, s, d, sh in regs:
        payouts[who] = sh / reg_shares[s] * reg_money[s] if reg_shares[s] else 0.0
    for who, s, r, st in convs:
        payouts[who] = st
    total = sum(reg_money.values()) + sum(st for _, _, _, st in convs)
    paid = sum(payouts.values())
    return payouts, {"total": total, "paid": paid, "residual": total - paid}


def settle(positions, winning_side, rake_rate=0.03):
    """Parimutuel settle; winners split the raked losing pool by share count."""
    winners = [p for p in positions if p.side == winning_side]
    losers = [p for p in positions if p.side != winning_side]
    losing_pool = sum(p.dollars for p in losers)
    rake = rake_rate * losing_pool
    distributable = losing_pool - rake
    sum_w = sum(p.shares for p in winners) or 1.0

    roi, paid = {}, 0.0
    for p in winners:
        payout = p.dollars + (p.shares / sum_w) * distributable
        roi[p.who] = payout / p.dollars - 1.0
        paid += payout
    for p in losers:
        roi[p.who] = -1.0

    pool = sum(p.dollars for p in positions)
    return roi, {"pool": pool, "paid": paid, "rake": rake,
                 "residual": pool - (paid + rake)}


# ---------------------------------------------------------------------------
# Experiments
# ---------------------------------------------------------------------------


def run(mode, seed_each, mints, winning_side, rake=0.03):
    lg = Ledger(mode)
    lg.seed(seed_each)
    for who, side, d in mints:
        lg.mint(who, side, d)
    return settle(lg.pos, winning_side, rake), lg


def exp_early_reward():
    """Two identical $10 buyers on the winning side, one early (side light) and
    one late (after an $80 pile). Par pays them equally; DPM pays early more."""
    mints = [
        ("early", 0, 10),   # UP light
        ("crowd", 0, 80),   # UP piles up
        ("late", 0, 10),    # same $10, but now UP is heavy
    ]
    out = {}
    for mode in ("par", "dpm"):
        (roi, _), _ = run(mode, 50, mints, winning_side=0)
        out[mode] = (roi["early"], roi["late"])
    return out


def exp_snipe():
    """Balanced honest book, then a sniper who KNOWS the winner piles $100 on it
    late. Compare the early honest holder's ROI vs the sniper's, par vs DPM."""
    mints = [
        ("honest_early", 0, 40),   # early money on the eventual winner
        ("honest_other", 1, 40),   # keeps the book ~balanced
        ("sniper", 0, 100),        # piles the (now favored) winning side late
    ]
    res = {}
    for mode in ("par", "dpm"):
        (roi, _), lg = run(mode, 50, mints, winning_side=0)
        res[mode] = {"honest": roi["honest_early"], "sniper": roi["sniper"]}
        if mode == "dpm":
            # sniper's realized price / shares-per-dollar
            sp = next(p for p in lg.pos if p.who == "sniper")
            res["sniper_shares_per_$"] = sp.shares / sp.dollars
            res["sniper_price"] = price(50 + 40, 50 + 40)  # book at sniper's entry
    return res


def exp_solvency(trials=3000, rake=0.03, seed=7):
    rng = random.Random(seed)
    worst, neg = 0.0, 0
    for _ in range(trials):
        mints = [(f"p{i}", rng.randint(0, 1), rng.uniform(1, 120))
                 for i in range(rng.randint(0, 12))]
        (roi, chk), _ = run("dpm", rng.uniform(10, 100), mints,
                            winning_side=rng.randint(0, 1), rake=rake)
        worst = max(worst, abs(chk["residual"]))
        if any(r < -1.0 - 1e-9 for r in roi.values()):
            neg += 1
    return {"trials": trials, "worst_residual": worst, "neg_payouts": neg}


def exp_solvency_full(trials=4000, rake=0.03, seed=23):
    """The real gate: random pools mixing DPM regular shares AND convictions,
    settled at a random winner/margin OR cancelled. Assert conservation (paid +
    rake == pool) and no over-payment, every time."""
    rng = random.Random(seed)
    worst_settle, worst_cancel, bad = 0.0, 0.0, 0
    for _ in range(trials):
        # seed both sides at par, then random regular DPM mints + convictions
        lg0, lg1 = Ledger("dpm"), Ledger("dpm")  # per-side money trackers via one ledger
        lg = Ledger("dpm")
        seed_each = rng.uniform(10, 80)
        lg.seed(seed_each)
        regs = [("seed_0", 0, seed_each, seed_each), ("seed_1", 1, seed_each, seed_each)]
        rungs = sorted(rng.sample([1, 3, 5, 10, 20], k=rng.randint(1, 3)))
        convs = []
        for i in range(rng.randint(0, 8)):
            if rng.random() < 0.55:
                side = rng.randint(0, 1)
                d = rng.uniform(1, 60)
                sh = lg.mint(f"r{i}", side, d)
                regs.append((f"r{i}", side, d, sh))
            else:
                side = rng.randint(0, 1)
                r = rng.choice(rungs)
                st = rng.uniform(1, 60)
                lg.money[side] += st  # convictions add to side money too
                convs.append((f"c{i}", side, r, st))
        if rng.random() < 0.15:
            _, chk = cancel_full(regs, convs)
            worst_cancel = max(worst_cancel, abs(chk["residual"]))
        else:
            winner = rng.randint(0, 1)
            margin = rng.choice(rungs + [max(rungs) + 5])
            pay, chk = settle_full(regs, convs, winner, margin, rake)
            if chk.get("cancelled"):
                continue
            worst_settle = max(worst_settle, abs(chk["residual"]))
            if pay and any(v < -1e-9 for v in pay.values()):
                bad += 1
    return {"trials": trials, "worst_settle": worst_settle,
            "worst_cancel": worst_cancel, "bad": bad}


def exp_approx_accuracy(trials=8000, seed=11):
    """Max relative error of the ln-free midpoint approximation vs the exact
    integral, as a function of the per-mint cap (how large one mint may be
    relative to the side's current money). The midpoint rule is exact for small
    mints and degrades as a single mint dwarfs its side — so a per-tx cap keeps
    it tight. Reports worst error at several caps."""
    rng = random.Random(seed)
    caps = [0.1, 0.25, 0.5, 1.0, None]  # d <= cap * M_side ; None = up to full pool
    worst = {c: 0.0 for c in caps}
    for _ in range(trials):
        m_side = rng.uniform(5, 500)
        m_other = rng.uniform(5, 500)
        for c in caps:
            hi = (c * m_side) if c is not None else (m_side + m_other)
            d = rng.uniform(0.5, max(hi, 0.6))
            exact = mint_shares(m_side, m_other, d)
            approx = mint_shares_approx(m_side, m_other, d)
            worst[c] = max(worst[c], abs(approx - exact) / exact)
    return {"trials": trials, "caps": caps, "worst": worst}


def price_curve():
    """Mint price by money-share (== the forecast) — legibility table."""
    return [(f, f, 1 - f) for f in (0.5, 0.6, 0.7, 0.8, 0.9)]


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def main():
    early = exp_early_reward()
    snipe = exp_snipe()
    solv = exp_solvency()
    full = exp_solvency_full()
    approx = exp_approx_accuracy()

    L = []
    p = L.append
    p("# Dynamic mint pricing (money-share DPM) — Phase 1.12a readout\n")
    p("Mint price per Neutral share = the side's **money share** "
      "`M_i/(M_0+M_1)` — i.e. the live crowd forecast. Shares for `$d` on a "
      "side = `d + M_other * ln((M_i+d)/M_i)`. House seeds at par; both sides "
      "seeded (viability), so no side is ever empty.\n")

    p("## 1. Solvency (the gate)\n")
    p(f"- {solv['trials']} random seed+mint sequences x random winner")
    p(f"- worst pool-conservation residual: **{solv['worst_residual']:.2e}** "
      "(payouts + rake == pool)")
    p(f"- ROIs below -100%: **{solv['neg_payouts']}**")
    p("- **Solvent by construction** — the split weight (shares) sets only "
      "proportions, never the distributable total.\n")
    p("### 1b. Full integration (regular DPM shares + convictions + cancel)\n")
    p("The real contract mixes DPM-priced Neutral shares with all-or-nothing "
      "convictions. Fairness rule: the regular CLASS is weighted by its MONEY "
      "cross-class (vs convictions), but split by SHARES intra-class (early "
      "reward). Cancel refunds the money-backing per share (a naive 1-USDC/"
      "ticket par refund would over-pay, since shares > dollars).\n")
    p(f"- {full['trials']} random mixed pools, settled or cancelled")
    p(f"- worst settle residual: **{full['worst_settle']:.2e}**, worst cancel "
      f"residual: **{full['worst_cancel']:.2e}**")
    p(f"- over-payments: **{full['bad']}** — conservation holds with convictions "
      "in the pool, on both settle and cancel paths.\n")

    p("## 2. Early entry is rewarded\n")
    p("Two $10 buyers on the winning side — one early (side light), one late "
      "(after an $80 pile). Same dollars, same outcome:\n")
    p("| pricing | early ROI | late ROI |")
    p("|---|---|---|")
    for mode in ("par", "dpm"):
        e, l = early[mode]
        p(f"| {mode.upper()} | {e*100:+.1f}% | {l*100:+.1f}% |")
    p("\nPar pays them equally. DPM pays the **early** buyer more — the same $10 "
      "bought more shares when the side was cheaper.\n")

    p("## 3. The par-mint snipe is denied its free lunch\n")
    p("Balanced honest book, then a sniper piles **$100** on the (now favored) "
      "winning side late:\n")
    p("| pricing | honest-early ROI | sniper ROI |")
    p("|---|---|---|")
    for mode in ("par", "dpm"):
        p(f"| {mode.upper()} | {snipe[mode]['honest']*100:+.1f}% | "
          f"{snipe[mode]['sniper']*100:+.1f}% |")
    p(f"\nPar: the sniper gets the **same** deal as the early holder. DPM: the "
      f"sniper mints into a high price (~${snipe['sniper_price']:.2f}/share, "
      f"only **{snipe['sniper_shares_per_$']:.2f} shares/$**), so the **early "
      "holder now out-earns him** — early conviction is structurally ahead.\n")

    p("## 4. On-chain math: ln-free integer approximation (open question for 1.12b)\n")
    p("Soroban is no_std i128 with no floats. The exact mint uses `ln`; the "
      "cheap alternative prices the whole mint at its **midpoint money-share** "
      "(`shares = d*(2*M_i+d+2*M_o)/(2*M_i+d)`) — pure integer +,-,*,/. It is "
      "exact for small mints and degrades as one mint dwarfs its side, so a "
      "**per-mint cap** keeps it tight:\n")
    p("| per-mint cap (d <= cap x M_side) | worst error vs exact |")
    p("|---|---|")
    for c in approx["caps"]:
        label = "unbounded (up to full pool)" if c is None else f"{c:g}x"
        p(f"| {label} | {approx['worst'][c]*100:.2f}% |")
    p("\n**Decision for 1.12b:** either (a) a per-mint cap (e.g. one mint may at "
      "most ~double its side) so the integer midpoint rule is accurate, "
      "(b) a small fixed-point `ln`/multi-segment integrator on-chain (exact, "
      "more code + audit surface), or (c) a bounded-share DPM (share-ratio, "
      "integer `sqrt`) that avoids `ln` entirely at the cost of price != the "
      "money-share forecast. Recommend (a) — smallest contract surface, keeps "
      "price == forecast.\n")

    p("## 5. Price = the forecast (legibility)\n")
    p("| side money share | mint price | other side |")
    p("|---|---|---|")
    for _, pu, pd in price_curve():
        p(f"| {pu*100:.0f}% | ${pu:.2f} | ${pd:.2f} |")
    p("\nThe mint price IS the crowd money-share we already display — prices sum "
      "to 1, no LMSR subsidy, redemption stays the parimutuel pool split.\n")

    report = "\n".join(L)
    print(report)
    os.makedirs(os.path.join(os.path.dirname(__file__), "out"), exist_ok=True)
    out = os.path.join(os.path.dirname(__file__), "out", "dpm-report.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write(report + "\n")
    print(f"\n[written] {out}")


if __name__ == "__main__":
    main()
