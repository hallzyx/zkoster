use soroban_sdk::{contracttype, Address, Env};

use crate::types::VerifyingKey;

const DAY_IN_LEDGERS: u32 = 17280;
const INSTANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_IN_LEDGERS;

#[contracttype]
pub enum DataKey {
    Admin,
    Vk,
}

pub fn bump_instance(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

pub fn has_admin(e: &Env) -> bool {
    e.storage().instance().has(&DataKey::Admin)
}

pub fn get_admin(e: &Env) -> Option<Address> {
    e.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(e: &Env, admin: &Address) {
    e.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_vk(e: &Env) -> Option<VerifyingKey> {
    e.storage().instance().get(&DataKey::Vk)
}

pub fn set_vk(e: &Env, vk: &VerifyingKey) {
    e.storage().instance().set(&DataKey::Vk, vk);
}
