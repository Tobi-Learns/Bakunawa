// House seed (v4): the protocol stakes a bounded amount so the ladder shows
// numbers from minute one. The seed can lose — marketing cost, not liquidity
// risk. Regular seed = ticket mints (60%, split evenly across both sides);
// conviction seed = 40% across each side's rungs with geometric decay (a
// curve-guided split per S7(c) can replace the decay later).
//
// Usage: node scripts/house-seed.mjs <marketId> <totalUsdc> [sourceIdentity]
// Default source = platform (the test-USDC issuer, so USDC transfers mint).
// The source account gets BK<id>A/B trustlines automatically (it HOLDS the
// regular seed as tickets — sellable later, like any predictor).

import { execSync } from "child_process";

const CONTRACT = "CDL2YD4DU32BYAQGHKEE4OIF7P73HMQ4HWW3Q6FOPN5SBYQWNMMPEVGP";
const DECAY = 0.65;

const [marketId, totalUsdc, source = "platform"] = process.argv.slice(2);
if (!marketId || !totalUsdc) {
  console.error("usage: node scripts/house-seed.mjs <marketId> <totalUsdc> [source]");
  process.exit(1);
}

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

// ticket trustlines for the regular seed
for (const suffix of ["A", "B"]) {
  sh(`stellar tx new change-trust --source-account ${source} --line BK${marketId}${suffix}:${issuer} --network testnet`);
}

const rungs = market.rungs;
const totalStroops = BigInt(Math.round(Number(totalUsdc) * 1e7));
const regularPerSide = (totalStroops * 30n) / 100n;
const convPerSide = (totalStroops * 20n) / 100n;
const weights = rungs.map((_, k) => DECAY ** k);
const weightSum = weights.reduce((a, b) => a + b, 0);

console.log(`seeding market ${marketId} with ~${totalUsdc} USDC from ${source} (${predictor.slice(0, 6)}…)`);
for (const side of [0, 1]) {
  invoke(`mint_tickets --predictor ${predictor} --id ${marketId} --side ${side} --amount ${regularPerSide}`);
  console.log(`  side ${side} regular (tickets): ${(Number(regularPerSide) / 1e7).toFixed(2)} USDC`);
  for (let k = 0; k < rungs.length; k++) {
    const amount = BigInt(Math.floor((Number(convPerSide) * weights[k]) / weightSum));
    if (amount > 0n) {
      invoke(`place_conviction --predictor ${predictor} --id ${marketId} --side ${side} --rung ${rungs[k]} --amount ${amount}`);
      console.log(`  side ${side} conviction >=${rungs[k]}: ${(Number(amount) / 1e7).toFixed(2)} USDC`);
    }
  }
}
console.log("ladder:", invoke(`get_ladder --id ${marketId}`, false));
