use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::types::{DisclosureGrant, Member};

// ~5s per ledger → 17280 ledgers/day.
const DAY_IN_LEDGERS: u32 = 17280;
const PERSISTENT_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const PERSISTENT_THRESHOLD: u32 = PERSISTENT_BUMP - DAY_IN_LEDGERS;
const INSTANCE_BUMP: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_THRESHOLD: u32 = INSTANCE_BUMP - DAY_IN_LEDGERS;

#[contracttype]
pub enum DataKey {
    /// Instance admin (the company's ops wallet).
    Admin,
    /// Monotonic counter for grant ids.
    GrantCounter,
    /// wallet -> Member
    Member(Address),
    /// wallet -> () presence marker for the sanction denylist.
    Denied(Address),
    /// grant_id -> DisclosureGrant
    Grant(u64),
    /// grantee -> Vec<grant_id> (index for access resolution)
    GranteeGrants(Address),
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

pub fn next_grant_id(e: &Env) -> u64 {
    let id: u64 = e
        .storage()
        .instance()
        .get(&DataKey::GrantCounter)
        .unwrap_or(0)
        + 1;
    e.storage().instance().set(&DataKey::GrantCounter, &id);
    id
}

pub fn get_member(e: &Env, wallet: &Address) -> Option<Member> {
    let key = DataKey::Member(wallet.clone());
    let m: Option<Member> = e.storage().persistent().get(&key);
    if m.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    m
}

pub fn set_member(e: &Env, member: &Member) {
    let key = DataKey::Member(member.wallet.clone());
    e.storage().persistent().set(&key, member);
    e.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn is_denied(e: &Env, wallet: &Address) -> bool {
    e.storage()
        .persistent()
        .has(&DataKey::Denied(wallet.clone()))
}

pub fn set_denied(e: &Env, wallet: &Address, denied: bool) {
    let key = DataKey::Denied(wallet.clone());
    if denied {
        e.storage().persistent().set(&key, &());
        e.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    } else {
        e.storage().persistent().remove(&key);
    }
}

pub fn get_grant(e: &Env, grant_id: u64) -> Option<DisclosureGrant> {
    let key = DataKey::Grant(grant_id);
    let g: Option<DisclosureGrant> = e.storage().persistent().get(&key);
    if g.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    g
}

pub fn set_grant(e: &Env, grant: &DisclosureGrant) {
    let key = DataKey::Grant(grant.grant_id);
    e.storage().persistent().set(&key, grant);
    e.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

pub fn get_grantee_grants(e: &Env, grantee: &Address) -> Vec<u64> {
    let key = DataKey::GranteeGrants(grantee.clone());
    e.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(e))
}

pub fn add_grantee_grant(e: &Env, grantee: &Address, grant_id: u64) {
    let key = DataKey::GranteeGrants(grantee.clone());
    let mut ids = get_grantee_grants(e, grantee);
    ids.push_back(grant_id);
    e.storage().persistent().set(&key, &ids);
    e.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}
