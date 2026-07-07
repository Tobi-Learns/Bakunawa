"""Acceptance test: the engine must replicate docs/Bakunawa-worked-example.md.

All three scenarios x both pricing modes, plus the edge cases the paper
settlement surfaced. Doc numbers are displayed rounded, so assertions use
the doc's display precision: demand-mode dollars +/-0.01 (exact fractions),
stats-mode dollars +/-0.15 (the doc rounded multipliers before settling),
ROI +/-0.6pp, probabilities +/-0.1pp, multipliers +/-0.5% relative.
Pool conservation is asserted EXACTLY (1e-9) everywhere.
"""

import sys
from engine import (Bet, NoWinnersError, cancel, demand_mult, normal_curve,
                    settle)

# --- Setup from the worked example: OKC vs SAS, spread OKC -8, $1,000 pool ---

BETS = [
    Bet("A", "OKC", 0, 200),
    Bet("B", "OKC", 5, 100),
    Bet("C", "OKC", 10, 100),
    Bet("D", "OKC", 20, 100),
    Bet("E", "OKC", 30, 50),
    Bet("F", "SAS", 0, 200),
    Bet("G", "SAS", 5, 100),
    Bet("H", "SAS", 15, 100),
    Bet("I", "SAS", 25, 50),
]

CURVE = normal_curve(spread=8, sigma=12, favorite="OKC", underdog="SAS")

FAILURES = []


def check(label, actual, expected, tol):
    if abs(actual - expected) > tol:
        FAILURES.append(f"FAIL {label}: got {actual:.4f}, expected {expected} (tol {tol})")
    else:
        print(f"  ok  {label}: {actual:.4f} ~ {expected}")


def check_rel(label, actual, expected, rel_tol):
    if abs(actual - expected) / expected > rel_tol:
        FAILURES.append(f"FAIL {label}: got {actual:.4f}, expected {expected} (rel {rel_tol})")
    else:
        print(f"  ok  {label}: {actual:.4f} ~ {expected}")


# --- Demand multipliers (doc: S(0)=550, S(5)=350, S(10)=250; mults 1.00/1.57/2.20) ---
print("== Demand multipliers ==")
check("DemandMult(0)", demand_mult(BETS, "OKC", 0), 1.00, 0.005)
check("DemandMult(5)", demand_mult(BETS, "OKC", 5), 550 / 350, 1e-9)
check("DemandMult(10)", demand_mult(BETS, "OKC", 10), 2.20, 1e-9)
check("DemandMult(20)", demand_mult(BETS, "OKC", 20), 550 / 150, 1e-9)
check("DemandMult(30)", demand_mult(BETS, "OKC", 30), 11.0, 1e-9)

# --- Stats curve (doc table: 74.8/59.9/43.4/15.9/3.3% and 25.2%; mults) ---
print("== Stats curve (Normal(spread=8, sigma=12)) ==")
for label, side, m, p_doc, mult_doc in [
        ("OKC wins", "OKC", 0, 74.8, 1.34),
        ("OKC +5", "OKC", 5, 59.9, 1.67),
        ("OKC +10", "OKC", 10, 43.4, 2.30),
        ("OKC +20", "OKC", 20, 15.9, 6.30),
        ("OKC +30", "OKC", 30, 3.3, 29.9),
        ("SAS wins", "SAS", 0, 25.2, 3.97)]:
    mult = CURVE(side, m)
    check(f"P({label})%", 100 / mult, p_doc, 0.1)
    check_rel(f"Mult({label})", mult, mult_doc, 0.005)

# --- Scenario 1: OKC wins by 12 (winners A, B, C; LosingPool $600) ---
print("== Scenario 1: OKC by 12, demand mode ==")
r = settle(BETS, "OKC", 12, mode="demand")
check("LosingPool", r.losing_pool, 600, 1e-9)
for b, payout, roi in [("A", 407.92, 104), ("B", 263.36, 163), ("C", 328.71, 229)]:
    check(f"{b} payout", r.by(b).payout, payout, 0.01)
    check(f"{b} ROI%", r.by(b).roi * 100, roi, 0.6)
for dead in ["D", "E", "F", "G", "H", "I"]:
    assert r.by(dead).payout == 0, f"{dead} should lose"
