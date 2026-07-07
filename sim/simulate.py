"""Agent-based simulation on historical NBA margins (Phase 1.1d + 1.1e).

Answers the three gate questions from the pipeline:
  Q1  Demand vs stats EV across margins (is the risk ladder priced sanely?)
  Q2  Does spread-anchoring close the sharp-farming hole in stats mode?
  Q3  How big is the dominance premium winner-only bettors pay?

Method: ~37k real games (1985-2015). For each game we construct a bettor
population, settle the pool against the game's ACTUAL final margin, and
aggregate realized ROI. Two crowd scenarios bracket reality:

  STATIC   a plausible day-one crowd that never reacts to prices
           ($1,400 winner-only split by Elo-forecast sentiment + noise;
           $600 dominance ladder, rungs 3/6/9/12/15/20, geometric decay).
  EQUILIB  the same budget after bettors chase live implied payouts
           (multiplicative-weights reallocation until per-rung EVs equalize
           — the self-balancing dynamic the design doc claims).

Q2 isolates CURVE error from COMPOSITION edge two ways: an analytic
overweight factor (mult x true win prob, by spread bucket) and a paired
sharp attack on identical pools under both curves. The fast settlement path
is cross-checked bet-for-bet against engine.settle() (the reference).
"""

import math
import os
import random
import time
import zlib
from statistics import NormalDist

from curves import (EmpiricalUnconditional, anchored_curve, fit_spreads,
                    load_nba_games, TAIL_CAP)
from engine import Bet, settle as engine_settle

_N = NormalDist()
OUT_DIR = os.path.join(os.path.dirname(__file__), "out")

RUNGS = (3, 6, 9, 12, 15, 20)
SLOTS = [(s, r) for s in ("HOME", "AWAY") for r in (0,) + RUNGS]
WINNER_ONLY_POOL = 1400.0
DOMINANCE_POOL = 600.0
LADDER_DECAY = 0.65
SHARP_STAKE = 100.0
SHARP_EV_THRESHOLD = 0.05
RAKES = (0.0, 0.02, 0.03, 0.04)
MAXM = 46
EQ_SAMPLE = 1200
EQ_ITERS = 60
EQ_ETA = 0.6
SHARP_SAMPLE = 4000


# --- Population ---------------------------------------------------------------

def build_pool(game, rng):
    frac = min(max(game.forecast + rng.gauss(0, 0.06), 0.05), 0.95)
    bets = [("HOME", 0, WINNER_ONLY_POOL * frac),
            ("AWAY", 0, WINNER_ONLY_POOL * (1 - frac))]
    decay = [LADDER_DECAY ** k for k in range(len(RUNGS))]
    unit = 1.0 / sum(decay)
    for side, side_frac in (("HOME", frac), ("AWAY", 1 - frac)):
        budget = DOMINANCE_POOL * side_frac
        for rung, d in zip(RUNGS, decay):
            bets.append((side, rung, budget * d * unit))
    return bets


# --- Fast settlement path (verified against engine.settle) ---------------------

def pool_arrays(bets, mode, curve):
    """cumw[side][k] / cumstake[side][k]: winning weight / stake if side wins
    by k; plus per-(side,rung) multipliers and the total pool."""
    side_stake = {"HOME": 0.0, "AWAY": 0.0}
    s_of = {}
    for s, r, st in bets:
        side_stake[s] += st
    for s, r, st in bets:
        key = (s, r)
        if key not in s_of:
            s_of[key] = sum(st2 for s2, r2, st2 in bets if s2 == s and r2 >= r)
    total = side_stake["HOME"] + side_stake["AWAY"]

    mults = {}
    for key in s_of:
        if mode == "demand":
            mults[key] = side_stake[key[0]] / s_of[key]
        else:
            mults[key] = curve(*key)

    cumw, cumstake = {}, {}
    for s in ("HOME", "AWAY"):
        w = [0.0] * (MAXM + 1)
        st_ = [0.0] * (MAXM + 1)
        for s2, rung, st in bets:
            if s2 != s:
                continue
            m = mults[(s2, rung)]
            for k in range(max(rung, 1), MAXM + 1):
                w[k] += st * m
                st_[k] += st
        cumw[s], cumstake[s] = w, st_
    return cumw, cumstake, mults, total


