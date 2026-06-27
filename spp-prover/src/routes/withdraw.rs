use axum::{Json, extract::State};
use prover::{
    crypto::derive_public_key,
    flows::{TransactInputNote, WithdrawParams, withdraw},
    merkle::MerklePrefixTree,
};
use serde::{Deserialize, Serialize};
use types::{
    AspNonMembershipProof, EncryptionPublicKey, ExtAmount, Field, NoteAmount,
};

use crate::{
    routes::deposit::{base64_xdr, parse_field_be_hex},
    soroban_encode::{hash_ext_data, pool_ext_data_to_scval, pool_proof_to_scval},
    state::{ASP_SMT_DEPTH, ASP_TREE_DEPTH, DEMO_PRIV_KEY, POOL_TREE_DEPTH, SharedState},
};

/// Input note data needed to spend a previously deposited note.
#[derive(Debug, Deserialize)]
pub struct InputNoteData {
    /// Original deposit amount in stroops.
    pub amount_stroops: u64,
    /// Note blinding (LE hex 32B) — returned by POST /spp/deposit response.
    pub blinding_le_hex: String,
    /// All pool commitments in insertion order (BE hex 32B each).
    /// Used to reconstruct the Merkle path for this note.
    pub all_pool_commitments_be_hex: Vec<String>,
    /// Zero-based index of this note's commitment in the pool tree.
    pub leaf_index: u32,
}

#[derive(Debug, Deserialize)]
pub struct WithdrawRequest {
    /// Amount to withdraw in stroops. Must equal input_note.amount_stroops for
    /// a full withdrawal (no change output).
    pub withdraw_amount_stroops: u64,
    /// Current pool Merkle root (BE hex 32B). Read from on-chain after deposit.
    pub pool_root: String,
    /// ASP non-membership SMT root (BE hex 32B). From on-chain.
    pub asp_non_membership_root: String,
    /// Stellar address that will receive the withdrawn USDC.
    pub withdraw_recipient: String,
    /// The input note to spend.
    pub input_note: InputNoteData,
}

#[derive(Debug, Serialize)]
pub struct WithdrawResponse {
    /// Base64 XDR of the pool `Proof` ScVal (transact arg 0).
    pub proof_scval_xdr_b64: String,
    /// Base64 XDR of the pool `ExtData` ScVal (transact arg 1).
    pub ext_data_scval_xdr_b64: String,
    /// Hex representation of output_commitment0 (BE).
    pub output_commitment0: String,
    /// Hex representation of output_commitment1 (BE).
    pub output_commitment1: String,
    /// Hex representation of input_nullifier0 (BE) — submit with tx to prevent replay.
    pub input_nullifier0: String,
    /// Hex representation of input_nullifier1 (BE).
    pub input_nullifier1: String,
}

pub async fn handler(
    State(state): State<SharedState>,
    Json(req): Json<WithdrawRequest>,
) -> Result<Json<WithdrawResponse>, String> {
    generate_withdraw_proof(state, req)
        .await
        .map(Json)
        .map_err(|e| format!("withdraw proof error: {e:#}"))
}