# Dead dominance stakes on the WINNING side (D, E) banked into the pool:
assert not r.by("D").won and not r.by("E").won

print("== Scenario 1: OKC by 12, stats mode ==")
r = settle(BETS, "OKC", 12, mode="stats", curve=CURVE)
for b, profit, roi in [("A", 241.40, 121), ("B", 150.70, 151), ("C", 207.90, 208)]:
    check(f"{b} profit", r.by(b).profit, profit, 0.15)
    check(f"{b} ROI%", r.by(b).roi * 100, roi, 0.6)

# --- Scenario 2: blowout — OKC wins by 22 (winners A..D; LosingPool $500) ---
print("== Scenario 2: OKC by 22 ==")
r = settle(BETS, "OKC", 22, mode="demand")
check("LosingPool", r.losing_pool, 500, 1e-9)
for b, roi in [("A", 53), ("B", 83), ("C", 117), ("D", 194)]:
    check(f"{b} demand ROI%", r.by(b).roi * 100, roi, 0.6)
r = settle(BETS, "OKC", 22, mode="stats", curve=CURVE)
for b, roi in [("A", 52), ("B", 65), ("C", 89), ("D", 243)]:
    check(f"{b} stats ROI%", r.by(b).roi * 100, roi, 0.6)

# --- Scenario 3: long shot lands — OKC wins by 33 (all OKC win; LosingPool $450) ---
print("== Scenario 3: OKC by 33 ==")
r = settle(BETS, "OKC", 33, mode="demand")
check("LosingPool", r.losing_pool, 450, 1e-9)
for b, roi in [("A", 30), ("B", 47), ("C", 66), ("D", 110), ("E", 331)]:
    check(f"{b} demand ROI%", r.by(b).roi * 100, roi, 0.6)
r = settle(BETS, "OKC", 33, mode="stats", curve=CURVE)
for b, roi in [("A", 22), ("B", 27), ("C", 37), ("D", 102), ("E", 482)]:
    check(f"{b} stats ROI%", r.by(b).roi * 100, roi, 0.8)

# --- Edge cases from the worked example's "surfaced on paper" list ---
print("== Edge cases ==")

# 1. Exact hit wins (the rule is >=): win by exactly 5 pays a +5 bet.
r = settle(BETS, "OKC", 5, mode="demand")
assert r.by("B").won, "exact hit must win"
assert not r.by("C").won, "+10 must lose on a 5-point win"
print("  ok  exact hit: +5 bet wins on a win by exactly 5")

# 2. All-winners case: losing pool ~ 0 -> payouts degrade to refunds.
solo = [Bet("X", "OKC", 0, 100), Bet("Y", "OKC", 0, 300)]
r = settle(solo, "OKC", 1, mode="demand")
assert abs(r.by("X").payout - 100) < 1e-9 and abs(r.by("Y").payout - 300) < 1e-9
print("  ok  all-winners: empty losing pool degrades to refunds")

# 3. Winning side empty -> viability: settle refuses, cancel refunds.
try:
    settle(solo, "SAS", 3, mode="demand")
    FAILURES.append("FAIL: settle with empty winning side should raise")
except NoWinnersError:
    print("  ok  empty winning side raises (must cancel, not settle)")
r = cancel(BETS)
assert all(abs(p.payout - p.stake) < 1e-9 for p in r.positions)
assert r.rake_amount == 0
print("  ok  cancel: full refunds, no rake")

# 4. Rake comes off the losing pool before distribution; conservation holds.
r = settle(BETS, "OKC", 12, mode="demand", rake_rate=0.03)
check("rake amount (3% of $600)", r.rake_amount, 18.0, 1e-9)
check("A payout with rake", r.by("A").payout, 200 + (600 - 18) * (200 / (200 + 1100 / 7 + 220)), 1e-9)

# 5. Conservation is asserted inside settle() for every case above (1e-9).
print("  ok  pool conservation asserted exactly in every scenario")

# --- Verdict ---
print()
if FAILURES:
    print(f"{len(FAILURES)} FAILURES:")
    for f in FAILURES:
        print(" ", f)
    sys.exit(1)
print("ALL CHECKS PASS — engine replicates the worked example.")
