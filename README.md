<p align="center">
  <img src="web/public/brand/bakunawa-logo-wide.png" alt="Bakunawa" width="640">
</p>

# Bakunawa — Dominance Prediction Market

**Forecast the winner — and how big.** The prediction market that rewards conviction: the bolder your call, the bigger your share when it lands. Built on Stellar with a Soroban smart contract.

Named for the Philippine mythological serpent that swallows the moon — the pool swallows every failed conviction, and grows.

**▶ Live demo: [bakunawa-three.vercel.app](https://bakunawa-three.vercel.app/)** (Stellar testnet)

> **Testnet deployment**
>
> | | Address |
> |---|---|
> | **Bakunawa contract (Soroban, testnet)** | [`CACPGURDH7ZDAAD2PBVKFPN4X46RELH2XSJU7E5BNYT6EJZOAYJ4I22L`](https://stellar.expert/explorer/testnet/contract/CACPGURDH7ZDAAD2PBVKFPN4X46RELH2XSJU7E5BNYT6EJZOAYJ4I22L) |
> | Oracle (Reflector CEX/DEX price feed, testnet) | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` |
> | Stake asset (test USDC SAC) | `CAKBCKBUE3ZRSNH6CDYAB62ZFWL7U7OX6NBZ6EUDFID22PRLICFJXHGS` |

---

## What it is

Existing prediction markets only ask "who wins?" Bakunawa asks **who wins, and by how much** — in one shared pool, with two kinds of position:

- **Regular predictions** back just the winner. You mint tradable per-side pool tickets at par and can buy/sell them anytime before lock on Stellar's DEX — exit at the live market price, exactly like an order-book prediction market. Settlement pays whoever holds the tickets.
- **Convictions** back the winner *plus a minimum margin*. Locked at entry, all-or-nothing: a conviction wins only if its side wins by at least the margin called (an exact hit wins). The rarer the call, the bigger the multiplier.

Both share one pot. Every losing stake — wrong winner *or* unmet margin — funds the winners:

```
Weight = Stake × (SideStake / S(m))        # DemandMult: rarer call → bigger weight
Payout = Stake + Weight / ΣWeights × (LosingPool − Fee)
```

Convictions that die mid-event **bank into the pool** until settlement — never paid out early, because the dead predictor's own side may still win. The pool visibly grows as convictions fail. A multiplier is a *relative weight in the pool, never fixed odds* — every market shows a live implied payout, and the pool can never owe more than it holds.

The pool's state also inverts into a live **crowd-implied margin distribution** ("the crowd says 34% chance OKC wins by 10+"), shown on every market and served as a public forecast API — the forecast, not the payout, is the headline.

## Settlement

- **Crypto markets** settle trustlessly from a [Reflector](https://reflector.network) price feed at the settlement timestamp — the % move from the listing snapshot. Exactly 0.00% → no winner → full refunds.
- **Curated markets** (e.g. NBA) post the result from a named official source. Winners claim pull-based; the contract holds no authority to move funds outside settlement logic.

## Tech stack

| Layer | Choice |
|---|---|
| Smart contract | Rust + Soroban SDK 22, Stellar testnet |
| Oracle | Reflector price feeds (crypto); admin oracle for curated events |
| Frontend | Next.js (App Router) + Tailwind; `stellar-wallets-kit` (Freighter) |
| Data | Postgres + Prisma — read cache + registry only; **chain is the source of truth** |
| Simulation | Python (stdlib only) — the pre-contract mechanism gate |

## Repo layout

```
sim/         Payout simulator (Python) — settlement engine, curve fitting,
             agent-based validation, and the crowd-forecast inversion
contracts/   Soroban (Rust) — the Bakunawa market contract + tests
web/         Next.js app — market pages, prediction slip, DEX trade widget,
             portfolio, charts, curator console, indexer + read/forecast APIs
scripts/     Deploy, list-market, and house-seed helpers (stellar CLI)
```

## Run locally

**Simulator** (no dependencies):

```bash
python sim/fetch_data.py            # download historical datasets → sim/data/
python sim/test_worked_example.py   # settlement engine vs the hand-settled reference
python sim/simulate.py              # agent-based simulation on 37k NBA games
python sim/forecast.py              # validate the crowd-implied forecast
```

**Contract** (Rust + `stellar-cli`):

```bash
cd contracts && cargo test -p bakunawa      # unit tests
../scripts/deploy-bakunawa.ps1              # build + deploy + initialize on testnet
```

**Web** (Node 20+):

```bash
cd web
cp .env.example .env        # fill in Postgres URLs + secrets
npm install
npm run dev                 # http://localhost:3000
```

## Contract interface

```rust
initialize(admin, token, treasury)
create_market(params)                              // curator; per-side ticket assets pre-minted at listing
mint_tickets(predictor, id, side, amount)          // regular prediction — par-mint tradable side tickets
place_conviction(predictor, id, side, rung, amount) // conviction — locked, all-or-nothing, rung ≥ 1
redeem(holder, id, side, amount) -> i128           // ticket holders redeem after settlement / at par on cancel
claim(predictor, id) -> i128                       // convictions collect winnings / refunds
settle_admin(id, winner, margin) / settle_oracle(id) / cancel_market(id)
get_market / get_outcome / get_ladder / get_positions / get_side_stake
```

## Status

Testnet MVP. The full loop runs end-to-end: list a market → predict or convict → trade tickets on the DEX → lock → settle (Reflector or curated) → redeem/claim, with the live crowd forecast and market charts. Settlement math is validated against a hand-settled reference and 37k historical NBA games.

*Testnet only — all keys and assets are disposable. Not audited; not for real funds.*

## Track

Submitted to **Track 3 — DeFi, Stablecoins & Real-World Assets** (StellarX Philippines workshop).

## Team

- Nickjohn Ibuyat — [@Tobi-Learns](https://github.com/Tobi-Learns)

## License

Released under the [MIT License](LICENSE) — © 2026 Nickjohn Ibuyat.
