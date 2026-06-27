/// Off-chain ScVal encoding for pool contract transact calls.
///
/// Mirrors the encoding in SPP's `stellar/src/soroban_encode.rs` and
/// `stellar/src/conversions.rs` — without pulling in the full stellar client
/// crate (which drags in reqwest, rusqlite, etc.).
use anyhow::{Result, anyhow};
use stellar_xdr::curr::{self as xdr, Int256Parts, ScAddress, ScMap, ScMapEntry, ScSymbol, ScVal};
use types::{ExtData, Field};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

fn map_entry(key: &str, val: ScVal) -> Result<ScMapEntry> {
    let sym: xdr::StringM<32> = key.try_into().map_err(|_| anyhow!("invalid map key: {key}"))?;
    Ok(ScMapEntry {
        key: ScVal::Symbol(ScSymbol(sym)),
        val,
    })
}

fn sorted_map(mut entries: Vec<ScMapEntry>) -> Result<ScVal> {
    entries.sort_by(|a, b| {
        let ScVal::Symbol(ka) = &a.key else {
            return std::cmp::Ordering::Equal;
        };
        let ScVal::Symbol(kb) = &b.key else {
            return std::cmp::Ordering::Equal;
        };
        ka.to_string().cmp(&kb.to_string())
    });
    Ok(ScVal::Map(Some(ScMap(entries.try_into()?))))
}

/// Encodes a `Field` (BN254 scalar) as `ScVal::U256` (4×u64 big-endian limbs).
pub fn field_to_scval_u256(v: Field) -> ScVal {
    let be = v.to_be_bytes();
    let hi_hi = u64::from_be_bytes(be[0..8].try_into().expect("slice"));
    let hi_lo = u64::from_be_bytes(be[8..16].try_into().expect("slice"));
    let lo_hi = u64::from_be_bytes(be[16..24].try_into().expect("slice"));
    let lo_lo = u64::from_be_bytes(be[24..32].try_into().expect("slice"));
    ScVal::U256(xdr::UInt256Parts { hi_hi, hi_lo, lo_hi, lo_lo })
}

/// Encodes `i128` as `ScVal::I256` (sign-extended two's complement).
pub fn i128_to_i256_scval(n: i128) -> ScVal {
    let hi = if n < 0 { -1i64 } else { 0i64 };
    let hi_lo = u64::from_be_bytes(hi.to_be_bytes());
    let bytes = n.to_be_bytes();
    let lo_hi = u64::from_be_bytes(bytes[0..8].try_into().expect("slice"));
    let lo_lo = u64::from_be_bytes(bytes[8..16].try_into().expect("slice"));
    ScVal::I256(Int256Parts { hi_hi: hi, hi_lo, lo_hi, lo_lo })
}

/// Encodes a byte slice as `ScVal::Bytes`.
pub fn bytes_to_scval(bytes: impl AsRef<[u8]>) -> Result<ScVal> {
    Ok(ScVal::Bytes(
        bytes
            .as_ref()
            .to_vec()
            .try_into()
            .map_err(|_| anyhow!("bytes too long for ScVal::Bytes"))?,
    ))
}

// ---------------------------------------------------------------------------
// Pool-specific encoding
// ---------------------------------------------------------------------------

/// Encodes a 256-byte uncompressed Groth16 proof as the contract `Groth16Proof` map.
pub fn groth16_proof_to_scval(proof_uncompressed: &[u8]) -> Result<ScVal> {
    if proof_uncompressed.len() != 256 {
        return Err(anyhow!(
            "proof must be 256 bytes, got {}",
            proof_uncompressed.len()
        ));
    }
    sorted_map(vec![
        map_entry("a", bytes_to_scval(&proof_uncompressed[0..64])?)?,
        map_entry("b", bytes_to_scval(&proof_uncompressed[64..192])?)?,
        map_entry("c", bytes_to_scval(&proof_uncompressed[192..256])?)?,
    ])
}

