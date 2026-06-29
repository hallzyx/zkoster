use axum::{Json, extract::State};
use prover::{
    crypto::derive_public_key,
    encryption::generate_random_blinding,
    flows::{DepositParams, TransactOutput, deposit},
};
use serde::{Deserialize, Serialize};
use stellar_xdr::curr::{Limits, WriteXdr};
use types::{AspNonMembershipProof, EncryptionPublicKey, ExtAmount, Field, NoteAmount, NotePrivateKey, NotePublicKey};

use crate::{
    soroban_encode::{hash_ext_data, pool_ext_data_to_scval, pool_proof_to_scval},
    state::{ASP_SMT_DEPTH, ASP_TREE_DEPTH, DEMO_PRIV_KEY, SharedState},
};

#[derive(Debug, Deserialize)]
pub struct DepositRequest {
    /// Amount in USDC stroops.
    pub amount_stroops: u64,
    /// Pool Merkle root — 32-byte hex string (big-endian).  From on-chain.
    pub pool_root: String,
    /// ASP membership Merkle root — 32-byte hex string (big-endian).  From on-chain.
    /// Overrides the precomputed `state.membership.proof.root` because the
    /// single-leaf tree built at startup does not match the live root after
    /// the pool has been initialized with real depositor leaves.
    /// See docs/SPP_CLAIM_HANDOFF.md §3-§4.
    pub asp_membership_root: String,
    /// ASP non-membership SMT root — 32-byte hex string (big-endian).  From on-chain.
    pub asp_non_membership_root: String,
    /// Pool contract address (recipient field of ExtData).
    pub pool_address: String,
    /// Stellar address of the employee who will claim this deposit.
    pub recipient_stellar_address: String,
    /// Optional: employee note public key (hex 32B LE).  Uses demo key when absent.
    pub recipient_note_pubkey: Option<String>,
    /// Optional: employee X25519 encryption public key (hex 32B).  Uses demo key when absent.
    pub recipient_enc_pubkey: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DepositResponse {
    /// Base64 XDR of the pool `Proof` ScVal (transact arg 0).
    pub proof_scval_xdr_b64: String,
    /// Base64 XDR of the pool `ExtData` ScVal (transact arg 1).
    pub ext_data_scval_xdr_b64: String,
    /// Hex representation of output_commitment0 (BE).
    pub output_commitment0: String,
    /// Hex representation of output_commitment1 (BE).
    pub output_commitment1: String,
    /// Hex representation of input_nullifier0 (BE).
    pub input_nullifier0: String,
    /// Hex representation of input_nullifier1 (BE).
    pub input_nullifier1: String,
    /// Note data required for the employee to claim this deposit.
    pub note: DepositNoteData,
}

/// Claim data the recipient needs to withdraw the deposited note.
#[derive(Debug, Serialize)]
pub struct DepositNoteData {
    /// Amount in stroops.
    pub amount_stroops: u64,
    /// Note blinding (LE hex 32B) — keep secret.
    pub blinding_le_hex: String,
    /// Commitment hash (BE hex 32B) — use to find the leaf in pool events.
    pub commitment_be_hex: String,
}

pub async fn handler(
    State(state): State<SharedState>,
    Json(req): Json<DepositRequest>,
) -> Result<Json<DepositResponse>, String> {
    generate_deposit_proof(state, req)
        .await
        .map(Json)
        .map_err(|e| format!("deposit proof error: {e:#}"))
}

async fn generate_deposit_proof(
    state: SharedState,
    req: DepositRequest,
) -> anyhow::Result<DepositResponse> {
    // --- parse inputs ----------------------------------------------------------
    tracing::info!(recipient = %req.recipient_stellar_address, "deposit request");
    let pool_root = parse_field_be_hex(&req.pool_root, "pool_root")?;
    let asp_membership_root =
        parse_field_be_hex(&req.asp_membership_root, "asp_membership_root")?;
    let asp_non_membership_root =
        parse_field_be_hex(&req.asp_non_membership_root, "asp_non_membership_root")?;

    let amount = ExtAmount::from(req.amount_stroops as i128);
    let note_amount = NoteAmount::try_from(amount)?;

    // Demo identity is always the depositor (the priv_key whose pubkey must be in ASP).
    let priv_key = DEMO_PRIV_KEY;

    // Output recipient keys.  Fall back to demo identity when not provided.
    let (recipient_note_pubkey, recipient_enc_pubkey) =
        parse_recipient_keys(&priv_key, &req)?;

    // Random blinding for the real output note.
    let out_blinding = generate_random_blinding()?;

    // --- build membership proofs -----------------------------------------------
    // Override the precomputed root with the live on-chain value.  The precomputed
    // tree (single leaf, depth 10) is correct in path/leaf/blinding but its root
    // does not match the pool's authoritative `asp_membership_root` once leaves
    // have been inserted.  See docs/SPP_CLAIM_HANDOFF.md §3.
    let mut membership_proof = state.membership.proof.clone();
    membership_proof.root = asp_membership_root;

    // Non-membership proof against the empty SMT (root is on-chain).
    // The circuit requires key == depositor's note pubkey.
    let pubkey_bytes = derive_public_key(priv_key.as_ref())?;
    let pubkey_arr: [u8; 32] = pubkey_bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("pubkey: expected 32 bytes"))?;
    let depositor_pubkey =
        Field::try_from_le_bytes(pubkey_arr).map_err(|e| anyhow::anyhow!("{e}"))?;

