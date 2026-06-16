use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::types::{Batch, Config, Payout};

const DAY_IN_LEDGERS: u32 = 17280;
const PERSISTENT_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const PERSISTENT_THRESHOLD: u32 = PERSISTENT_BUMP - DAY_IN_LEDGERS;
const INSTANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_IN_LEDGERS;

#[contracttype]
pub enum DataKey {
    Config,
    BatchCounter,
    PayoutCounter,
    Batch(u64),
    Payout(u64),
    /// batch_id -> Vec<payout_id>
    BatchPayouts(u64),
    /// employee -> Vec<payout_id> (index for the employee portal)
    EmployeePayouts(Address),
}

pub fn bump_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

pub fn has_config(e: &Env) -> bool {
    e.storage().instance().has(&DataKey::Config)
}

pub fn get_config(e: &Env) -> Option<Config> {
    e.storage().instance().get(&DataKey::Config)
}

pub fn set_config(e: &Env, cfg: &Config) {
    e.storage().instance().set(&DataKey::Config, cfg);
}

pub fn batch_count(e: &Env) -> u64 {
    e.storage()
        .instance()
        .get(&DataKey::BatchCounter)
        .unwrap_or(0)
}

pub fn next_batch_id(e: &Env) -> u64 {
    let id = batch_count(e) + 1;
    e.storage().instance().set(&DataKey::BatchCounter, &id);
    id
}

pub fn next_payout_id(e: &Env) -> u64 {
    let id: u64 = e
        .storage()
        .instance()
        .get(&DataKey::PayoutCounter)
        .unwrap_or(0)
        + 1;
    e.storage().instance().set(&DataKey::PayoutCounter, &id);
    id
}

pub fn get_batch(e: &Env, batch_id: u64) -> Option<Batch> {
    let key = DataKey::Batch(batch_id);
    let b: Option<Batch> = e.storage().persistent().get(&key);
    if b.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    b
}

pub fn set_batch(e: &Env, batch: &Batch) {
    let key = DataKey::Batch(batch.batch_id);
    e.storage().persistent().set(&key, batch);
    e.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn get_payout(e: &Env, payout_id: u64) -> Option<Payout> {
    let key = DataKey::Payout(payout_id);
    let p: Option<Payout> = e.storage().persistent().get(&key);
    if p.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    p
}

pub fn set_payout(e: &Env, payout: &Payout) {
    let key = DataKey::Payout(payout.payout_id);
    e.storage().persistent().set(&key, payout);
    e.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn get_batch_payouts(e: &Env, batch_id: u64) -> Vec<u64> {
    let key = DataKey::BatchPayouts(batch_id);
    e.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(e))
}

pub fn add_batch_payout(e: &Env, batch_id: u64, payout_id: u64) {
    let key = DataKey::BatchPayouts(batch_id);
    let mut ids = get_batch_payouts(e, batch_id);
    ids.push_back(payout_id);
    e.storage().persistent().set(&key, &ids);
    e.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn get_employee_payouts(e: &Env, employee: &Address) -> Vec<u64> {
    let key = DataKey::EmployeePayouts(employee.clone());
    e.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(e))
}

pub fn add_employee_payout(e: &Env, employee: &Address, payout_id: u64) {
    let key = DataKey::EmployeePayouts(employee.clone());
    let mut ids = get_employee_payouts(e, employee);
    ids.push_back(payout_id);
    e.storage().persistent().set(&key, &ids);
    e.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}
