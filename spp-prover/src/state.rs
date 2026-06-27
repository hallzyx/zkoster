use std::sync::Arc;

use anyhow::{Context as _, Result};
use prover::{
    crypto::{asp_membership_leaf, derive_public_key},
    merkle::MerklePrefixTree,
    prover::Prover as Groth16Prover,
};
use types::{AspMembershipProof, Field, NotePrivateKey, NotePublicKey};
use witness::WitnessCalculator;

/// Fixed demo identity: priv key used for all deposits in this demo server.
/// The corresponding public key's membership leaf must be inserted into the
/// ASP membership contract once (see /spp/membership GET).
pub const DEMO_PRIV_KEY: NotePrivateKey = NotePrivateKey([
    1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0,
]);

/// Fixed blinding used for the ASP membership leaf.
const MEMBERSHIP_BLINDING: [u8; 32] = [
    2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0,
];

pub const ASP_TREE_DEPTH: u32 = 10;
pub const ASP_SMT_DEPTH: u32 = 10;
/// Depth of the pool's incremental Merkle tree (same as circuit param).
pub const POOL_TREE_DEPTH: u32 = 10;

/// Computed membership state for the demo identity.
pub struct MembershipState {
    /// The leaf value to insert once into the on-chain ASP membership contract.
    pub leaf: Field,
    /// ASP membership proof for use in every deposit proof (leaf at index 0).
    pub proof: AspMembershipProof,
}

/// Shared server state — proving artifacts + computed membership state.
pub struct ProverState {
    pub witness_calc: parking_lot::Mutex<WitnessCalculator>,
    pub groth16: Groth16Prover,
    pub membership: MembershipState,
}

pub type SharedState = Arc<ProverState>;

impl ProverState {
    pub fn load(pk_path: &str, r1cs_path: &str, wasm_path: &str) -> Result<Self> {
        let pk_bytes = std::fs::read(pk_path).with_context(|| {
            format!(
                "Cannot read proving key at '{pk_path}'.\n\
                 Run `cargo build -p circuits --release` in the SPP repo first."
            )
        })?;
        let r1cs_bytes = std::fs::read(r1cs_path).with_context(|| {
            format!(
                "Cannot read R1CS at '{r1cs_path}'.\n\
                 Run `cargo build -p circuits --release` in the SPP repo first."
            )
        })?;
        let wasm_bytes = std::fs::read(wasm_path).with_context(|| {
            format!(
                "Cannot read circuit WASM at '{wasm_path}'.\n\
                 Run `cargo build -p circuits --release` in the SPP repo first."
            )
        })?;

        tracing::info!(
            pk_bytes = pk_bytes.len(),
            r1cs_bytes = r1cs_bytes.len(),
            wasm_bytes = wasm_bytes.len(),
            "Proving artifacts loaded"
        );

        let witness_calc = WitnessCalculator::new(&wasm_bytes, &r1cs_bytes)
            .context("Failed to init WitnessCalculator")?;

        let groth16 = Groth16Prover::new(&pk_bytes, &r1cs_bytes)
            .context("Failed to init Groth16 prover")?;

        let membership = compute_membership_state()
            .context("Failed to compute demo membership state")?;

        tracing::info!(
            leaf = hex::encode(membership.leaf.to_le_bytes()),
            "Demo membership leaf computed (must be inserted into ASP contract once)"
        );

        Ok(Self {
            witness_calc: parking_lot::Mutex::new(witness_calc),
            groth16,
            membership,
        })
    }
}

fn compute_membership_state() -> Result<MembershipState> {
    let pubkey_bytes = derive_public_key(DEMO_PRIV_KEY.as_ref())
        .context("derive_public_key failed")?;
    let pubkey_arr: [u8; 32] = pubkey_bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("pubkey: expected 32 bytes"))?;
    let note_pubkey = NotePublicKey(pubkey_arr);

    let blinding = Field::try_from_le_bytes(MEMBERSHIP_BLINDING)
        .map_err(|e| anyhow::anyhow!("membership blinding: {e}"))?;

    let leaf = asp_membership_leaf(&note_pubkey, &blinding)
        .context("asp_membership_leaf failed")?;

    // Build a prefix Merkle tree with only our one leaf at index 0.
    // This matches the on-chain state after a single insert_leaf call.
    let tree = MerklePrefixTree::new(ASP_TREE_DEPTH, &[leaf])
        .context("MerklePrefixTree::new failed")?
        .into_built();

    let mp = tree.proof(0).context("MerkleProof for index 0 failed")?;

    let proof = AspMembershipProof {
        leaf,
        blinding,
        path_elements: mp.path_elements,
        path_indices: mp.path_indices,
        root: mp.root,
    };

    Ok(MembershipState { leaf, proof })
}