    let non_membership_proof = AspNonMembershipProof {
        key: depositor_pubkey,
        old_key: Field::ZERO,
        old_value: Field::ZERO,
        is_old0: true,
        siblings: vec![Field::ZERO; ASP_SMT_DEPTH as usize],
        root: asp_non_membership_root,
    };

    // --- run proof pipeline (blocking in spawn_blocking) ----------------------
    let state2 = state.clone();
    let params = DepositParams {
        priv_key,
        encryption_pubkey: EncryptionPublicKey(pubkey_arr),
        pool_root,
        pool_address: req.pool_address.clone(),
        amount,
        outputs: vec![TransactOutput {
            amount: note_amount,
            blinding: out_blinding,
            recipient_note_pubkey: Some(recipient_note_pubkey),
            recipient_encryption_pubkey: Some(recipient_enc_pubkey),
        }],
        membership_proof,
        non_membership_proof,
        tree_depth: ASP_TREE_DEPTH,
        smt_depth: ASP_SMT_DEPTH,
    };

    let amount_stroops = req.amount_stroops;
    let result = tokio::task::spawn_blocking(move || {
        run_proof_pipeline(state2, params, amount_stroops, out_blinding)
    })
    .await
    .map_err(|e| anyhow::anyhow!("thread panicked: {e:?}"))??;

    Ok(result)
}

pub(crate) fn parse_field_be_hex(s: &str, name: &str) -> anyhow::Result<Field> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(s).map_err(|e| anyhow::anyhow!("{name}: invalid hex: {e}"))?;
    if bytes.len() != 32 {
        return Err(anyhow::anyhow!("{name}: expected 32 bytes, got {}", bytes.len()));
    }
    let be: [u8; 32] = bytes.try_into().expect("checked len");
    let mut le = be;
    le.reverse();
    Field::try_from_le_bytes(le).map_err(|e| anyhow::anyhow!("{name}: {e}"))
}

pub(crate) fn base64_xdr(val: &stellar_xdr::curr::ScVal) -> anyhow::Result<String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let bytes = val.to_xdr(Limits::none())?;
    Ok(STANDARD.encode(&bytes))
}

fn run_proof_pipeline(
    state: SharedState,
    params: DepositParams,
    amount_stroops: u64,
    out_blinding: Field,
) -> anyhow::Result<DepositResponse> {
    // Build circuit inputs via flows::deposit.
    let artifacts = deposit(params, |ext| hash_ext_data(ext))?;

    let prepared = &artifacts.prepared;
    let circuit_inputs_json = serde_json::to_string(&artifacts.circuit_inputs)?;

    // Generate witness.
    let witness_bytes = {
        let mut calc = state.witness_calc.lock();
        calc.compute_witness(&circuit_inputs_json)?
    };

    // Generate Groth16 proof (256B uncompressed).
    let proof_bytes = state.groth16.prove_bytes_uncompressed(&witness_bytes)?;

    // Encode pool Proof ScVal.
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

    // Encode ExtData ScVal.
    let ext_scval = pool_ext_data_to_scval(&artifacts.ext_data)?;
    let ext_b64 = base64_xdr(&ext_scval)?;

    let field_hex = |f: Field| hex::encode(f.to_be_bytes());
    let commitment0 = prepared.output_commitments[0];

    Ok(DepositResponse {
        proof_scval_xdr_b64: proof_b64,
        ext_data_scval_xdr_b64: ext_b64,
        output_commitment0: field_hex(commitment0),
        output_commitment1: field_hex(prepared.output_commitments[1]),
        input_nullifier0: field_hex(prepared.input_nullifiers[0]),
        input_nullifier1: field_hex(prepared.input_nullifiers[1]),
        note: DepositNoteData {
            amount_stroops,
            blinding_le_hex: hex::encode(out_blinding.to_le_bytes()),
            commitment_be_hex: field_hex(commitment0),
        },
    })
}

fn parse_recipient_keys(
    priv_key: &NotePrivateKey,
    req: &DepositRequest,
) -> anyhow::Result<(NotePublicKey, EncryptionPublicKey)> {
    let note_pubkey = match &req.recipient_note_pubkey {
        Some(hex_str) => {
            let bytes = hex::decode(hex_str.strip_prefix("0x").unwrap_or(hex_str))
                .map_err(|e| anyhow::anyhow!("recipient_note_pubkey hex: {e}"))?;
            let arr: [u8; 32] = bytes
                .try_into()
                .map_err(|_| anyhow::anyhow!("recipient_note_pubkey: expected 32 bytes"))?;
            NotePublicKey(arr)
        }
        None => {
            let pk = derive_public_key(priv_key.as_ref())?;
            let arr: [u8; 32] = pk
                .try_into()
                .map_err(|_| anyhow::anyhow!("derived pubkey: expected 32 bytes"))?;
            NotePublicKey(arr)
        }
    };

    let enc_pubkey = match &req.recipient_enc_pubkey {
        Some(hex_str) => {
            let bytes = hex::decode(hex_str.strip_prefix("0x").unwrap_or(hex_str))
                .map_err(|e| anyhow::anyhow!("recipient_enc_pubkey hex: {e}"))?;
            let arr: [u8; 32] = bytes
                .try_into()
                .map_err(|_| anyhow::anyhow!("recipient_enc_pubkey: expected 32 bytes"))?;
            EncryptionPublicKey(arr)
        }
        None => {
            let pk = derive_public_key(priv_key.as_ref())?;
            let arr: [u8; 32] = pk
                .try_into()
                .map_err(|_| anyhow::anyhow!("derived enc pubkey: expected 32 bytes"))?;
            EncryptionPublicKey(arr)
        }
    };

    Ok((note_pubkey, enc_pubkey))
}
