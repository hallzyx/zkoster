//! Proves the loop is closed: artifacts produced by the prover are accepted by
//! the REAL `ZkosterVerifier` contract — range proofs verify and the Pedersen
//! commitments sum to the batch total, all on-chain, no mocks.

use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env, Vec};
use zkoster_prover::gen_batch_raw;
use zkoster_verifier::{Proof, VerifierContract, VerifierContractClient, VerifyingKey};

#[test]
fn prover_artifacts_verify_onchain() {
    let batch = gen_batch_raw(&[1_000, 2_500, 750], 7);

    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(VerifierContract, ());
    let client = VerifierContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));

    // One-time VK registration.
    let mut ic: Vec<BytesN<64>> = Vec::new(&env);
    for x in batch.vk.ic.iter() {
        ic.push_back(BytesN::from_array(&env, x));
    }
    client.set_vk(&VerifyingKey {
        alpha: BytesN::from_array(&env, &batch.vk.alpha),
        beta: BytesN::from_array(&env, &batch.vk.beta),
        gamma: BytesN::from_array(&env, &batch.vk.gamma),
        delta: BytesN::from_array(&env, &batch.vk.delta),
        ic,
    });

    // Every payout's range proof verifies on-chain.
    let mut commitments: Vec<BytesN<64>> = Vec::new(&env);
    for p in batch.payouts.iter() {
        let proof = Proof {
            a: BytesN::from_array(&env, &p.proof.a),
            b: BytesN::from_array(&env, &p.proof.b),
            c: BytesN::from_array(&env, &p.proof.c),
        };
        let inputs: Vec<BytesN<32>> = vec![&env, BytesN::from_array(&env, &p.public_input)];
        assert!(
            client.verify_groth16(&proof, &inputs),
            "range proof must verify on-chain"
        );
        commitments.push_back(BytesN::from_array(&env, &p.commitment));
    }

    // The commitments sum homomorphically to the batch total.
    let total = BytesN::from_array(&env, &batch.total_commitment);
    assert!(
        client.check_commitment_sum(&commitments, &total),
        "Σ commitments must equal the batch total"
    );
}
