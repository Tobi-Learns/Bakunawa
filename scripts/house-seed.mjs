// House seed (1.7c / cold-start toolkit #1): the protocol stakes a bounded
// amount so the ladder shows numbers from minute one. The seed can lose —
// marketing cost, not liquidity risk. Distribution: 60% winner-only split
// evenly across both sides; 40% across each side's rungs with geometric
// decay (a curve-guided split per S7(c) can replace the decay later).
//
// Usage: node scripts/house-seed.mjs <marketId> <totalUsdc> [sourceIdentity]
// Default source = platform (the test-USDC issuer, so transfers mint).

import { execSync } from "child_process";

const CONTRACT = "CDH2FL75ARKYA2VRZIJ26JXWB743JG4C4DKUPRSQWMTTDI6WLJ7MXHFY";
const DECAY = 0.65;

const [marketId, totalUsdc, source = "platform"] = process.argv.slice(2);
if (!marketId || !totalUsdc) {
  console.error("usage: node scripts/house-seed.mjs <marketId> <totalUsdc> [source]");
  process.exit(1);
}

function invoke(args, send = true) {
  const cmd = `stellar contract invoke --network testnet --source-account ${source} --id ${CONTRACT} ${send ? "--send=yes" : ""} -- ${args}`;
  const out = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  const lines = out.trim().split("\n");
  return lines[lines.length - 1];
}

const bettor = execSync(`stellar keys address ${source}`, { encoding: "utf-8" }).trim();
const market = JSON.parse(invoke(`get_market --id ${marketId}`, false));
if (market.status !== "Open") {
  console.error(`market ${marketId} is ${market.status}, not Open`);
  process.exit(1);
}
const rungs = market.rungs;
const totalStroops = BigInt(Math.round(Number(totalUsdc) * 1e7));

// 60% winner-only (30/30), 40% dominance (20/20 per side, geometric down the rungs)
const winnerOnlyPerSide = (totalStroops * 30n) / 100n;
const domPerSide = (totalStroops * 20n) / 100n;
const weights = rungs.map((_, k) => DECAY ** k);
const weightSum = weights.reduce((a, b) => a + b, 0);

const bets = [];
for (const side of [0, 1]) {
  bets.push({ side, rung: 0, amount: winnerOnlyPerSide });
  for (let k = 0; k < rungs.length; k++) {
    const amount = BigInt(Math.floor((Number(domPerSide) * weights[k]) / weightSum));
    if (amount > 0n) bets.push({ side, rung: rungs[k], amount });
  }
}

console.log(`seeding market ${marketId} with ~${totalUsdc} USDC from ${source} (${bettor.slice(0, 6)}…)`);
for (const b of bets) {
  invoke(
    `place_bet --bettor ${bettor} --id ${marketId} --side ${b.side} --rung ${b.rung} --amount ${b.amount}`,
  );
  console.log(`  side ${b.side} rung ${b.rung}: ${(Number(b.amount) / 1e7).toFixed(2)} USDC`);
}
console.log("ladder:", invoke(`get_ladder --id ${marketId}`, false));
