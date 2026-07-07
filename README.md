# Bakunawa — Dominance Prediction Market

A prediction market where you forecast both the winner **and the margin of victory** — one shared parimutuel pool per event, all-or-nothing dominance bets, transparently priced — built as a Soroban smart contract on Stellar.

Named for the Philippine mythological serpent that swallows the moon: the pool swallows every failed conviction bet and grows.

## How it works

- **Standard prediction** = winner only. **Dominance prediction** = winner + minimum margin; wins only if the actual margin ≥ predicted.
- One shared parimutuel pool per event — all losing stakes (wrong winner *or* unmet margin) fund the winners: `Payout_i = (Weight_i / ΣWinningWeights) × LosingPool`.
- Two pricing modes, shown transparently on every market:
  - **Demand-based** (default): `DemandMult(m) = SideStake / S(m)` — a cumulative-stake rarity multiplier, self-balancing and Sybil-proof.
  - **Statistics-based** (curated events): multipliers follow the historical rarity of the margin, anchored to the consensus spread, tail-capped.
- Multipliers are relative weights, never fixed odds — the UI shows live implied payouts. Solvent by construction.

## Repo layout

```
sim/         Payout simulator (Python, stdlib-only) — the pre-contract gate
contracts/   Soroban (Rust) contracts — MarketFactory + per-event Market   [later phase]
web/         Next.js frontend + thin read-cache backend                    [later phase]
```

## Simulator

```
python sim/fetch_data.py          # downloads historical datasets to sim/data/
python sim/test_worked_example.py # settlement engine vs the hand-settled reference
python sim/simulate.py            # agent-based simulation on historical NBA margins
```
