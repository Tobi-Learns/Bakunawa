//! Reflector oracle client interface (SEP-40 style).
//! Testnet external CEX/DEX feed: CCYOZJCOPG34LLQQ7N24YXBM7LL62R7ONMZ3G6WZAAYPB5OYKOMJRN63
//! (14 decimals, 300s resolution — verified live 2026-07-08, see pipeline 1.2a).
//! Variant and field names must match Reflector's on-chain types exactly.

use soroban_sdk::{contractclient, contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum ReflectorAsset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[allow(dead_code)] // the trait exists to generate ReflectorClient
#[contractclient(name = "ReflectorClient")]
pub trait ReflectorOracle {
    /// Most recent price record for the asset.
    fn lastprice(env: Env, asset: ReflectorAsset) -> Option<PriceData>;
    /// Price at a specific timestamp (must align to the feed resolution;
    /// history is retained for a limited window).
    fn price(env: Env, asset: ReflectorAsset, timestamp: u64) -> Option<PriceData>;
    /// Feed update interval in seconds (300 on the testnet CEX/DEX feed).
    fn resolution(env: Env) -> u32;
    /// Price decimals (14 on the testnet CEX/DEX feed).
    fn decimals(env: Env) -> u32;
}