def settle_fast(bets, winner, marg, cumw, cumstake, mults, total):
    k = min(marg, MAXM)
    sum_w = cumw[winner][k]
    lp = total - cumstake[winner][k]
    out = []
    for s, rung, st in bets:
        won = s == winner and rung <= marg
        gain = (st * mults[(s, rung)] / sum_w) * lp if won else 0.0
        out.append((s, rung, st, won, gain))
    return out


def crosscheck(games, sigma, n=200):
    rng = random.Random(7)
    for game in rng.sample(games, n):
        grng = random.Random(zlib.crc32(game.game_id.encode()))
        bets = build_pool(game, grng)
        curve = anchored_curve(game.spread, sigma)
        winner = "HOME" if game.margin > 0 else "AWAY"
        marg = abs(game.margin)
        for mode, c in (("demand", None), ("stats", curve)):
            fast = settle_fast(bets, winner, marg, *pool_arrays(bets, mode, c))
            ebets = [Bet(str(i), s, r, st) for i, (s, r, st) in enumerate(bets)]
            ref = engine_settle(ebets, winner, marg, mode=mode, curve=c)
            for (s, r, st, won, gain), pos in zip(fast, ref.positions):
                assert won == pos.won
                ref_gain = pos.payout - pos.stake if pos.won else 0.0
                assert abs(gain - ref_gain) < 1e-6
    print(f"cross-check: fast path == engine.settle on {n} games x 2 modes")


# --- EV of a marginal bet (shared by sharp + equilibrium crowd) ------------------

def outcome_probs(spread, sigma):
    """{k: (p_home_wins_by_k, p_away_wins_by_k)} for k = 1..MAXM (tail-lumped)."""
    probs = {}
    for k in range(1, MAXM + 1):
        lo, hi = k - 0.5, (k + 0.5 if k < MAXM else float("inf"))
        p_h = _N.cdf((hi - spread) / sigma) - _N.cdf((lo - spread) / sigma)
        p_a = _N.cdf((-lo - spread) / sigma) - _N.cdf((-hi - spread) / sigma)
        probs[k] = (p_h, p_a)
    return probs


def slot_ev(side, rung, probs, arrays):
    """Expected profit of an epsilon $1 bet on (side, rung) under `probs`."""
    cumw, cumstake, mults, total = arrays
    side_i = 0 if side == "HOME" else 1
    mult = mults[(side, rung)]
    ev, p_win = 0.0, 0.0
    for k in range(max(rung, 1), MAXM + 1):
        p = probs[k][side_i]
        if p <= 0:
            continue
        p_win += p
        ev += p * (mult / cumw[side][k]) * (total - cumstake[side][k])
    return ev - (1 - p_win)


# --- Equilibrium crowd (the self-balancing dynamic) ------------------------------

def equilibrium_pool(game, sigma, mode, curve, budget=2000.0):
    """Reallocate the crowd's budget across all 14 slots by multiplicative
    weights on marginal EV until EVs equalize — bettors chasing the live
    implied payouts the UI shows. Crowd belief = Normal(spread, sigma)."""
    probs = outcome_probs(game.spread, sigma)
    alloc = {slot: budget / len(SLOTS) for slot in SLOTS}
    for _ in range(EQ_ITERS):
        bets = [(s, r, a) for (s, r), a in alloc.items()]
        arrays = pool_arrays(bets, mode, curve)
        evs = {slot: slot_ev(slot[0], slot[1], probs, arrays) for slot in SLOTS}
        for slot in SLOTS:
            alloc[slot] *= math.exp(EQ_ETA * max(-1.0, min(1.0, evs[slot])))
            alloc[slot] = max(alloc[slot], 0.5)
        scale = budget / sum(alloc.values())
        for slot in SLOTS:
            alloc[slot] *= scale
    spread_ev = max(evs.values()) - min(evs.values())
    return [(s, r, a) for (s, r), a in alloc.items()], spread_ev


# --- Aggregation -----------------------------------------------------------------

class Acc:
    def __init__(self):
        self.staked = self.gain = self.lost = self.won_stake = 0.0
        self.n = self.n_won = 0

    def add(self, stake, won, gain):
        self.staked += stake
        self.n += 1
        if won:
            self.gain += gain
            self.won_stake += stake
            self.n_won += 1
        else:
            self.lost += stake

    def roi(self, rake=0.0):
        return (self.gain * (1 - rake) - self.lost) / self.staked if self.staked else 0.0

    def roi_when_won(self, rake=0.0):
        return (self.gain * (1 - rake)) / self.won_stake if self.won_stake else 0.0

    def hit_rate(self):
        return self.n_won / self.n if self.n else 0.0


