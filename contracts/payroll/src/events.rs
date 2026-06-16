//! Typed contract events. Only ids and statuses are emitted — never amounts —
//! so the public ledger shows activity without leaking salaries.

use soroban_sdk::contractevent;

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
