#![no_std]

//! Shared domain types for the Zkoster contract suite.
//!
//! Only types that cross contract boundaries (or are reused by off-chain
//! clients) live here. Per-contract storage keys and error enums stay local
//! to each contract.

use soroban_sdk::{contracttype, BytesN};

/// Role of a participant within a company's compliance set.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemberRole {
    Employee = 0,
    Auditor = 1,
    Admin = 2,
}

/// Authorization status of a member. Drives eligibility for payouts and
/// auditor access resolution.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemberStatus {
    Authorized = 0,
    Revoked = 1,
}

/// How much a `DisclosureGrant` lets an auditor see.
///
/// - `TotalsOnly`: batch total commitment opening only (no individual amounts).
/// - `Sample`: a defined subset of payouts within the batch.
/// - `FullBatch`: every payout in the batch.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisclosureScope {
    TotalsOnly = 0,
    Sample = 1,
    FullBatch = 2,
}

/// A Groth16 proof (A in G1, B in G2, C in G1), serialized per the soroban-sdk
/// BN254 layout. Lives in the shared crate because both the verifier (which
/// checks it) and payroll (which forwards it) reference the type, without
/// coupling to each other's contract crate.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}
