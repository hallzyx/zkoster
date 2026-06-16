#![cfg(test)]

use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env, Vec};

use zkoster_types::Proof;

use crate::error::Error;
use crate::types::VerifyingKey;
use crate::{VerifierContract, VerifierContractClient};

fn setup<'a>() -> (Env, VerifierContractClient<'a>) {
    let e = Env::default();
    e.mock_all_auths();
    let id = e.register(VerifierContract, ());
    let client = VerifierContractClient::new(&e, &id);
    let admin = Address::generate(&e);
    client.initialize(&admin);
    (e, client)
}

fn dummy_vk(e: &Env, ic_len: u32) -> VerifyingKey {
    let g1 = BytesN::from_array(e, &[0u8; 64]);
    let g2 = BytesN::from_array(e, &[0u8; 128]);
    let mut ic: Vec<BytesN<64>> = Vec::new(e);
    for _ in 0..ic_len {
        ic.push_back(g1.clone());
    }
    VerifyingKey {
        alpha: g1.clone(),
        beta: g2.clone(),
        gamma: g2.clone(),
        delta: g2,
        ic,
    }
}

fn dummy_proof(e: &Env) -> Proof {
    Proof {
        a: BytesN::from_array(e, &[0u8; 64]),
        b: BytesN::from_array(e, &[0u8; 128]),
        c: BytesN::from_array(e, &[0u8; 64]),
    }
}

#[test]
fn initialize_and_double_init() {
    let (e, client) = setup();
    let other = Address::generate(&e);
    assert_eq!(
        client.try_initialize(&other),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn set_vk_before_init_fails() {
    let e = Env::default();
    e.mock_all_auths();
    let id = e.register(VerifierContract, ());
    let client = VerifierContractClient::new(&e, &id);
    assert_eq!(
        client.try_set_vk(&dummy_vk(&e, 2)),
        Err(Ok(Error::NotInitialized))
    );
}

#[test]
fn set_vk_rejects_empty_ic() {
    let (e, client) = setup();
    assert_eq!(
        client.try_set_vk(&dummy_vk(&e, 0)),
        Err(Ok(Error::EmptyVerifyingKey))
    );
}

#[test]
fn set_and_get_vk_roundtrip() {
    let (e, client) = setup();
    let vk = dummy_vk(&e, 3);
    client.set_vk(&vk);
    assert_eq!(client.get_vk(), Some(vk));
}

#[test]
fn verify_groth16_without_vk_errors() {
    let (e, client) = setup();
    let inputs: Vec<BytesN<32>> = vec![&e, BytesN::from_array(&e, &[0u8; 32])];
    assert_eq!(
        client.try_verify_groth16(&dummy_proof(&e), &inputs),
        Err(Ok(Error::VkNotSet))
    );
}

#[test]
fn verify_groth16_rejects_input_length_mismatch() {
    let (e, client) = setup();
    // ic_len = 3 => expects exactly 2 public inputs.
    client.set_vk(&dummy_vk(&e, 3));
    let one_input: Vec<BytesN<32>> = vec![&e, BytesN::from_array(&e, &[0u8; 32])];
    assert_eq!(
        client.try_verify_groth16(&dummy_proof(&e), &one_input),
        Err(Ok(Error::PublicInputLenMismatch))
    );
}

#[test]
fn check_commitment_sum_without_vk_errors() {
    let (e, client) = setup();
    let commitments: Vec<BytesN<64>> = vec![&e, BytesN::from_array(&e, &[0u8; 64])];
    let total = BytesN::from_array(&e, &[0u8; 64]);
    assert_eq!(
        client.try_check_commitment_sum(&commitments, &total),
        Err(Ok(Error::VkNotSet))
    );
}
