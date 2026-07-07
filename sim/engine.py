"""Bakunawa settlement engine — both pricing modes as pure functions.

Reference: docs/Bakunawa.md (v2 mechanics) and docs/Bakunawa-worked-example.md.
Any change here must keep test_worked_example.py passing exactly.

Rules implemented:
- A bet is (side, margin, stake). margin == 0 means winner-only.
- Win condition: correct side AND actual_margin >= margin (exact hit wins).
- Demand mode:  DemandMult(m) = SideStake / S(m), S(m) = total stake on the
  bettor's side at threshold >= m, own stake included, computed over the side's
  FULL composition (including stakes that die) — depends only on pool
  composition, never on the outcome.
- Stats mode:   Weight = Stake * curve(side, margin); curve committed at
  listing (margin -> multiplier lookup), tail-capped.
- Settlement:   Rake = rake_rate * LosingPool, then
                Payout_i = stake_i + Weight_i / SumWinningWeights * (LosingPool - Rake)
- No winners on the winning side (side empty) => market should have been
  cancelled at lock (viability rule); settle() raises so callers must handle
  cancellation explicitly. cancel() returns full refunds, no rake.
"""

from dataclasses import dataclass
from statistics import NormalDist

_N = NormalDist()


@dataclass(frozen=True)
class Bet:
    bettor: str
    side: str          # e.g. "OKC" / "SAS", "HOME" / "AWAY", "UP" / "DOWN"
    margin: float      # 0 = winner-only; > 0 = dominance threshold
    stake: float


@dataclass(frozen=True)
class Settled:
    bettor: str
    side: str
    margin: float
    stake: float
    won: bool
    mult: float        # multiplier applied (1.0 baseline for winner-only demand)
    weight: float      # stake * mult if won else 0
    payout: float      # stake + share of raked losing pool if won else 0

    @property
    def profit(self) -> float:
        return self.payout - self.stake

    @property
    def roi(self) -> float:
        return self.profit / self.stake


class SettlementResult:
    def __init__(self, positions, losing_pool, rake_amount):
        self.positions = positions
        self.losing_pool = losing_pool
        self.rake_amount = rake_amount

    def by(self, bettor):
        return next(p for p in self.positions if p.bettor == bettor)

    @property
    def total_pool(self):
        return sum(p.stake for p in self.positions)

    @property
    def total_paid(self):
        return sum(p.payout for p in self.positions)

    def assert_conserved(self, tol=1e-9):
        """Pool conservation: payouts + rake == total pool, always."""
        diff = abs(self.total_paid + self.rake_amount - self.total_pool)
        if diff > tol:
            raise AssertionError(f"pool not conserved: off by {diff}")


def side_stake(bets, side):
    return sum(b.stake for b in bets if b.side == side)


def cumulative_stake(bets, side, m):
    """S(m): total stake on `side` at threshold >= m (own stake included).
    Computed over the side's full composition, including later-dead stakes."""
    return sum(b.stake for b in bets if b.side == side and b.margin >= m)


def demand_mult(bets, side, m):
    s = cumulative_stake(bets, side, m)
    if s <= 0:
        raise ValueError(f"S({m}) is zero on side {side}")
    return side_stake(bets, side) / s


def normal_curve(spread, sigma, favorite, underdog, tail_cap=None):
    """Stats-mode curve factory: margins ~ Normal(spread, sigma) for the
    favorite (spread > 0 means favorite expected to win by that much).
    Returns curve(side, m) -> multiplier = 1 / P(side wins by >= m).
    Winner-only (m == 0) uses P(side wins). Anchor each event's curve to the
    consensus spread — this is the conditioning fix from the design doc."""
    def p_win_by(side, m):
        thresh = max(m, 1e-12)  # winner-only == wins by > 0
        if side == favorite:
            return 1.0 - _N.cdf((thresh - spread) / sigma)
        elif side == underdog:
            return 1.0 - _N.cdf((thresh + spread) / sigma)
        raise ValueError(f"unknown side {side}")

    def curve(side, m):
        p = p_win_by(side, m)
        mult = float("inf") if p <= 0 else 1.0 / p
        if tail_cap is not None:
            mult = min(mult, tail_cap)
        return mult

    return curve


def table_curve(table, tail_cap=None):
    """Curve from a committed lookup table {(side, margin): mult} — the exact
    artifact the Market contract stores at listing. Settlement stays a lookup."""
    def curve(side, m):
        mult = table[(side, m)]
        return min(mult, tail_cap) if tail_cap is not None else mult
    return curve


def settle(bets, winning_side, actual_margin, mode="demand",
           curve=None, rake_rate=0.0):
    """Settle a market. Returns SettlementResult; conservation is asserted.

    mode="demand": multipliers from pool composition (DemandMult).
    mode="stats":  multipliers from `curve(side, margin)` (committed at listing).
    """
    if mode == "stats" and curve is None:
        raise ValueError("stats mode requires a curve")

    def mult_for(b):
        if mode == "demand":
            return demand_mult(bets, b.side, b.margin)
        return curve(b.side, b.margin)

    winners = [b for b in bets if b.side == winning_side and actual_margin >= b.margin]
    losers = [b for b in bets if b not in winners]
    if not winners:
        # A market whose winning side is empty fails viability — must cancel,
        # never settle (listing it as "settled" would just be theater).
        raise NoWinnersError(
            "no winning positions — cancel and refund (viability rule)")

    losing_pool = sum(b.stake for b in losers)
    rake_amount = rake_rate * losing_pool
    distributable = losing_pool - rake_amount

    weights = {b.bettor: b.stake * mult_for(b) for b in winners}
    sum_w = sum(weights.values())

    positions = []
    for b in bets:
        if b in winners:
            w = weights[b.bettor]
            payout = b.stake + (w / sum_w) * distributable
            positions.append(Settled(b.bettor, b.side, b.margin, b.stake,
                                     True, mult_for(b), w, payout))
        else:
            positions.append(Settled(b.bettor, b.side, b.margin, b.stake,
                                     False, 0.0, 0.0, 0.0))

    result = SettlementResult(positions, losing_pool, rake_amount)
    result.assert_conserved()
    return result


def cancel(bets):
    """Cancelled market: full refunds, no rake, no winners, no losers."""
    positions = [Settled(b.bettor, b.side, b.margin, b.stake,
                         False, 0.0, 0.0, b.stake) for b in bets]
    return SettlementResult(positions, losing_pool=0.0, rake_amount=0.0)


class NoWinnersError(Exception):
    pass
