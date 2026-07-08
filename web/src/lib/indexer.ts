// Indexer (Phase 1.6b): reads Bakunawa contract events from Stellar RPC and
// upserts the read-cache through Prisma. Idempotent and self-healing —
// event scanning only *discovers* which markets changed; the actual state is
// always re-read from the contract views (chain is the source of truth).
// Server-side only (route handlers / cron).

import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { getLadder, getMarket, getOutcome } from "./bakunawa";
import { CONFIG } from "./config";
import { db } from "./db";
import { FEED_RESOLUTION, getLastPrice } from "./reflector";

const server = new rpc.Server(CONFIG.rpcUrl);
const FIRST_RUN_LOOKBACK = 9_000; // ledgers (~12h at ~5s) — RPC retention-safe

export async function syncMarket(id: bigint): Promise<void> {
  const market = await getMarket(id);
  const [ladder, outcome] = await Promise.all([
    getLadder(id),
    market.status === "Settled" ? getOutcome(id) : Promise.resolve(null),
  ]);
  const pool = ladder.reduce((a, r) => a + r.stake, 0n);
  const fields = {
    sideA: market.sideA,
    sideB: market.sideB,
    oracle: market.oracle,
    asset: market.oracle === "Reflector" ? market.asset : null,
    rungs: market.rungs,
    closeTs: market.closeTs,
    settleTs: market.settleTs,
    rakeBps: market.rakeBps,
    minPool: market.minPool,
    baseline: market.baseline.toString(),
    ticketA: market.ticketA,
    ticketB: market.ticketB,
    status: market.status,
    pool,
    winner: outcome?.winner ?? null,
    margin: outcome?.margin ?? null,
    losingPool: outcome?.losingPool ?? null,
    rakeAmount: outcome?.rakeAmount ?? null,
  };
  await db.market.upsert({
    where: { id: market.id },
    update: fields, // never touches curator metadata (title/description/curve)
    create: { id: market.id, ...fields },
  });
}

export interface IndexerRun {
  scannedFrom: number;
  latestLedger: number;
  eventsSeen: number;
  marketsSynced: string[];
  positionsInserted: number;
}

export async function runIndexer(explicitIds: bigint[] = []): Promise<IndexerRun> {
  const cursorRow = await db.indexerCursor.findUnique({ where: { id: 1 } });
  const latest = await server.getLatestLedger();
  let start = cursorRow
    ? cursorRow.lastLedger + 1
    : Math.max(2, latest.sequence - FIRST_RUN_LOOKBACK);
  const scannedFrom = start;

  const touched = new Set<bigint>(explicitIds);
  type NewPos = {
    id: string;
    marketId: bigint;
    predictor: string;
    side: number;
    rung: number;
    stake: bigint;
    txHash: string;
    ledger: number;
    at: Date;
  };
  const positions: NewPos[] = [];
  let eventsSeen = 0;
  let latestLedger = latest.sequence;

  for (let page = 0; page < 20; page++) {
    let res;
    try {
      res = await server.getEvents({
        startLedger: start,
        filters: [{ type: "contract", contractIds: [CONFIG.contractId] }],
        limit: 200,
      });
    } catch {
      // start fell out of RPC retention — clamp to a recent window and retry once
      start = Math.max(2, latest.sequence - 1_000);
      res = await server.getEvents({
        startLedger: start,
        filters: [{ type: "contract", contractIds: [CONFIG.contractId] }],
        limit: 200,
      });
    }
    latestLedger = res.latestLedger;
    for (const e of res.events) {
      eventsSeen++;
      try {
        const topics = e.topic.map((t) => scValToNative(t));
        const kind = String(topics[0]);
        const marketId = BigInt(topics[1] as bigint | number | string);
        touched.add(marketId);
        // v4 entry events: "mint" (regular tickets, value (side, amount)) and
        // "conviction" (value (side, rung, amount)). Both recorded as history
        // rows; live regular exposure is the ticket balance, not this table.
        if (kind === "mint" || kind === "conviction") {
          const value = scValToNative(e.value) as (number | bigint)[];
          const side = Number(value[0]);
          const rung = kind === "mint" ? 0 : Number(value[1]);
          const stake = BigInt(value[kind === "mint" ? 1 : 2]);
          positions.push({
            id: e.id,
            marketId,
            predictor: String(topics[2]),
            side,
            rung,
            stake,
            txHash: e.txHash ?? "",
            ledger: e.ledger,
            at: new Date(e.ledgerClosedAt),
          });
        }
      } catch {
        // unknown event shape — skip, never wedge the cursor
      }
    }
    if (res.events.length < 200) break;
    start = res.events[res.events.length - 1].ledger; // re-scan boundary ledger; inserts are idempotent
  }

  const synced: string[] = [];
  for (const id of touched) {
    try {
      await syncMarket(id);
      synced.push(id.toString());
    } catch {
      // market view read failed — retried next run via events or explicit ids
    }
  }

  let positionsInserted = 0;
  if (positions.length > 0) {
    // only keep positions whose market row exists (FK)
    const known = new Set(
      (await db.market.findMany({ select: { id: true } })).map((m) => m.id.toString()),
    );
    const insertable = positions.filter((p) => known.has(p.marketId.toString()));
    if (insertable.length > 0) {
      const res = await db.position.createMany({
        data: insertable,
        skipDuplicates: true, // event id is the PK — reruns are safe
      });
      positionsInserted = res.count;
    }
  }

  await db.indexerCursor.upsert({
    where: { id: 1 },
    update: { lastLedger: latestLedger },
    create: { id: 1, lastLedger: latestLedger },
  });

  await samplePrices().catch(() => {}); // best-effort, never fails the run

  return { scannedFrom, latestLedger, eventsSeen, marketsSynced: synced, positionsInserted };
}

/** 1.9c: record a Reflector price sample for every asset with a live market
 *  (Open, or awaiting settlement) — feeds the price-vs-thresholds chart. */
async function samplePrices(): Promise<void> {
  const live = await db.market.findMany({
    where: { oracle: "Reflector", status: "Open" },
    select: { asset: true },
    distinct: ["asset"],
  });
  for (const { asset } of live) {
    if (!asset) continue;
    const p = await getLastPrice(asset).catch(() => null);
    if (!p) continue;
    const ts = p.timestamp - (p.timestamp % FEED_RESOLUTION);
    await db.priceSample.upsert({
      where: { id: `${asset}-${ts}` },
      update: {},
      create: { id: `${asset}-${ts}`, asset, ts, price: p.price.toString() },
    });
  }
}
