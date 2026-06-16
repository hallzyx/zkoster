//! End-to-end verification of `verify_groth16` against a REAL Groth16 proof.
//!
//! This closes the gap left by the in-crate unit tests (which only exercise the
//! deterministic, non-pairing paths). Here we:
//!   1. build a genuine Groth16/BN254 proof with arkworks,
//!   2. serialize the VK + proof into the soroban-sdk BN254 byte layout,
//!   3. feed them to the deployed verifier contract and assert it accepts the
//!      valid proof and rejects a tampered public input.
//!
//! NOTE: the circuit here (`a * b == c`) is a minimal *verification fixture*,
//! not the production payout range-proof circuit. Its only job is to produce a
//! real proof so we can validate our on-chain verifier and our serialization.

use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ec::{AffineRepr, CurveGroup};
use ark_ff::{BigInteger, PrimeField};
use ark_groth16::Groth16;
use ark_relations::lc;
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError};
use ark_snark::SNARK;
use ark_std::rand::{rngs::StdRng, SeedableRng};

use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env, Vec};
use zkoster_verifier::{Proof, VerifierContract, VerifierContractClient, VerifyingKey};

/// Proves knowledge of witnesses `a, b` with `a * b == c`, where `c` is public.
#[derive(Clone)]
struct MulCircuit {
    a: Option<Fr>,
    b: Option<Fr>,
    c: Option<Fr>,
}

impl ConstraintSynthesizer<Fr> for MulCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        let a = cs.new_witness_variable(|| self.a.ok_or(SynthesisError::AssignmentMissing))?;
        let b = cs.new_witness_variable(|| self.b.ok_or(SynthesisError::AssignmentMissing))?;
        let c = cs.new_input_variable(|| self.c.ok_or(SynthesisError::AssignmentMissing))?;
        cs.enforce_constraint(lc!() + a, lc!() + b, lc!() + c)?;
        Ok(())
    }
}

fn fq_be(f: &Fq) -> [u8; 32] {
    let mut out = [0u8; 32];
    let bytes = f.into_bigint().to_bytes_be();
    out[32 - bytes.len()..].copy_from_slice(&bytes);
    out
}

fn fr_be(f: &Fr) -> [u8; 32] {
    let mut out = [0u8; 32];
    let bytes = f.into_bigint().to_bytes_be();
    out[32 - bytes.len()..].copy_from_slice(&bytes);
    out
}

fn g1_bytes(p: &G1Affine) -> [u8; 64] {
    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&fq_be(&p.x));
    out[32..].copy_from_slice(&fq_be(&p.y));
    out
}

/// G2 in EIP-197 ordering (imaginary component first): x.c1 || x.c0 || y.c1 || y.c0.
fn g2_bytes(p: &G2Affine) -> [u8; 128] {
    let x: &Fq2 = &p.x;
    let y: &Fq2 = &p.y;
    let mut out = [0u8; 128];
    out[0..32].copy_from_slice(&fq_be(&x.c1));
    out[32..64].copy_from_slice(&fq_be(&x.c0));
    out[64..96].copy_from_slice(&fq_be(&y.c1));
    out[96..128].copy_from_slice(&fq_be(&y.c0));
    out
}

