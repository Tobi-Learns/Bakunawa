"""Stats-mode curve fitting (Phase 1.1c).

Produces the two curve families the simulation compares:

- UNCONDITIONAL: empirical P(margin >= m) pooled over all games, ignoring the
  matchup. This is the naive implementation the design doc calls the trap —
  it prices a title favorite vs a tanking team the same as a coin-flip game.
- ANCHORED: margins ~ Normal(spread_g, sigma) per game, where spread_g is the
  consensus expectation for THIS matchup. We derive spread_g from the
  FiveThirtyEight Elo win forecast (probit transform), and fit sigma from the
  residuals — the same role a sportsbook consensus spread plays in production.

Also fits crypto (BTC weekly % move) distributions and writes the committable
per-market lookup tables (side, margin -> multiplier) that the Market
contract stores at listing.
"""

import csv
import math
import os
from bisect import bisect_left
from statistics import NormalDist

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
OUT_DIR = os.path.join(os.path.dirname(__file__), "out")
_N = NormalDist()

TAIL_CAP = 50.0  # policy cap on any stats multiplier (design doc)


class Game:
    __slots__ = ("game_id", "year", "margin", "forecast", "spread", "playoff")

    def __init__(self, game_id, year, margin, forecast, playoff):
        self.game_id = game_id
        self.year = year
        self.margin = margin        # home-team final margin (home pts - away pts)
        self.forecast = forecast    # home win prob (Elo, home advantage included)
        self.spread = 0.0           # filled by fit_spreads
        self.playoff = playoff


def load_nba_games(min_year=1985):
    """One row per game (home perspective), modern era."""
    games = []
    path = os.path.join(DATA_DIR, "nbaallelo.csv")
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["_iscopy"] != "0" or int(row["year_id"]) < min_year:
                continue
            if row["game_location"] not in ("H", "N"):
                continue
            margin = int(row["pts"]) - int(row["opp_pts"])
            if margin == 0:
                continue  # NBA games cannot tie
            fc = min(max(float(row["forecast"]), 0.01), 0.99)
            games.append(Game(row["game_id"], int(row["year_id"]), margin, fc,
                              row["is_playoffs"] == "1"))
    return games


def fit_spreads(games, iterations=6, sigma0=12.0):
    """Convert win forecasts to implied point spreads.

    If margins ~ Normal(spread, sigma) then P(win) = Phi(spread / sigma), so
    spread = sigma * Phi^-1(forecast). sigma itself comes from the residuals,
    so iterate: assume sigma -> imply spreads -> refit sigma -> repeat.
    """
    sigma = sigma0
    for _ in range(iterations):
        for g in games:
            g.spread = sigma * _N.inv_cdf(g.forecast)
        n = len(games)
        mean_r = sum(g.margin - g.spread for g in games) / n
        var = sum((g.margin - g.spread - mean_r) ** 2 for g in games) / (n - 1)
        sigma = math.sqrt(var)
    return sigma


class EmpiricalUnconditional:
    """The naive curve: pooled P(side wins by >= m) with no matchup conditioning.
    Home and away get different curves (home edge) but every matchup gets the
    same one — this is what the sharp should be able to farm."""

    def __init__(self, games, tail_cap=TAIL_CAP):
        self.margins = sorted(g.margin for g in games)
        self.n = len(self.margins)
        self.tail_cap = tail_cap

    def p_home_wins_by(self, m):
        thresh = max(m, 1)  # winner-only == wins by >= 1 (integer margins)
        idx = bisect_left(self.margins, thresh)
        return (self.n - idx) / self.n

    def p_away_wins_by(self, m):
        thresh = max(m, 1)
        # away wins by >= m  <=>  home margin <= -m
        idx = bisect_left(self.margins, -thresh + 1)
        return idx / self.n

    def curve(self):
        def c(side, m):
            p = self.p_home_wins_by(m) if side == "HOME" else self.p_away_wins_by(m)
            mult = self.tail_cap if p <= 0 else 1.0 / p
            return min(mult, self.tail_cap)
        return c


def anchored_curve(spread, sigma, tail_cap=TAIL_CAP):
    """Per-game curve: Normal(spread, sigma) for the home side (continuity
    corrected for integer margins: wins-by->=m uses m-0.5)."""
    def c(side, m):
        thresh = max(m, 1) - 0.5
        if side == "HOME":
            p = 1.0 - _N.cdf((thresh - spread) / sigma)
        else:
            p = 1.0 - _N.cdf((thresh + spread) / sigma)
        mult = tail_cap if p <= 0 else 1.0 / p
        return min(mult, tail_cap)
    return c


# --- Crypto (BTC weekly % moves) ---------------------------------------------

def load_btc_weekly_moves():
    """Non-overlapping weekly % moves from daily closes."""
    path = os.path.join(DATA_DIR, "btc_daily.csv")
    closes = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            closes.append(float(row["close"]))
    moves = []
    for i in range(0, len(closes) - 7, 7):
        moves.append((closes[i + 7] / closes[i] - 1.0) * 100.0)
    return moves


def btc_weekly_curve_table(moves, rungs=(0, 1, 2, 3, 5, 7, 10, 15),
                           tail_cap=TAIL_CAP):
    """Committable lookup table for a 'BTC up/down this week' market.
    Rung 0 = winner-only (any move in that direction after 2-dp rounding)."""
    n = len(moves)
    table = {}
    for m in rungs:
        thresh = m if m > 0 else 0.005  # winner-only: strictly non-zero move
        p_up = sum(1 for x in moves if x >= thresh) / n
        p_dn = sum(1 for x in moves if x <= -thresh) / n
        table[("UP", m)] = min(tail_cap, 1 / p_up) if p_up else tail_cap
        table[("DOWN", m)] = min(tail_cap, 1 / p_dn) if p_dn else tail_cap
    return table


def write_curve_csv(table, path, note=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["side", "margin", "multiplier"])
        for (side, m), mult in sorted(table.items()):
            w.writerow([side, m, f"{mult:.4f}"])
    if note:
        print(note, "->", os.path.relpath(path, os.path.dirname(__file__)))


if __name__ == "__main__":
    games = load_nba_games()
    sigma = fit_spreads(games)
    print(f"NBA games (1985+): {len(games):,}   fitted sigma = {sigma:.2f}")
    spreads = sorted(abs(g.spread) for g in games)
    print(f"|implied spread|: median {spreads[len(spreads)//2]:.1f}, "
          f"p90 {spreads[int(len(spreads)*0.9)]:.1f}")

    moves = load_btc_weekly_moves()
    table = btc_weekly_curve_table(moves)
    print(f"BTC weekly moves: {len(moves)} samples; "
          f"P(up >= 5%) = {100/table[('UP',5)]:.1f}%  mult x{table[('UP',5)]:.2f}")
    write_curve_csv(table, os.path.join(OUT_DIR, "curve_btc_weekly.csv"),
                    "committable BTC curve table")

    # Example committed NBA table: median-spread game, rungs 0..20
    g_mid = sorted(games, key=lambda g: abs(abs(g.spread) - 8))[0]
    c = anchored_curve(g_mid.spread, sigma)
    nba_table = {(s, m): c(s, m) for s in ("HOME", "AWAY")
                 for m in (0, 5, 10, 15, 20, 25, 30)}
    write_curve_csv(nba_table, os.path.join(OUT_DIR, "curve_nba_example.csv"),
                    f"example NBA table (spread {g_mid.spread:+.1f})")
