//! Typed contract events. Only ids and statuses are emitted — never amounts —
//! so the public ledger shows activity without leaking salaries.

use soroban_sdk::{contractevent, BytesN};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchCreated {
    #[topic]
    pub batch_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchApproved {
    #[topic]
    pub batch_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutPaid {
    #[topic]
    pub payout_id: u64,
    pub batch_id: u64,
}

/// Emitted when an admin anchors an SPP pool deposit reference onto a batch.
/// The `spp_ref` is the 32-byte commitment hash derived from the SPP deposit
/// note — it links the on-chain batch to the off-chain privacy pool deposit
/// without leaking the pooled amount.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SppDepositRecorded {
    #[topic]
    pub batch_id: u64,
    pub spp_ref: BytesN<32>,
}
