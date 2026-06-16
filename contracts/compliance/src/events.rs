//! Typed contract events. Topic = struct name in snake_case, plus any
//! `#[topic]` fields. These let the frontend/indexer subscribe to compliance
//! activity without exposing any private data.

use soroban_sdk::{contractevent, Address};
use zkoster_types::{DisclosureScope, MemberRole, MemberStatus};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberRegistered {
    #[topic]
    pub wallet: Address,
    pub role: MemberRole,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberStatusChanged {
    #[topic]
    pub wallet: Address,
    pub status: MemberStatus,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberDenied {
    #[topic]
    pub wallet: Address,
    pub denied: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GrantIssued {
    #[topic]
    pub grantee: Address,
    pub grant_id: u64,
    pub batch_id: u64,
    pub scope: DisclosureScope,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GrantRevoked {
    #[topic]
    pub grant_id: u64,
}
