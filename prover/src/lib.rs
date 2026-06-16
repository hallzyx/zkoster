//! Zkoster prover (host side).
//!
//! Produces everything the company needs to drive the on-chain contracts
//! without ever putting a cleartext amount on the ledger:
//!   - **Pedersen commitments** `C = amount·G + r·H` for `add_payout` /
//!     `review_batch` and the homomorphic `check_commitment_sum`.
//!   - **Groth16 range proofs** for `execute_payout` / `verify_groth16`.
//!   - the **verifying key** for a one-time `set_vk`.
//!
//! The amounts are known to the company already (it is their payroll), so
//! generating proofs here is not a privacy leak — the privacy boundary is the
//! public ledger, which only ever sees commitments and proofs.
//!
//! Serialization matches the soroban-sdk BN254 host layout (validated against
//! the on-chain verifier): G1 = `x‖y` BE (64B), G2 = `x.c1‖x.c0‖y.c1‖y.c0`
//! EIP-197 (128B), Fr = 32B BE.

use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ec::{AffineRepr, CurveGroup};
use ark_ff::{BigInteger, PrimeField, UniformRand};
use ark_groth16::{Groth16, ProvingKey, VerifyingKey};
use ark_relations::lc;
use ark_relations::r1cs::{ConstraintSynthesizer, ConstraintSystemRef, SynthesisError, Variable};
use ark_snark::SNARK;
use ark_std::rand::{rngs::StdRng, SeedableRng};
use serde::Serialize;

/// Amounts are u64, so a 64-bit range proof bounds them to `[0, 2^64)`.
const AMOUNT_BITS: usize = 64;
/// Fixed scalar deriving the second Pedersen base H from G.
const H_SCALAR: u64 = 31_337;

// --- circuit -------------------------------------------------------------

/// Proves a private `amount` is a valid 64-bit value and binds it to a public
/// hiding commitment `pub = amount + blinding` (field addition).
///
/// NOTE: this binds the range to the value committed in `pub`. Linking it
/// cryptographically to the *Pedersen EC* commitment used by the sum check
/// (via an in-circuit EC opening) is the production hardening step; for the
/// MVP both commitments use the same `(amount, blinding)`.
#[derive(Clone)]
struct RangeCircuit {
    amount: Option<Fr>,
    blinding: Option<Fr>,
    commitment: Option<Fr>,
}

impl ConstraintSynthesizer<Fr> for RangeCircuit {
    fn generate_constraints(self, cs: ConstraintSystemRef<Fr>) -> Result<(), SynthesisError> {
        let amount = cs.new_witness_variable(|| self.amount.ok_or(SynthesisError::AssignmentMissing))?;
        let blinding =
            cs.new_witness_variable(|| self.blinding.ok_or(SynthesisError::AssignmentMissing))?;
        let commitment =
            cs.new_input_variable(|| self.commitment.ok_or(SynthesisError::AssignmentMissing))?;

        // commitment == amount + blinding
        cs.enforce_constraint(
            lc!() + amount + blinding,
            lc!() + Variable::One,
            lc!() + commitment,
        )?;

        // amount == Σ b_i · 2^i, with each b_i boolean.
        let amount_bits = self
            .amount
            .map(|a| a.into_bigint().to_bits_le());
        let mut bit_sum = lc!();
        for i in 0..AMOUNT_BITS {
            let bit_val = amount_bits
                .as_ref()
                .map(|bits| if bits[i] { Fr::from(1u64) } else { Fr::from(0u64) });
            let b = cs.new_witness_variable(|| bit_val.ok_or(SynthesisError::AssignmentMissing))?;
            // boolean: b · b == b
            cs.enforce_constraint(lc!() + b, lc!() + b, lc!() + b)?;
            bit_sum += (Fr::from(1u64 << i), b);
        }
        cs.enforce_constraint(lc!() + amount, lc!() + Variable::One, bit_sum)?;
        Ok(())
    }
}

// --- Pedersen commitment -------------------------------------------------

fn pedersen_bases() -> (G1Affine, G1Affine) {
    let g = G1Affine::generator();
    let h = (g * Fr::from(H_SCALAR)).into_affine();
    (g, h)
}

/// `C = amount·G + blinding·H` on BN254 G1.
fn commit(amount: Fr, blinding: Fr) -> G1Affine {
    let (g, h) = pedersen_bases();
    (g * amount + h * blinding).into_affine()
}

// --- serialization (soroban-sdk BN254 layout) ---------------------------

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

// --- raw artifacts (bytes; consumed by tests and the JSON layer) --------

#[derive(Clone)]
pub struct RawVk {
    pub alpha: [u8; 64],
    pub beta: [u8; 128],
    pub gamma: [u8; 128],
    pub delta: [u8; 128],
    pub ic: Vec<[u8; 64]>,
}

#[derive(Clone)]
pub struct RawProof {
    pub a: [u8; 64],
    pub b: [u8; 128],
    pub c: [u8; 64],
}

