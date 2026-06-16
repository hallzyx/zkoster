use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Vec};
use zkoster_types::Proof;

use crate::crypto;
use crate::error::Error;
use crate::storage;
use crate::types::VerifyingKey;

/// Stateless mathematical arbiter. Holds only the verifying key; all
/// verification entry points are read-only and reusable.
#[contract]
pub struct VerifierContract;

#[contractimpl]
impl VerifierContract {
    pub fn initialize(e: Env, admin: Address) -> Result<(), Error> {
        if storage::has_admin(&e) {
            return Err(Error::AlreadyInitialized);
        }
        storage::set_admin(&e, &admin);
        storage::bump_instance(&e);
        Ok(())
    }

    pub fn set_admin(e: Env, new_admin: Address) -> Result<(), Error> {
        require_admin(&e)?;
        storage::set_admin(&e, &new_admin);
        Ok(())
    }

    pub fn admin(e: Env) -> Result<Address, Error> {
        storage::get_admin(&e).ok_or(Error::NotInitialized)
    }

    /// Register the Groth16 verifying key for the payroll circuit.
    pub fn set_vk(e: Env, vk: VerifyingKey) -> Result<(), Error> {
        require_admin(&e)?;
        if vk.ic.is_empty() {
            return Err(Error::EmptyVerifyingKey);
        }
        storage::set_vk(&e, &vk);
        Ok(())
    }

    pub fn get_vk(e: Env) -> Option<VerifyingKey> {
        storage::get_vk(&e)
    }

    /// Verify a Groth16 proof (e.g. the payout range proof). Read-only.
    pub fn verify_groth16(
        e: Env,
        proof: Proof,
        public_inputs: Vec<BytesN<32>>,
    ) -> Result<bool, Error> {
        let vk = storage::get_vk(&e).ok_or(Error::VkNotSet)?;
        if vk.ic.len() != public_inputs.len() + 1 {
            return Err(Error::PublicInputLenMismatch);
        }
        Ok(crypto::verify_groth16(&e, &vk, &proof, &public_inputs))
    }

    /// Verify `Σ commitments == total` homomorphically (business rule #5).
    /// Read-only. Reuses the VK's `gamma` as the order-r G2 generator.
    pub fn check_commitment_sum(
        e: Env,
        commitments: Vec<BytesN<64>>,
        total: BytesN<64>,
    ) -> Result<bool, Error> {
        let vk = storage::get_vk(&e).ok_or(Error::VkNotSet)?;
        Ok(crypto::check_commitment_sum(
            &e,
            &vk.gamma,
            &commitments,
            &total,
        ))
    }
}

fn require_admin(e: &Env) -> Result<Address, Error> {
    let admin = storage::get_admin(e).ok_or(Error::NotInitialized)?;
    admin.require_auth();
    storage::bump_instance(e);
    Ok(admin)
}
