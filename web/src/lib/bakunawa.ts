// Bakunawa contract client — the three-step on-chain write pattern
// (build/simulate -> wallet sign -> submit/poll) plus read-only views via
// simulateTransaction. Ported from StellarPay's stellar.ts conventions.

import {
  Address,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { CONFIG } from "./config";

const server = new rpc.Server(CONFIG.rpcUrl);
const contract = new Contract(CONFIG.contractId);

// --- Types mirrored from contracts/bakunawa/src/types.rs ---

export interface MarketView {
  id: bigint;
  sideA: string;
  sideB: string;
  rungs: number[];
  closeTs: number;
  settleTs: number;
  oracle: "Admin" | "Reflector";
  asset: string;
  baseline: bigint;
  rakeBps: number;
  minPool: bigint;
  status: "Open" | "Settled" | "Cancelled";
}

export interface OutcomeView {
  winner: number;
  margin: number;
  losingPool: bigint;
  rakeAmount: bigint;
  sumWeights: bigint;
  winnerStake: bigint;
}

export interface PositionView {
  side: number;
  rung: number;
  stake: bigint;
  claimed: boolean;
}

export interface LadderRowView {
  side: number;
  rung: number;
  stake: bigint;
}

/** contracttype unit enums decode as ["Variant"] or "Variant" — normalize. */
function enumName(v: unknown): string {
  if (Array.isArray(v)) return String(v[0]);
  return String(v);
}

// --- Reads (simulation only, no signing) ---

async function readView(method: string, ...args: xdr.ScVal[]): Promise<unknown> {
  const account = await server.getAccount(CONFIG.readSource);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: CONFIG.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error(`${method} simulation failed`);
  }
  return scValToNative(sim.result.retval);
}

const u64 = (v: bigint | number) => nativeToScVal(BigInt(v), { type: "u64" });
const u32 = (v: number) => nativeToScVal(v, { type: "u32" });
const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const addr = (a: string) => new Address(a).toScVal();

export async function getMarket(id: bigint | number): Promise<MarketView> {
  const m = (await readView("get_market", u64(id))) as Record<string, unknown>;
  return {
    id: m.id as bigint,
    sideA: m.side_a as string,
    sideB: m.side_b as string,
    rungs: (m.rungs as number[]).map(Number),
    closeTs: Number(m.close_ts),
    settleTs: Number(m.settle_ts),
    oracle: enumName(m.oracle) as MarketView["oracle"],
    asset: m.asset as string,
    baseline: m.baseline as bigint,
    rakeBps: Number(m.rake_bps),
    minPool: m.min_pool as bigint,
    status: enumName(m.status) as MarketView["status"],
  };
}

export async function getLadder(id: bigint | number): Promise<LadderRowView[]> {
  const rows = (await readView("get_ladder", u64(id))) as Record<string, unknown>[];
  return rows.map((r) => ({
    side: Number(r.side),
    rung: Number(r.rung),
    stake: r.stake as bigint,
  }));
}

export async function getOutcome(id: bigint | number): Promise<OutcomeView | null> {
  try {
    const o = (await readView("get_outcome", u64(id))) as Record<string, unknown>;
    return {
      winner: Number(o.winner),
      margin: Number(o.margin),
      losingPool: o.losing_pool as bigint,
      rakeAmount: o.rake_amount as bigint,
      sumWeights: o.sum_weights as bigint,
      winnerStake: o.winner_stake as bigint,
    };
  } catch {
    return null; // not settled
  }
}

export async function getPositions(
  id: bigint | number,
  bettor: string,
): Promise<PositionView[]> {
  const rows = (await readView("get_positions", u64(id), addr(bettor))) as Record<
    string,
    unknown
  >[];
  return rows.map((p) => ({
    side: Number(p.side),
    rung: Number(p.rung),
    stake: p.stake as bigint,
    claimed: Boolean(p.claimed),
  }));
}

// --- Writes (build XDR for the wallet to sign) ---

async function buildTxXdr(source: string, op: xdr.Operation): Promise<string> {
  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 100).toString(),
    networkPassphrase: CONFIG.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(120)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) {
    const err = (sim as rpc.Api.SimulateTransactionErrorResponse).error;
    throw new Error(`simulation failed: ${err}`);
  }
  // Resource padding (StellarPay lesson): double write bytes so execution
  // paths that diverge from the simulated one don't blow the budget.
  const r = sim.transactionData.build().resources();
  sim.transactionData.setResources(
    r.instructions(),
    r.diskReadBytes(),
    r.writeBytes() * 2,
  );
  return rpc.assembleTransaction(tx, sim).build().toXDR();
}

export function buildPlaceBetXdr(
  bettor: string,
  id: bigint | number,
  side: number,
  rung: number,
  amount: bigint,
): Promise<string> {
  return buildTxXdr(
    bettor,
    contract.call("place_bet", addr(bettor), u64(id), u32(side), u32(rung), i128(amount)),
  );
}

export function buildClaimXdr(bettor: string, id: bigint | number): Promise<string> {
  return buildTxXdr(bettor, contract.call("claim", addr(bettor), u64(id)));
}

export async function submitAndWait(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, CONFIG.networkPassphrase);
  const send = await server.sendTransaction(tx);
  if (send.status === "ERROR") {
    throw new Error(`submission rejected: ${JSON.stringify(send.errorResult)}`);
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const result = await server.getTransaction(send.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return send.hash;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`transaction failed: ${send.hash}`);
    }
  }
  throw new Error(`transaction not confirmed after 60s: ${send.hash}`);
}
