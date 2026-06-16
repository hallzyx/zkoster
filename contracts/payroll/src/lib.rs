#![no_std]

//! # ZkosterPayroll
//!
//! Business orchestration for one company workspace: treasury config, batch
//! lifecycle, private payout commitments, and settlement — "the money".
//!
//! It delegates the two non-business concerns:
//! - eligibility ("who can be paid") to `ZkosterCompliance`;
//! - validity ("is the math right") to `ZkosterVerifier`.
//!
//! Privacy: only Pedersen commitments to amounts (per payout and per batch
//! total) are stored on-chain. Cleartext salaries never touch the ledger.

mod clients;
mod contract;
mod error;
mod events;
mod storage;
mod types;

pub use clients::{ComplianceClient, VerifierClient};
pub use contract::{PayrollContract, PayrollContractClient};
pub use error::Error;
pub use types::{Batch, BatchStatus, Config, Payout, PayoutStatus};

#[cfg(test)]
mod test;
