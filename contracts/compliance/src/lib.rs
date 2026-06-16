#![no_std]

//! # ZkosterCompliance
//!
//! Policy, membership and disclosure for a single company workspace. It owns
//! "who can participate and what they can see" — deliberately separate from
//! "the money" (`ZkosterPayroll`).
//!
//! Responsibilities:
//! - Allowlist of authorized wallets (employees, admins, auditors).
//! - Sanction denylist.
//! - Issue / revoke `DisclosureGrant`s.
//! - Resolve auditor access to a batch or specific payout.

mod contract;
mod error;
mod events;
mod storage;
mod types;

pub use contract::{ComplianceContract, ComplianceContractClient};
pub use error::Error;
pub use types::{DisclosureGrant, Member};

#[cfg(test)]
mod test;