#[test]
fn verifies_real_groth16_proof_and_rejects_tampering() {
    let mut rng = StdRng::seed_from_u64(42);

    // c = a * b
    let a = Fr::from(3u64);
    let b = Fr::from(11u64);
    let c = a * b;

    let circuit = MulCircuit {
        a: Some(a),
        b: Some(b),
        c: Some(c),
    };
    let (pk, vk) =
        Groth16::<Bn254>::circuit_specific_setup(circuit.clone(), &mut rng).unwrap();
    let proof = Groth16::<Bn254>::prove(&pk, circuit, &mut rng).unwrap();

    // Native sanity check before we even touch the contract.
    assert!(Groth16::<Bn254>::verify(&vk, &[c], &proof).unwrap());

    // --- serialize into soroban layout ---
    let env = Env::default();
    env.mock_all_auths();

    let mut ic: Vec<BytesN<64>> = Vec::new(&env);
    for p in vk.gamma_abc_g1.iter() {
        ic.push_back(BytesN::from_array(&env, &g1_bytes(p)));
    }
    let soroban_vk = VerifyingKey {
        alpha: BytesN::from_array(&env, &g1_bytes(&vk.alpha_g1)),
        beta: BytesN::from_array(&env, &g2_bytes(&vk.beta_g2)),
        gamma: BytesN::from_array(&env, &g2_bytes(&vk.gamma_g2)),
        delta: BytesN::from_array(&env, &g2_bytes(&vk.delta_g2)),
        ic,
    };
    let soroban_proof = Proof {
        a: BytesN::from_array(&env, &g1_bytes(&proof.a)),
        b: BytesN::from_array(&env, &g2_bytes(&proof.b)),
        c: BytesN::from_array(&env, &g1_bytes(&proof.c)),
    };

    // --- deploy + verify on-chain ---
    let id = env.register(VerifierContract, ());
    let client = VerifierContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    client.set_vk(&soroban_vk);

    let good_inputs: Vec<BytesN<32>> = vec![&env, BytesN::from_array(&env, &fr_be(&c))];
    assert!(
        client.verify_groth16(&soroban_proof, &good_inputs),
        "valid Groth16 proof must verify on-chain"
    );

    // Tampered public input (c+1) must fail.
    let bad_inputs: Vec<BytesN<32>> =
        vec![&env, BytesN::from_array(&env, &fr_be(&(c + Fr::from(1u64))))];
    assert!(
        !client.verify_groth16(&soroban_proof, &bad_inputs),
        "tampered public input must be rejected"
    );
}

#[test]
fn checks_real_pedersen_commitment_sum() {
    let env = Env::default();
    env.mock_all_auths();

    // Pedersen bases G and H (H independent of G for binding).
    let g = G1Affine::generator();
    let h = (g * Fr::from(31_337u64)).into_affine();

    // Build three real commitments C_i = a_i·G + r_i·H and the matching total.
    let amounts = [Fr::from(1_000u64), Fr::from(2_500u64), Fr::from(750u64)];
    let blinds = [Fr::from(7u64), Fr::from(13u64), Fr::from(21u64)];

    let mut commitments: Vec<BytesN<64>> = Vec::new(&env);
    let mut sum_a = Fr::from(0u64);
    let mut sum_r = Fr::from(0u64);
    for i in 0..3 {
        let c = (g * amounts[i] + h * blinds[i]).into_affine();
        commitments.push_back(BytesN::from_array(&env, &g1_bytes(&c)));
        sum_a += amounts[i];
        sum_r += blinds[i];
    }
    let total = (g * sum_a + h * sum_r).into_affine();
    let total_bytes = BytesN::from_array(&env, &g1_bytes(&total));

    // check_commitment_sum only reads vk.gamma (an order-r G2 generator); the
    // other VK fields are unused here, so identity bytes are fine for them.
    let mut ic: Vec<BytesN<64>> = Vec::new(&env);
    ic.push_back(BytesN::from_array(&env, &[0u8; 64]));
    let vk = VerifyingKey {
        alpha: BytesN::from_array(&env, &[0u8; 64]),
        beta: BytesN::from_array(&env, &[0u8; 128]),
        gamma: BytesN::from_array(&env, &g2_bytes(&G2Affine::generator())),
        delta: BytesN::from_array(&env, &[0u8; 128]),
        ic,
    };

    let id = env.register(VerifierContract, ());
    let client = VerifierContractClient::new(&env, &id);
    client.initialize(&Address::generate(&env));
    client.set_vk(&vk);

    assert!(
        client.check_commitment_sum(&commitments, &total_bytes),
        "Σ C_i must equal the matching total commitment"
    );

    // A total off by one blinding unit must fail.
    let wrong = (g * sum_a + h * (sum_r + Fr::from(1u64))).into_affine();
    let wrong_bytes = BytesN::from_array(&env, &g1_bytes(&wrong));
    assert!(
        !client.check_commitment_sum(&commitments, &wrong_bytes),
        "mismatched total must be rejected"
    );
}
