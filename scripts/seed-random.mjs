// Randomized market seeder — fills a market with many randomized trades to
// simulate real activity + volume. Rung selection is per-side weighted so a
// side can look DOMINANT (heavy high-margin convictions) vs meek (low margins).
//
// Usage: node scripts/seed-random.mjs <marketId> <numTrades> [source]
// Tuned for GSW (side 0) dominance vs CAV (side 1): GSW draws skew to high
// rungs, CAV to low. Amounts are random; total volume ~= numTrades * ~750 USDC.
// CLI-based (like house-seed) so trustlines/keychain/sequence just work.

import { execSync } from "child_process";

const CONTRACT = "CBQC2M3DIK3GRXPOWL3R2PR3YGZMY43CVRNZEUWYFZB6I4W5PO43KRAW";
const [marketId, numTradesArg, source = "platform"] = process.argv.slice(2);
if (!marketId || !numTradesArg) {
  console.error("usage: node scripts/seed-random.mjs <marketId> <numTrades> [source]");
  process.exit(1);
}
const numTrades = Number(numTradesArg);

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
const rungs = market.rungs; // e.g. [5,10,15,20,25,30]

// ensure ticket trustlines for regular (rung-0) mints
for (const suffix of ["A", "B"]) {
  try {
    sh(`stellar tx new change-trust --source-account ${source} --line BK${marketId}${suffix}:${issuer} --network testnet`);
  } catch {
    /* already trusts */
  }
}

// per-side rung weights over [0=regular, ...rungs]. GSW (0) skews to deep
// dominance, CAV (1) to shallow margins.
const steps = [0, ...rungs];
const gswW = [12, 8, 10, 16, 18, 16, 14].slice(0, steps.length); // heavy high
const cavW = [28, 26, 20, 12, 7, 5, 3].slice(0, steps.length); // heavy low
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
console.log(`seeding ${numTrades} randomized trades into #${marketId} (GSW-dominance)…`);
for (let t = 0; t < numTrades; t++) {
  const side = Math.random() < 0.65 ? 0 : 1; // GSW gets ~65% of the action
  const stepIdx = pick(side === 0 ? gswW : cavW);
  const rung = steps[stepIdx];
  // deep dominance convictions run smaller; regular/shallow run larger
  const usdc = rung >= 15 ? rint(50, 600) : rint(200, 1600);
  const amount = BigInt(usdc) * 10_000_000n;
  try {
    if (rung === 0) {
      invoke(`mint_tickets --predictor ${predictor} --id ${marketId} --side ${side} --amount ${amount}`);
    } else {
      invoke(`place_conviction --predictor ${predictor} --id ${marketId} --side ${side} --rung ${rung} --amount ${amount}`);
    }
    volume += amount;
    ok++;
    if (ok % 10 === 0) {
      console.log(`  ${ok}/${numTrades} done · volume ~${(Number(volume) / 1e7).toFixed(0)} USDC`);
    }
  } catch (e) {
    console.error(`  trade ${t} (side ${side} rung ${rung}) failed: ${String(e).split("\n")[0]}`);
  }
}
console.log(`\ndone: ${ok}/${numTrades} trades, total volume ~${(Number(volume) / 1e7).toFixed(0)} USDC`);