MODES = ("demand", "stats_anchored", "stats_uncond")


def run_static(games, sigma, uncond):
    acc = {(m, r): Acc() for m in MODES for r in (0,) + RUNGS}
    wo_with = {m: Acc() for m in MODES}
    wo_only = Acc()
    for game in games:
        rng = random.Random(zlib.crc32(game.game_id.encode()))
        bets = build_pool(game, rng)
        winner = "HOME" if game.margin > 0 else "AWAY"
        marg = abs(game.margin)
        a_curve = anchored_curve(game.spread, sigma)
        for mode, emode, curve in (("demand", "demand", None),
                                   ("stats_anchored", "stats", a_curve),
                                   ("stats_uncond", "stats", uncond)):
            arrays = pool_arrays(bets, emode, curve)
            for s, rung, st, won, gain in settle_fast(bets, winner, marg, *arrays):
                acc[(mode, rung)].add(st, won, gain)
                if rung == 0:
                    wo_with[mode].add(st, won, gain)
        wo_bets = [b for b in bets if b[1] == 0]
        arrays = pool_arrays(wo_bets, "demand", None)
        for s, rung, st, won, gain in settle_fast(wo_bets, winner, marg, *arrays):
            wo_only.add(st, won, gain)
    return acc, wo_with, wo_only


def run_equilibrium(games, sigma):
    sample = random.Random(23).sample(games, EQ_SAMPLE)
    acc = {(m, r): Acc() for m in ("demand", "stats_anchored") for r in (0,) + RUNGS}
    alloc_share = {(m, r): 0.0 for m in ("demand", "stats_anchored") for r in (0,) + RUNGS}
    ev_spreads = {"demand": [], "stats_anchored": []}
    for game in sample:
        winner = "HOME" if game.margin > 0 else "AWAY"
        marg = abs(game.margin)
        a_curve = anchored_curve(game.spread, sigma)
        for mode, emode, curve in (("demand", "demand", None),
                                   ("stats_anchored", "stats", a_curve)):
            bets, ev_spread = equilibrium_pool(game, sigma, emode, curve)
            ev_spreads[mode].append(ev_spread)
            arrays = pool_arrays(bets, emode, curve)
            for s, rung, st, won, gain in settle_fast(bets, winner, marg, *arrays):
                acc[(mode, rung)].add(st, won, gain)
                alloc_share[(mode, rung)] += st
    conv = {m: sum(1 for e in v if e < 0.05) for m, v in ev_spreads.items()}
    total_alloc = {m: sum(v for (m2, r), v in alloc_share.items() if m2 == m)
                   for m in ("demand", "stats_anchored")}
    return acc, alloc_share, total_alloc, conv, EQ_SAMPLE


def run_overweight(games, sigma, uncond):
    """Analytic Q2: overweight = mult(favorite, rung) x P_true(fav wins by >= rung).
    1.0 = the curve weights the rung fairly; >1 = farmable overweight."""
    buckets = [(0, 3), (3, 6), (6, 9), (9, 15), (15, 99)]
    rows = []
    for lo, hi in buckets:
        sub = [g for g in games if lo <= abs(g.spread) < hi]
        if not sub:
            continue
        row = {"bucket": f"{lo}-{hi if hi < 99 else ''}", "n": len(sub)}
        for rung in (6, 15):
            ow_u = ow_a = 0.0
            for g in sub:
                fav = "HOME" if g.spread >= 0 else "AWAY"
                sp = abs(g.spread)
                p_true = 1 - _N.cdf((rung - 0.5 - sp) / sigma)
                a_curve = anchored_curve(g.spread, sigma)
                ow_u += uncond(fav, rung) * p_true
                ow_a += a_curve(fav, rung) * p_true
            row[f"u{rung}"] = ow_u / len(sub)
            row[f"a{rung}"] = ow_a / len(sub)
        rows.append(row)
    return rows


