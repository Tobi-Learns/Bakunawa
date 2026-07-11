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
> | **Bakunawa contract (Soroban, testnet)** | [`CDL2YD4DU32BYAQGHKEE4OIF7P73HMQ4HWW3Q6FOPN5SBYQWNMMPEVGP`](https://stellar.expert/explorer/testnet/contract/CDL2YD4DU32BYAQGHKEE4OIF7P73HMQ4HWW3Q6FOPN5SBYQWNMMPEVGP) |
> | Oracle (Reflector CEX/DEX price feed, testnet) | `CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63` |
> | Stake asset (test USDC SAC) | `CAKBCKBUE3ZRSNH6CDYAB62ZFWL7U7OX6NBZ6EUDFID22PRLICFJXHGS` |
> | Soroban RPC | `https://soroban-testnet.stellar.org` |
> | Network passphrase | `Test SDF Network ; September 2015` |

---

## Problem

Prediction markets today answer only a binary — *who wins?* — and throw away the question a crowd actually argues about: *by how much?*

Any sports fan already thinks this way. Take the 2015 champion Golden State Warriors: they were so dominant that predicting them to simply *win* a game was pointless — everyone knew they would, so there was no market in it. The real action was the **margin**. Would GSW win by 20? Fans backing the other team weren't claiming "Golden State loses" — they were taking the points: *give me the underdog +20, and if the Warriors don't win by at least 20, I win — even though I took the team that lost.* That is the dominance margin, and it is how people actually play.

Betting is huge in the Philippines, and this spread-and-dominance intuition is second nature to fans here — yet mainstream prediction markets still collapse it into a coin-flip yes/no, and traditional spread betting runs through opaque, custodial bookmakers. Bakunawa restores that dimension on-chain: one pool where the crowd prices the **entire margin-of-victory distribution**, published as a live, trustless forecast rather than a house-set line — on Stellar's low-fee rails, so it works at micro-stakes and is open to anyone with a wallet.

## What it is

Existing prediction markets only ask "who wins?" Bakunawa asks **who wins, and by how much** — in one shared pool, with two kinds of position:

- **Neutral predictions** back just the winner. You mint tradable per-side pool **shares** at a **dynamic price** — the side's share of the pooled money (par at 50/50, richer as a side nears certainty), so the heavier side costs more and buying the under-backed side is cheap. Early / contrarian money is rewarded and late piling of the near-certain side is priced out. Shares are classic Stellar assets: buy/sell them anytime before lock on the DEX, and settlement pays whoever holds them.
- **Convictions** back the winner *plus a minimum margin*. Locked at entry, all-or-nothing: a conviction wins only if its side wins by at least the margin called (an exact hit wins). The rarer the call, the bigger the multiplier.

Both share one pot. Every losing stake — wrong winner *or* unmet margin — funds the winners:

```
Weight = Stake × (SideStake / S(m))        # DemandMult: rarer call → bigger weight
Payout = Stake + Weight / ΣWeights × (LosingPool − Fee)
```

Convictions that die mid-event **bank into the pool** until settlement — never paid out early, because the dead predictor's own side may still win. The pool visibly grows as convictions fail. A multiplier is a *relative weight in the pool, never fixed odds* — every market shows a live implied payout, and the pool can never owe more than it holds.

The pool's state also inverts into a live **crowd-implied margin distribution** ("the crowd says 34% chance OKC wins by 10+"), shown on every market and served as a public forecast API — the forecast, not the payout, is the headline.

## How it works

1. **A curator lists a market** — two sides and a ladder of margin thresholds, with a settlement source (Reflector for crypto, a named official source for curated events) and a lock/settle time. A house seed makes the odds and forecast show numbers from minute one.
2. **You take a position** — either *mint neutral shares* (back the winner; dynamically priced at the crowd's implied probability; tradable before lock) or *place a conviction* (back the winner **by at least** a chosen margin — locked, all-or-nothing, and the rarer the call the bigger the payout).
3. **Trade before lock** — neutral shares are classic Stellar assets, so you can buy or sell them on the native DEX at the live price right up to lock; your claim moves, the pool's cash stays escrowed.
4. **Lock & settle** — at lock the market freezes (no new entries); at settle the oracle posts the result and the pool pays out by demand weight, with wrong calls funding the winners.
5. **Redeem or claim** — share holders redeem, winning convictions claim; funds pull from the contract. Nothing is ever pushed, and the pool can never owe more than it holds.

## Settlement

- **Crypto markets** settle trustlessly from a [Reflector](https://reflector.network) price feed at the settlement timestamp — the % move from the listing snapshot. Exactly 0.00% → no winner → full refunds.
- **Curated markets** (e.g. NBA) post the result from a named official source. Winners claim pull-based; the contract holds no authority to move funds outside settlement logic.

## Tech stack

| Layer | Choice |
|---|---|
| Smart contract | Rust + Soroban SDK 22, Stellar testnet |
| Oracle | Reflector price feeds (crypto); admin oracle for curated events |
| Frontend | Next.js 16 (App Router) + Tailwind |
| Stellar SDK | `@stellar/stellar-sdk` v16 · `@creit.tech/stellar-wallets-kit` v2.5 (Freighter) |
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
mint_tickets(predictor, id, side, amount)          // neutral prediction — dynamic-priced tradable side shares
place_conviction(predictor, id, side, rung, amount) // conviction — locked, all-or-nothing, rung ≥ 1
redeem(holder, id, side, amount) -> i128           // share holders redeem after settlement / money-backing on cancel
claim(predictor, id) -> i128                       // convictions collect winnings / refunds
settle_admin(id, winner, margin) / settle_oracle(id) / cancel_market(id)
get_market / get_outcome / get_ladder / get_positions / get_side_stake
```

## Status

Testnet MVP. The full loop runs end-to-end: list a market → predict or convict → trade shares on the DEX → lock → settle (Reflector or curated) → redeem/claim, with the live crowd forecast and market charts. Neutral shares use dynamic (money-share) mint pricing so early conviction is rewarded and late piling is priced out. Settlement math is validated against a hand-settled reference and 37k historical NBA games.

*Testnet only — all keys and assets are disposable. Not audited; not for real funds.*

## Track

Submitted to **Track 3 — DeFi, Stablecoins & Real-World Assets** (StellarX Philippines workshop).

## Team

- Nickjohn Ibuyat — [@Tobi-Learns](https://github.com/Tobi-Learns)

## License

Released under the [MIT License](LICENSE) — © 2026 Nickjohn Ibuyat.