async fn generate_withdraw_proof(
    state: SharedState,
    req: WithdrawRequest,
) -> anyhow::Result<WithdrawResponse> {
    tracing::info!(recipient = %req.withdraw_recipient, "withdraw request");

    let pool_root = parse_field_be_hex(&req.pool_root, "pool_root")?;
    let asp_non_membership_root =
        parse_field_be_hex(&req.asp_non_membership_root, "asp_non_membership_root")?;

    // Parse the input note.
    let note = &req.input_note;
    let note_amount = NoteAmount::try_from(ExtAmount::from(note.amount_stroops as i128))?;

    let blinding = {
        let s = note.blinding_le_hex.strip_prefix("0x").unwrap_or(&note.blinding_le_hex);
        let bytes = hex::decode(s)
            .map_err(|e| anyhow::anyhow!("blinding_le_hex: invalid hex: {e}"))?;
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("blinding_le_hex: expected 32 bytes"))?;
        Field::try_from_le_bytes(arr).map_err(|e| anyhow::anyhow!("blinding_le_hex: {e}"))?
    };

    // Reconstruct pool Merkle path from all commitments + index.
    let pool_leaves = req
        .input_note
        .all_pool_commitments_be_hex
        .iter()
        .enumerate()
        .map(|(i, s)| parse_field_be_hex(s, &format!("commitment[{i}]")))
        .collect::<anyhow::Result<Vec<Field>>>()?;

    let merkle_proof = MerklePrefixTree::new(POOL_TREE_DEPTH, &pool_leaves)?
        .into_built()
        .proof(note.leaf_index)?;

    let input_note = TransactInputNote {
        amount: note_amount,
        blinding,
        merkle_path_elements: merkle_proof.path_elements,
        merkle_path_indices: merkle_proof.path_indices,
    };

    // Demo identity is always the note owner.
    let priv_key = DEMO_PRIV_KEY;
    let pubkey_bytes = derive_public_key(priv_key.as_ref())?;
    let pubkey_arr: [u8; 32] = pubkey_bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("pubkey: expected 32 bytes"))?;

    let depositor_pubkey =
        Field::try_from_le_bytes(pubkey_arr).map_err(|e| anyhow::anyhow!("{e}"))?;

    let membership_proof = state.membership.proof.clone();

    let non_membership_proof = AspNonMembershipProof {
        key: depositor_pubkey,
        old_key: Field::ZERO,
        old_value: Field::ZERO,
        is_old0: true,
        siblings: vec![Field::ZERO; ASP_SMT_DEPTH as usize],
        root: asp_non_membership_root,
    };

    let withdraw_amount = ExtAmount::from(req.withdraw_amount_stroops as i128);

    let params = WithdrawParams {
        priv_key,
        encryption_pubkey: EncryptionPublicKey(pubkey_arr),
        pool_root,
        withdraw_recipient: req.withdraw_recipient.clone(),
        withdraw_amount,
        inputs: vec![input_note],
        outputs: None,
        membership_proof,
        non_membership_proof,
        tree_depth: ASP_TREE_DEPTH,
        smt_depth: ASP_SMT_DEPTH,
    };

    let state2 = state.clone();
    let result = tokio::task::spawn_blocking(move || run_proof_pipeline(state2, params))
        .await
        .map_err(|e| anyhow::anyhow!("thread panicked: {e:?}"))??;

    Ok(result)
}

fn run_proof_pipeline(
    state: SharedState,
    params: WithdrawParams,
) -> anyhow::Result<WithdrawResponse> {
    let artifacts = withdraw(params, |ext| hash_ext_data(ext))?;

    let prepared = &artifacts.prepared;
    let circuit_inputs_json = serde_json::to_string(&artifacts.circuit_inputs)?;

    let witness_bytes = {
        let mut calc = state.witness_calc.lock();
        calc.compute_witness(&circuit_inputs_json)?
    };

    let proof_bytes = state.groth16.prove_bytes_uncompressed(&witness_bytes)?;

    let proof_scval = pool_proof_to_scval(
        &proof_bytes,
        prepared.pool_root,
        &prepared.input_nullifiers,
        prepared.output_commitments[0],
        prepared.output_commitments[1],
        prepared.public_amount_field,
        prepared.ext_data_hash_be,
        prepared.asp_membership_root,
        prepared.asp_non_membership_root,
    )?;
    let proof_b64 = base64_xdr(&proof_scval)?;

    let ext_scval = pool_ext_data_to_scval(&artifacts.ext_data)?;
    let ext_b64 = base64_xdr(&ext_scval)?;

    let field_hex = |f: Field| hex::encode(f.to_be_bytes());

    Ok(WithdrawResponse {
        proof_scval_xdr_b64: proof_b64,
        ext_data_scval_xdr_b64: ext_b64,
        output_commitment0: field_hex(prepared.output_commitments[0]),
        output_commitment1: field_hex(prepared.output_commitments[1]),
        input_nullifier0: field_hex(prepared.input_nullifiers[0]),
        input_nullifier1: field_hex(prepared.input_nullifiers[1]),
    })
}