def run_sharp(games, sigma, uncond):
    """Paired sharp attack: identical static pools, both stats curves, plus
    demand mode. Also logs predicted (epsilon) EV vs realized to expose
    self-dilution. Restricted to |spread| >= 6 for the curve-error pairing."""
    sample = random.Random(11).sample(games, SHARP_SAMPLE)
    res = {m: Acc() for m in MODES}
    active = {m: 0 for m in MODES}
    pred_ev = {m: 0.0 for m in MODES}
    paired = {m: Acc() for m in ("stats_anchored", "stats_uncond")}
    for game in sample:
        rng = random.Random(zlib.crc32(game.game_id.encode()))
        bets = build_pool(game, rng)
        winner = "HOME" if game.margin > 0 else "AWAY"
        marg = abs(game.margin)
        probs = outcome_probs(game.spread, sigma)
        a_curve = anchored_curve(game.spread, sigma)
        big_spread = abs(game.spread) >= 6
        for mode, emode, curve in (("demand", "demand", None),
                                   ("stats_anchored", "stats", a_curve),
                                   ("stats_uncond", "stats", uncond)):
            arrays = pool_arrays(bets, emode, curve)
            best = max(((s, r, slot_ev(s, r, probs, arrays)) for s, r in SLOTS),
                       key=lambda t: t[2])
            side, rung, ev = best
            if ev < SHARP_EV_THRESHOLD:
                continue
            active[mode] += 1
            pred_ev[mode] += ev
            nbets = bets + [(side, rung, SHARP_STAKE)]
            arrays2 = pool_arrays(nbets, emode, curve)
            s, r, st, won, gain = settle_fast(nbets, winner, marg, *arrays2)[-1]
            res[mode].add(st, won, gain)
            if big_spread and mode in paired:
                paired[mode].add(st, won, gain)
    return res, active, pred_ev, paired


# --- Report -----------------------------------------------------------------------

def fmt_pct(x):
    return f"{x*100:+.1f}%"


