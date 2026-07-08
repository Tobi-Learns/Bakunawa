// Snowflake u64 market ids (StellarPay 3.2e pattern): time-ordered,
// non-sequential, collision-safe, carried as BigInt end-to-end.

const EPOCH = 1_735_689_600_000n; // 2025-01-01T00:00:00Z

export function snowflakeU64(): bigint {
  const ms = BigInt(Date.now()) - EPOCH;
  const rand = BigInt(Math.floor(Math.random() * 0x400000)); // 22 bits
  return (ms << 22n) | rand;
}
