//! Typed cross-contract client interfaces.
//!
//! `#[contractclient]` generates a client struct WITHOUT emitting the callee's
//! exported wasm functions, so payroll can make typed calls to compliance and
//! verifier without depending on their contract crates (which would collide on
//! exported symbols like `initialize`/`admin` at link time).

use soroban_sdk::{contractclient, Address, BytesN, Env, Vec};
use zkoster_types::Proof;

// The traits exist only so `#[contractclient]` can generate the client
// structs; the traits themselves are never called directly.
#[allow(dead_code)]
#[contractclient(name = "ComplianceClient")]
pub trait ComplianceInterface {
    fn is_authorized(e: Env, wallet: Address) -> bool;
}

#[allow(dead_code)]
#[contractclient(name = "VerifierClient")]
pub trait VerifierInterface {
    fn check_commitment_sum(e: Env, commitments: Vec<BytesN<64>>, total: BytesN<64>) -> bool;
    fn verify_groth16(e: Env, proof: Proof, public_inputs: Vec<BytesN<32>>) -> bool;
}
