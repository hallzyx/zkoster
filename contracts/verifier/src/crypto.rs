//! BN254 Groth16 verification and Pedersen homomorphic sum check, built on
//! the Soroban X-Ray / Yardstick host functions.

use soroban_sdk::{
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, BytesN, Env, Vec,
};

use zkoster_types::Proof;

use crate::types::VerifyingKey;

/// The BN254 G1 point at infinity is the all-zero 64-byte encoding.
fn g1_identity(e: &Env) -> Bn254G1Affine {
    Bn254G1Affine::from_bytes(BytesN::from_array(e, &[0u8; 64]))
}

/// Verify a Groth16 proof against `vk` for the given public inputs.
///
/// Checks the standard pairing equation rearranged for `pairing_check`
/// (product of pairings == 1):
///
/// ```text
/// e(-A, B) · e(alpha, beta) · e(L, gamma) · e(C, delta) == 1
/// ```
///
/// where `L = IC_0 + Σ input_i · IC_{i+1}`.
///
/// Caller must ensure `vk.ic.len() == public_inputs.len() + 1`.
pub fn verify_groth16(
    e: &Env,
    vk: &VerifyingKey,
    proof: &Proof,
    public_inputs: &Vec<BytesN<32>>,
) -> bool {
    let bn = e.crypto().bn254();

    // L = IC_0 + Σ input_i · IC_{i+1}
    let n = public_inputs.len();
    let ic0 = Bn254G1Affine::from_bytes(vk.ic.get(0).unwrap());
    let l = if n == 0 {
        ic0
    } else {
        let mut vp: Vec<Bn254G1Affine> = Vec::new(e);
        let mut vs: Vec<Bn254Fr> = Vec::new(e);
        for i in 0..n {
            vp.push_back(Bn254G1Affine::from_bytes(vk.ic.get(i + 1).unwrap()));
            vs.push_back(Bn254Fr::from_bytes(public_inputs.get(i).unwrap()));
        }
        let acc = bn.g1_msm(vp, vs);
        bn.g1_add(&ic0, &acc)
    };

    let neg_a = -Bn254G1Affine::from_bytes(proof.a.clone());
    let b = Bn254G2Affine::from_bytes(proof.b.clone());
    let c = Bn254G1Affine::from_bytes(proof.c.clone());
    let alpha = Bn254G1Affine::from_bytes(vk.alpha.clone());
    let beta = Bn254G2Affine::from_bytes(vk.beta.clone());
    let gamma = Bn254G2Affine::from_bytes(vk.gamma.clone());
    let delta = Bn254G2Affine::from_bytes(vk.delta.clone());

    let vp1: Vec<Bn254G1Affine> = vec![e, neg_a, alpha, l, c];
    let vp2: Vec<Bn254G2Affine> = vec![e, b, beta, gamma, delta];
    bn.pairing_check(vp1, vp2)
}

/// Verify that the homomorphic sum of Pedersen commitments equals `total`:
/// `Σ C_i == total` (business rule #5).
///
/// Pedersen commitments are additively homomorphic, so this is a pure group
/// equality. Since G1 points expose no byte equality, we check that
/// `D = (Σ C_i) - total` is the identity via a pairing against any order-r
/// G2 generator — `gamma` from the verifying key serves that role
/// (`e(D, gamma) == 1` iff `D == O`).
pub fn check_commitment_sum(
    e: &Env,
    g2_generator: &BytesN<128>,
    commitments: &Vec<BytesN<64>>,
    total: &BytesN<64>,
) -> bool {
    let bn = e.crypto().bn254();

    let s = if commitments.is_empty() {
        g1_identity(e)
    } else {
        let mut acc = Bn254G1Affine::from_bytes(commitments.get(0).unwrap());
        for i in 1..commitments.len() {
            let ci = Bn254G1Affine::from_bytes(commitments.get(i).unwrap());
            acc = bn.g1_add(&acc, &ci);
        }
        acc
    };

    let neg_total = -Bn254G1Affine::from_bytes(total.clone());
    let d = bn.g1_add(&s, &neg_total);
    let g2 = Bn254G2Affine::from_bytes(g2_generator.clone());
    bn.pairing_check(vec![e, d], vec![e, g2])
}
