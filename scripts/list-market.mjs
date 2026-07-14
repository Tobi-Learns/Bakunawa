// List a v4 market end-to-end (curator-local, keys stay in the CLI keychain):
//   1. per-side classic ticket assets BK<id>A / BK<id>B (issuer identity)
//   2. deploy their SACs
//   3. pre-mint ticket supply into the Market contract's custody
//   4. create_market with the ticket SAC addresses (platform = admin)
//
// Usage:
//   node scripts/list-market.mjs <id> <sideA> <sideB> <rungsCsv> <closeInSec> <settleInSec> <Reflector|Admin> [asset=BTC] [rakeBps=300] [minPoolUsdc=0]
// Note: ticket codes embed the market id — keep demo ids short (<=9 digits).

import { execSync } from "child_process";

const CONTRACT = "CABM224YYRE67THADIM7NPYKZWM6Q7EOHOVYSD2KRYLRW6BDLTCTL72R";
const FEED = "CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63";
const TICKET_SUPPLY = "10000000000000000"; // 1B tickets (stroops)

const [id, sideA, sideB, rungsCsv, closeIn, settleIn, oracle, asset = "BTC",
       rakeBps = "300", minPoolUsdc = "0",
       // Phase 2 optimistic oracle: Admin markets need a positive dispute window;
       // Reflector markets ignore these (still passed, set to 0 window there).
       disputeSecs = "86400", disputeBondBps = "100"] = process.argv.slice(2);
if (!id || !sideA || !sideB || !rungsCsv || !closeIn || !settleIn || !oracle) {
  console.error("usage: node scripts/list-market.mjs <id> <sideA> <sideB> <rungsCsv> <closeInSec> <settleInSec> <Reflector|Admin> [asset] [rakeBps] [minPoolUsdc]");
  process.exit(1);
}
if (id.length > 9) {
  console.error("id too long for ticket asset codes (max 9 digits)");
  process.exit(1);
}

const sh = (cmd) => execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const last = (out) => out.split("\n").at(-1);

const issuer = sh("stellar keys address issuer");
const now = Math.floor(Date.now() / 1000);
const closeTs = now + Number(closeIn);
const settleTs = now + Number(settleIn);
const rungs = rungsCsv.split(",").map((s) => Number(s.trim()));
const minPool = BigInt(Math.round(Number(minPoolUsdc) * 1e7)).toString();

const sacs = [];
for (const suffix of ["A", "B"]) {
  const code = `BK${id}${suffix}`;
  const sac = last(sh(
    `stellar contract asset deploy --source-account issuer --asset ${code}:${issuer} --network testnet`,
  ));
  sh(`stellar contract invoke --network testnet --source-account issuer --id ${sac} --send=yes -- transfer --from ${issuer} --to ${CONTRACT} --amount ${TICKET_SUPPLY}`);
  console.log(`ticket ${code}: ${sac} (supply pre-minted to contract)`);
  sacs.push(sac);
}

const params = {
  id: Number(id),
  side_a: sideA,
  side_b: sideB,
  rungs,
  close_ts: closeTs,
  settle_ts: settleTs,
  oracle,
  feed: oracle === "Reflector" ? FEED : CONTRACT,
  asset: oracle === "Reflector" ? asset : "NA",
  rake_bps: Number(rakeBps),
  min_pool: minPool,
  ticket_a: sacs[0],
  ticket_b: sacs[1],
  dispute_secs: oracle === "Reflector" ? 0 : Number(disputeSecs),
  dispute_bond_bps: Number(disputeBondBps),
};
sh(`stellar contract invoke --network testnet --source-account platform --id ${CONTRACT} --send=yes -- create_market --params ${JSON.stringify(JSON.stringify(params))}`);
console.log(`market #${id} listed: ${sideA} vs ${sideB}, rungs [${rungs}], ` +
  `locks ${new Date(closeTs * 1000).toISOString()}, settles ${new Date(settleTs * 1000).toISOString()}`);
console.log("remember: sync the cache ->  curl -X POST '<base>/api/indexer/run?ids=" + id + "' -H 'Authorization: Bearer $BAKUNAWA_CRON_SECRET'");
