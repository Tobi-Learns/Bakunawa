// One-off DDL script (StellarPay pattern: prisma db push stalls on the 6543
// pooler; simple DDL over it works fine). Run from web/ with:
//   node --env-file=.env ddl-bakunawa.mjs
// Delete after a successful run per convention — kept in-repo this once so a
// fresh checkout can create the tables without prisma db push.

import pg from "pg";

const client = new pg.Client({ connectionString: process.env.TRANSACTION_URL });
await client.connect();

await client.query(`
CREATE TABLE IF NOT EXISTS "BakunawaMarket" (
  "id"          BIGINT PRIMARY KEY,
  "sideA"       TEXT NOT NULL,
  "sideB"       TEXT NOT NULL,
  "oracle"      TEXT NOT NULL,
  "asset"       TEXT,
  "rungs"       INTEGER[] NOT NULL DEFAULT '{}',
  "closeTs"     INTEGER NOT NULL,
  "settleTs"    INTEGER NOT NULL,
  "rakeBps"     INTEGER NOT NULL,
  "minPool"     BIGINT NOT NULL DEFAULT 0,
  "baseline"    TEXT,
  "ticketA"     TEXT,
  "ticketB"     TEXT,
  "status"      TEXT NOT NULL,
  "pool"        BIGINT NOT NULL DEFAULT 0,
  "winner"      INTEGER,
  "margin"      INTEGER,
  "losingPool"  BIGINT,
  "rakeAmount"  BIGINT,
  "title"       TEXT,
  "description" TEXT,
  "category"    TEXT,
  "curve"       JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
await client.query(
  `CREATE INDEX IF NOT EXISTS "BakunawaMarket_status_idx" ON "BakunawaMarket"("status")`,
);
await client.query(`
CREATE TABLE IF NOT EXISTS "BakunawaPosition" (
  "id"       TEXT PRIMARY KEY,
  "marketId" BIGINT NOT NULL REFERENCES "BakunawaMarket"("id"),
  "bettor"   TEXT NOT NULL,
  "side"     INTEGER NOT NULL,
  "rung"     INTEGER NOT NULL,
  "stake"    BIGINT NOT NULL,
  "txHash"   TEXT NOT NULL,
  "ledger"   INTEGER NOT NULL,
  "at"       TIMESTAMP(3) NOT NULL
)`);
await client.query(
  `CREATE INDEX IF NOT EXISTS "BakunawaPosition_bettor_idx" ON "BakunawaPosition"("bettor")`,
);
await client.query(
  `CREATE INDEX IF NOT EXISTS "BakunawaPosition_marketId_idx" ON "BakunawaPosition"("marketId")`,
);
await client.query(`
CREATE TABLE IF NOT EXISTS "BakunawaCursor" (
  "id"         INTEGER PRIMARY KEY DEFAULT 1,
  "lastLedger" INTEGER NOT NULL,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

const check = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'Bakunawa%' ORDER BY 1`,
);
console.log("tables:", check.rows.map((r) => r.table_name).join(", "));
await client.end();