/// Encodes the pool `Proof` struct (public inputs + embedded Groth16 proof).
#[allow(clippy::too_many_arguments)]
pub fn pool_proof_to_scval(
    proof_uncompressed: &[u8],
    root: Field,
    input_nullifiers: &[Field],
    output_commitment0: Field,
    output_commitment1: Field,
    public_amount: Field,
    ext_data_hash_be: [u8; 32],
    asp_membership_root: Field,
    asp_non_membership_root: Field,
) -> Result<ScVal> {
    let nullifiers = xdr::ScVec::try_from(
        input_nullifiers
            .iter()
            .copied()
            .map(field_to_scval_u256)
            .collect::<Vec<_>>(),
    )?;

    sorted_map(vec![
        map_entry("asp_membership_root", field_to_scval_u256(asp_membership_root))?,
        map_entry("asp_non_membership_root", field_to_scval_u256(asp_non_membership_root))?,
        map_entry("ext_data_hash", bytes_to_scval(ext_data_hash_be)?)?,
        map_entry("input_nullifiers", ScVal::Vec(Some(nullifiers)))?,
        map_entry("output_commitment0", field_to_scval_u256(output_commitment0))?,
        map_entry("output_commitment1", field_to_scval_u256(output_commitment1))?,
        map_entry("proof", groth16_proof_to_scval(proof_uncompressed)?)?,
        map_entry("public_amount", field_to_scval_u256(public_amount))?,
        map_entry("root", field_to_scval_u256(root))?,
    ])
}

/// Encodes the pool `ExtData` struct.
pub fn pool_ext_data_to_scval(ext: &ExtData) -> Result<ScVal> {
    sorted_map(vec![
        map_entry("encrypted_output0", bytes_to_scval(&ext.encrypted_output0)?)?,
        map_entry("encrypted_output1", bytes_to_scval(&ext.encrypted_output1)?)?,
        map_entry("ext_amount", i128_to_i256_scval(ext.ext_amount.into()))?,
        map_entry("recipient", ScVal::Address(ext.recipient.parse::<ScAddress>()?))?
    ])
}

// ---------------------------------------------------------------------------
// ext_data_hash: keccak256(XDR(ExtData)) mod BN254
// ---------------------------------------------------------------------------

use sha3::{Digest, Keccak256};
use stellar_xdr::curr::{Limits, WriteXdr};
use types::{BN254_MODULUS_BE, U256};

pub fn hash_ext_data(ext: &ExtData) -> Result<[u8; 32]> {
    let mut entries: Vec<(&str, ScVal)> = vec![
        ("encrypted_output0", ScVal::Bytes(ext.encrypted_output0.clone().try_into()?)),
        ("encrypted_output1", ScVal::Bytes(ext.encrypted_output1.clone().try_into()?)),
        ("ext_amount", i128_to_i256_scval(ext.ext_amount.into())),
        ("recipient", ScVal::Address(ext.recipient.parse::<ScAddress>()?)),
    ];
    entries.sort_by(|a, b| a.0.cmp(b.0));

    let map_entries: Vec<ScMapEntry> = entries
        .into_iter()
        .map(|(k, v)| {
            let sym: xdr::StringM<32> = k.try_into().expect("key fits");
            ScMapEntry {
                key: ScVal::Symbol(ScSymbol(sym)),
                val: v,
            }
        })
        .collect();

    let payload = ScVal::Map(Some(ScMap(map_entries.try_into()?)))
        .to_xdr(Limits::none())?;

    let mut hasher = Keccak256::new();
    hasher.update(&payload);
    let digest = hasher.finalize();

    let mut digest_be = [0u8; 32];
    digest_be.copy_from_slice(digest.as_slice());

    let digest_u256 = U256::from_big_endian(&digest_be);
    let modulus = U256::from_big_endian(&BN254_MODULUS_BE);
    let reduced = digest_u256 % modulus;
    Ok(reduced.to_big_endian())
}