def main():
    t0 = time.time()
    games = load_nba_games()
    sigma = fit_spreads(games)
    uncond = EmpiricalUnconditional(games).curve()
    print(f"{len(games):,} games; sigma = {sigma:.2f}; tail cap x{TAIL_CAP:.0f}")
    crosscheck(games, sigma)

    print("static sweep (37k games x 3 modes)...")
    acc_s, wo_with, wo_only = run_static(games, sigma, uncond)
    print(f"  done {time.time()-t0:.0f}s")
    print(f"equilibrium sweep ({EQ_SAMPLE} games x 2 modes x {EQ_ITERS} iters)...")
    acc_e, alloc_share, total_alloc, conv, n_eq = run_equilibrium(games, sigma)
    print(f"  done {time.time()-t0:.0f}s (converged <5pp EV spread: "
          f"demand {conv['demand']}/{n_eq}, stats {conv['stats_anchored']}/{n_eq})")
    ow_rows = run_overweight(games, sigma, uncond)
    print(f"sharp attack ({SHARP_SAMPLE} games x 3 modes)...")
    sharp, active, pred_ev, paired = run_sharp(games, sigma, uncond)
    print(f"  done {time.time()-t0:.0f}s")

    lines = []
    p = lines.append
    p("# Bakunawa payout simulator — results (Phase 1.1d/1.1e)")
    p("")
    p(f"Dataset: {len(games):,} NBA games (1985-2015, FiveThirtyEight Elo; "
      f"spreads implied from the Elo forecast by probit). Fitted margin "
      f"sigma = {sigma:.2f} (design doc assumed ~12). Tail cap x{TAIL_CAP:.0f}.")
    p("")
    p("Two crowd scenarios bracket reality: **STATIC** (day-one crowd that "
      "never reacts to prices) and **EQUILIBRIUM** (crowd chases live implied "
      "payouts until per-rung EVs equalize — the self-balancing dynamic).")
    p("")

    p("## Q1 — EV across margins, by mode (rake 0%)")
    p("")
    p("### Static day-one crowd (worst case)")
    p("")
    p("| Rung | Hit rate | Demand ROI | when won | Anchored-stats ROI | when won |")
    p("|---|---|---|---|---|---|")
    for rung in (0,) + RUNGS:
        d, a = acc_s[("demand", rung)], acc_s[("stats_anchored", rung)]
        label = "winner-only" if rung == 0 else f"+{rung}"
        p(f"| {label} | {d.hit_rate()*100:.1f}% | {fmt_pct(d.roi())} "
          f"| {fmt_pct(d.roi_when_won())} | {fmt_pct(a.roi())} "
          f"| {fmt_pct(a.roi_when_won())} |")
    p("")
    p("### Equilibrium crowd (crowd chases implied payouts)")
    p("")
    p("| Rung | Demand ROI | Demand pool share | Anchored ROI | Anchored pool share |")
    p("|---|---|---|---|---|")
    for rung in (0,) + RUNGS:
        d, a = acc_e[("demand", rung)], acc_e[("stats_anchored", rung)]
        ds = alloc_share[("demand", rung)] / total_alloc["demand"] * 100
        as_ = alloc_share[("stats_anchored", rung)] / total_alloc["stats_anchored"] * 100
        label = "winner-only" if rung == 0 else f"+{rung}"
        p(f"| {label} | {fmt_pct(d.roi())} | {ds:.1f}% | {fmt_pct(a.roi())} "
          f"| {as_:.1f}% |")
    p("")
    p(f"(Converged to <5pp EV spread in {EQ_ITERS} iterations: demand "
      f"{conv['demand']}/{n_eq} pools, anchored stats {conv['stats_anchored']}"
      f"/{n_eq}. Stats-mode non-convergence is structural, not numerical: "
      f"with curve-fixed weights, tail rungs cannot reach fair EV at any "
      f"allocation — see Q1 equilibrium table.)")
    p("")

    p("## Q2 — Does spread-anchoring close the sharp-farming hole?")
    p("")
    p("### Analytic: curve overweight on the favorite (mult x true P; 1.00 = fair)")
    p("")
    p("| |spread| bucket | Games | Uncond +6 | Anchored +6 | Uncond +15 | Anchored +15 |")
    p("|---|---|---|---|---|---|")
    for row in ow_rows:
        p(f"| {row['bucket']} | {row['n']:,} | {row['u6']:.2f} | {row['a6']:.2f} "
          f"| {row['u15']:.2f} | {row['a15']:.2f} |")
    p("")
    p("### Realized: $100 sharp on the best rung when marginal EV > +5%")
    p("")
    p("| Pricing | Attacked | Mean predicted EV | Realized ROI | Realized (rake 3%) |")
    p("|---|---|---|---|---|")
    for mode, label in (("stats_uncond", "Stats UNANCHORED (the trap)"),
                        ("stats_anchored", "Stats ANCHORED"),
                        ("demand", "Demand (DemandMult)")):
        s, att = sharp[mode], active[mode]
        pe = pred_ev[mode] / att * 100 if att else 0.0
        p(f"| {label} | {att}/{SHARP_SAMPLE} | {pe:+.1f}% "
          f"| {fmt_pct(s.roi(0))} | {fmt_pct(s.roi(0.03))} |")
    p("")
    pu, pa = paired["stats_uncond"], paired["stats_anchored"]
    p(f"Paired on the SAME pools, favorites only (|spread| >= 6): sharp ROI "
      f"{fmt_pct(pu.roi())} unanchored vs {fmt_pct(pa.roi())} anchored — the "
      f"difference ({(pu.roi()-pa.roi())*100:+.1f}pp) is the pure conditioning "
      f"(curve-error) edge; the rest is composition edge visible to anyone "
      f"reading implied payouts.")
    p("")

    p("## Q3 — Dominance premium paid by winner-only bettors")
    p("")
    p("| Rake | Alone (no dominance) | Demand static | Anchored static | Demand equilibrium |")
    p("|---|---|---|---|---|")
    d_eq = acc_e[("demand", 0)]
    for r in RAKES:
        p(f"| {r*100:.0f}% | {wo_only.roi(r)*100:+.2f}% "
          f"| {wo_with['demand'].roi(r)*100:+.2f}% "
          f"| {wo_with['stats_anchored'].roi(r)*100:+.2f}% "
          f"| {d_eq.roi(r)*100:+.2f}% |")
    p("")
    prem_d = (wo_only.roi(0) - wo_with["demand"].roi(0)) * 100
    prem_a = (wo_only.roi(0) - wo_with["stats_anchored"].roi(0)) * 100
    prem_eq = (wo_only.roi(0) - d_eq.roi(0)) * 100
    p(f"Premium at rake 0 (positive = winner-only bettors subsidize dominance): "
      f"demand static {prem_d:+.2f}pp; anchored stats {prem_a:+.2f}pp "
      f"(negative = dominance bettors overpay); demand equilibrium {prem_eq:+.2f}pp.")

    text = "\n".join(lines)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    print()
    print(text)
    print(f"\nreport -> {path}   ({time.time()-t0:.0f}s total)")


if __name__ == "__main__":
    main()