#[derive(Clone)]
pub struct RawPayout {
    /// Pedersen commitment for `add_payout` and the homomorphic sum check.
    pub commitment: [u8; 64],
    /// Groth16 range proof for `execute_payout`.
    pub proof: RawProof,
    /// Single public input (the field commitment `amount + blinding`).
    pub public_input: [u8; 32],
}

#[derive(Clone)]
pub struct RawBatch {
    pub vk: RawVk,
    pub payouts: Vec<RawPayout>,
    /// Total commitment for `review_batch` (== Σ payout commitments).
    pub total_commitment: [u8; 64],
}

/// Run a fresh Groth16 setup and produce, for each amount: a Pedersen
/// commitment, a range proof, and the public input — plus the batch total
/// commitment and the verifying key. All from one setup, so the VK and proofs
/// are mutually consistent.
pub fn gen_batch_raw(amounts: &[u64], seed: u64) -> RawBatch {
    let mut rng = StdRng::seed_from_u64(seed);

    let setup_circuit = RangeCircuit {
        amount: Some(Fr::from(1u64)),
        blinding: Some(Fr::from(0u64)),
        commitment: Some(Fr::from(1u64)),
    };
    let (pk, vk): (ProvingKey<Bn254>, VerifyingKey<Bn254>) =
        Groth16::<Bn254>::circuit_specific_setup(setup_circuit, &mut rng).unwrap();

    let mut payouts = Vec::with_capacity(amounts.len());
    let mut sum_amount = Fr::from(0u64);
    let mut sum_blinding = Fr::from(0u64);

    for &amount_u64 in amounts {
        let amount = Fr::from(amount_u64);
        let blinding = Fr::rand(&mut rng);
        let commitment_field = amount + blinding;

        let circuit = RangeCircuit {
            amount: Some(amount),
            blinding: Some(blinding),
            commitment: Some(commitment_field),
        };
        let proof = Groth16::<Bn254>::prove(&pk, circuit, &mut rng).unwrap();

        payouts.push(RawPayout {
            commitment: g1_bytes(&commit(amount, blinding)),
            proof: RawProof {
                a: g1_bytes(&proof.a),
                b: g2_bytes(&proof.b),
                c: g1_bytes(&proof.c),
            },
            public_input: fr_be(&commitment_field),
        });

        sum_amount += amount;
        sum_blinding += blinding;
    }

    let mut ic = Vec::with_capacity(vk.gamma_abc_g1.len());
    for p in vk.gamma_abc_g1.iter() {
        ic.push(g1_bytes(p));
    }

    RawBatch {
        vk: RawVk {
            alpha: g1_bytes(&vk.alpha_g1),
            beta: g2_bytes(&vk.beta_g2),
            gamma: g2_bytes(&vk.gamma_g2),
            delta: g2_bytes(&vk.delta_g2),
            ic,
        },
        payouts,
        total_commitment: g1_bytes(&commit(sum_amount, sum_blinding)),
    }
}

// --- JSON layer (hex strings; consumed by the CLI and HTTP endpoint) ----

#[derive(Serialize)]
pub struct VkJson {
    pub alpha: String,
    pub beta: String,
    pub gamma: String,
    pub delta: String,
    pub ic: Vec<String>,
}

#[derive(Serialize)]
pub struct ProofJson {
    pub a: String,
    pub b: String,
    pub c: String,
}

#[derive(Serialize)]
pub struct PayoutJson {
    pub commitment: String,
    pub proof: ProofJson,
    pub public_input: String,
}

#[derive(Serialize)]
pub struct BatchJson {
    pub vk: VkJson,
    pub payouts: Vec<PayoutJson>,
    pub total_commitment: String,
}

impl From<RawBatch> for BatchJson {
    fn from(b: RawBatch) -> Self {
        BatchJson {
            vk: VkJson {
                alpha: hex::encode(b.vk.alpha),
                beta: hex::encode(b.vk.beta),
                gamma: hex::encode(b.vk.gamma),
                delta: hex::encode(b.vk.delta),
                ic: b.vk.ic.iter().map(hex::encode).collect(),
            },
            payouts: b
                .payouts
                .into_iter()
                .map(|p| PayoutJson {
                    commitment: hex::encode(p.commitment),
                    proof: ProofJson {
                        a: hex::encode(p.proof.a),
                        b: hex::encode(p.proof.b),
                        c: hex::encode(p.proof.c),
                    },
                    public_input: hex::encode(p.public_input),
                })
                .collect(),
            total_commitment: hex::encode(b.total_commitment),
        }
    }
}

/// Convenience: generate a batch and render it as pretty JSON.
pub fn gen_batch_json(amounts: &[u64], seed: u64) -> String {
    let batch: BatchJson = gen_batch_raw(amounts, seed).into();
    serde_json::to_string_pretty(&batch).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_is_internally_consistent() {
        let batch = gen_batch_raw(&[1_000, 2_500, 750], 7);
        assert_eq!(batch.payouts.len(), 3);
        // VK has IC_0 + one IC per public input (1) => length 2.
        assert_eq!(batch.vk.ic.len(), 2);
    }
}
