// Randomized showcase seeder for the GSW vs CAV dominance market (Game 4, 2015
// Finals). Fires many small, PROBABILISTIC trades so the aggregate APPROXIMATES
// a target shape with natural noise (never exact — that looks designed). Amounts
// are a genuine mix of high and low ($1–$300). Money split = the crowd forecast
// (side_stake tracks dollars), so ~80/20 by trade count ≈ ~80/20 by dollars.
//
// Target shape (Tobi, 2026-07-14), as sampling weights, not exact targets:
//   GSW (side 0) ~80% of trades:  Neutral 20, each of +5..+25 = 16
//   CAV (side 1) ~20% of trades:  Neutral 70, +5 = 10, +10 = 10, deep rest = 10 split
//
// Usage: node scripts/seed-random.mjs <marketId> [numTrades=200] [source=platform]
// Idempotent-friendly: run again to ADD more trades (they just accrue).

import { execSync } from "child_process";

const CONTRACT = "CABM224YYRE67THADIM7NPYKZWM6Q7EOHOVYSD2KRYLRW6BDLTCTL72R";
const [marketId, numArg = "200", source = "platform"] = process.argv.slice(2);
if (!marketId) {
  console.error("usage: node scripts/seed-random.mjs <marketId> [numTrades] [source]");
  process.exit(1);
}
const numTrades = Number(numArg);

const sh = (cmd) => execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const invoke = (args, send = true) => {
  const out = sh(
    `stellar contract invoke --network testnet --source-account ${source} --id ${CONTRACT} ${send ? "--send=yes" : ""} -- ${args}`,
  );
  return out.split("\n").at(-1);
};

const predictor = sh(`stellar keys address ${source}`);
const issuer = sh("stellar keys address issuer");
const market = JSON.parse(invoke(`get_market --id ${marketId}`, false));
if (market.status !== "Open") {
  console.error(`market ${marketId} is ${market.status}, not Open`);
  process.exit(1);
}
const rungs = market.rungs; // expected [5,10,15,20,25]

// ticket trustlines for regular (rung-0) mints
for (const suffix of ["A", "B"]) {
  try {
    sh(`stellar tx new change-trust --source-account ${source} --line BK${marketId}${suffix}:${issuer} --network testnet`);
  } catch {
    /* already trusts */
  }
}

// sampling weights over steps [0=Neutral, ...rungs]
const steps = [0, ...rungs];
const gswW = [20, ...rungs.map(() => 16)]; // Neutral 20, each rung 16
const nDeep = Math.max(1, rungs.length - 2);
const cavW = [70, ...rungs.map((_, i) => (i === 0 || i === 1 ? 10 : 10 / nDeep))];
const pick = (w) => {
  const sum = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return w.length - 1;
};
const rint = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));

let volume = 0n;
let ok = 0;
console.log(`seeding ${numTrades} probabilistic trades into #${marketId} (GSW ~80/20, approx shape)…`);
for (let t = 0; t < numTrades; t++) {
  const side = Math.random() < 0.8 ? 0 : 1; // GSW ~80% of the action
  const rung = steps[pick(side === 0 ? gswW : cavW)];
  const usdc = rint(1, 300); // mix of high and low
  const amount = BigInt(usdc) * 10_000_000n;
  try {
    if (rung === 0) {
      invoke(`mint_tickets --predictor ${predictor} --id ${marketId} --side ${side} --amount ${amount}`);
    } else {
      invoke(`place_conviction --predictor ${predictor} --id ${marketId} --side ${side} --rung ${rung} --amount ${amount}`);
    }
    volume += amount;
    ok++;
    if (ok % 20 === 0) console.log(`  ${ok}/${numTrades} · volume ~${(Number(volume) / 1e7).toFixed(0)} USDC`);
  } catch (e) {
    console.error(`  trade ${t} (side ${side} rung ${rung}) failed: ${String(e).split("\n")[0]}`);
  }
}
console.log(`\ndone: ${ok}/${numTrades} trades, added volume ~${(Number(volume) / 1e7).toFixed(0)} USDC`);
