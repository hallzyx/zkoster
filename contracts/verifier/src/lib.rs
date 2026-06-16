#![no_std]

//! # ZkosterVerifier
//!
//! Stateless ZK / cryptography arbiter for the Zkoster suite. It answers a
//! single question — "is this proof / sum valid?" — and holds no business
//! logic. Built on Soroban's BN254 host functions (Protocol 25 X-Ray +
//! Protocol 26 Yardstick).
//!
//! - `verify_groth16`: validates a Groth16 proof (the payout range proof).
//! - `check_commitment_sum`: validates `Σ Pedersen commitments == total`.

mod contract;
mod crypto;
mod error;
mod storage;
mod types;

pub use contract::{VerifierContract, VerifierContractClient};
pub use error::Error;
pub use types::VerifyingKey;
pub use zkoster_types::Proof;

#[cfg(test)]
mod test;
