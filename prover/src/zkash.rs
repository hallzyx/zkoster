//! ZKash — ECIES-on-BN254G1 confidential amount layer.
//!
//! One ephemeral scalar `eph` per batch. Each payout is encrypted toward the
//! employee's BN254 public key using ECIES with:
//!   - KDF  : SHA-256(uncompressed shared point, 64 bytes)
//!   - AEAD : ChaCha20Poly1305 IETF (96-bit nonce)
//!   - Nonce: row_index as u32 LE ‖ [0u8; 8] = 12 bytes
//!
//! The byte layout is identical in Rust (this file) and TypeScript
//! (@noble/curves + @noble/hashes + @noble/ciphers). The T-02 interop gate
//! asserts both sides decrypt the same fixed vector.

use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Key, Nonce,
};
use sha2::{Digest, Sha256};

use ark_bn254::{Fq, Fr, G1Affine};
use ark_ec::{AffineRepr, CurveGroup};
use ark_ff::PrimeField;

use crate::g1_bytes;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
pub enum ZKashError {
    /// AEAD authentication tag mismatch — wrong key, nonce, or tampered data.
    AuthenticationFailed,
    /// Supplied hex string cannot be decoded as a 64-byte BN254-G1 point.
    InvalidPoint,
}

/// Output of `ecies_encrypt`: the ephemeral point and the encrypted amount.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ecies {
    /// Ephemeral G1 point R = eph·G, serialized as x‖y BE (64 bytes).
    pub enc_r: [u8; 64],
    /// Encrypted amount with layout (40 bytes):
    ///   [0..12]  nonce (row_index u32 LE ‖ [0u8;8])
    ///   [12..20] ciphertext (u64 LE amount, 8 bytes)
    ///   [20..36] Poly1305 tag (16 bytes)
    ///   [36..40] reserved zeros
    pub enc_amt: [u8; 40],
}

// ---------------------------------------------------------------------------
// Internal helpers (not pub — shared key derivation and point codec)
// ---------------------------------------------------------------------------

/// Deserialize a 32-byte big-endian field element.
fn fq_from_be(bytes: &[u8; 32]) -> Fq {
    let mut le = *bytes;
    le.reverse(); // SHA256/BE → LE for from_le_bytes_mod_order
    Fq::from_le_bytes_mod_order(&le)
}

/// Parse 64-byte uncompressed BN254-G1 point (x‖y BE, no prefix byte).
fn parse_g1_bytes(raw: &[u8; 64]) -> G1Affine {
    let x = fq_from_be(raw[..32].try_into().unwrap());
    let y = fq_from_be(raw[32..].try_into().unwrap());
    G1Affine::new_unchecked(x, y)
}

/// KDF: SHA-256 of the full 64-byte uncompressed shared point x‖y BE.
fn shared_key(shared: &G1Affine) -> [u8; 32] {
    let bytes = g1_bytes(shared);
    Sha256::digest(bytes).into()
}

/// Interpret a 32-byte BE digest as an Fr scalar (mod r, same as noble
/// `bytesToNumberBE(digest) % ORDER`).
fn digest_to_fr(digest: &[u8; 32]) -> Fr {
    let mut le = *digest;
    le.reverse(); // BE → LE for from_le_bytes_mod_order
    Fr::from_le_bytes_mod_order(&le)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Derive a deterministic ephemeral scalar from a u64 seed (e.g. batch seed).
/// SHA-256(seed as 8-byte LE) → 32-byte digest → Fr.
pub fn ephemeral_from_seed(seed: u64) -> Fr {
    let digest: [u8; 32] = Sha256::digest(seed.to_le_bytes()).into();
    digest_to_fr(&digest)
}

/// Returns the BN254-G1 public key `sk·G`.
pub fn zkash_keypair(sk: Fr) -> G1Affine {
    (G1Affine::generator().into_group() * sk).into_affine()
}

/// Parse a 64-char hex string as a BN254-G1 public key (x‖y BE).
pub fn pk_from_hex(hex64: &str) -> Result<G1Affine, ZKashError> {
    let bytes = hex::decode(hex64).map_err(|_| ZKashError::InvalidPoint)?;
    if bytes.len() != 64 {
        return Err(ZKashError::InvalidPoint);
    }
    let raw: [u8; 64] = bytes.try_into().unwrap();
    Ok(parse_g1_bytes(&raw))
}

/// Derive a demo BN254 secret key from a raw ed25519 public key (32 bytes).
///
/// sk = SHA-256("zkash/bn254/v1" ‖ raw_pub32) interpreted as a big-endian
/// integer reduced mod r. Identical to the TypeScript derivation:
///   `mod(bytesToNumberBE(sha256(concat(utf8("zkash/bn254/v1"), raw32))), ORDER)`
///
/// SECURITY NOTE: This derivation is from a PUBLIC address — not confidential.
/// For the demo only; replace with a real per-employee key in production.
pub fn demo_sk_from_ed25519(raw_pub32: &[u8; 32]) -> Fr {
    let mut h = Sha256::new();
    h.update(b"zkash/bn254/v1");
    h.update(raw_pub32);
    let digest: [u8; 32] = h.finalize().into();
    digest_to_fr(&digest)
}

/// Encrypt `amount` for `pk` using one ephemeral scalar per batch.
///
/// `row_index` is the 0-based index of this payout within the batch; it is
/// used as the nonce so each employee in the same batch gets a unique key
/// despite sharing the same ephemeral R.
pub fn ecies_encrypt(pk: &G1Affine, amount: u64, eph: Fr, row_index: u32) -> Ecies {
    // R = eph·G (ephemeral public key — same for all payouts in the batch).
    let enc_r_point = (G1Affine::generator().into_group() * eph).into_affine();

    // shared_i = eph · pk_i  (differs per employee because pk differs).
    let shared = (pk.into_group() * eph).into_affine();
    let key_bytes = shared_key(&shared);

    // Nonce: row_index as u32 LE ‖ [0u8;8] = 12 bytes.
    let mut nonce_bytes = [0u8; 12];
    nonce_bytes[..4].copy_from_slice(&row_index.to_le_bytes());

    let key = Key::from_slice(&key_bytes);
    let cipher = ChaCha20Poly1305::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Plaintext: amount as u64 LE (8 bytes).
    // Output: ciphertext(8) ‖ tag(16) = 24 bytes.
    let ct_and_tag = cipher
        .encrypt(nonce, amount.to_le_bytes().as_ref())
        .expect("ChaCha20Poly1305 encrypt is infallible for valid key/nonce");

    let enc_r = g1_bytes(&enc_r_point);

    let mut enc_amt = [0u8; 40];
    enc_amt[0..12].copy_from_slice(&nonce_bytes);      // [0..12]  nonce
    enc_amt[12..36].copy_from_slice(&ct_and_tag);      // [12..36] ct(8) ‖ tag(16)
    // enc_amt[36..40] = [0u8;4]  — reserved zeros, already zero-initialized

    Ecies { enc_r, enc_amt }
}

/// Decrypt as the employee: `sk·R` → shared point → key → AEAD decrypt.
///
/// `enc_r` is the 64-byte x‖y BE ephemeral point. `enc_amt` is the 40-byte
/// encrypted amount blob. Returns `Err(AuthenticationFailed)` on any AEAD
/// mismatch (wrong key, tampered bytes, wrong nonce).
pub fn ecies_decrypt_employee(
    sk: Fr,
    enc_r: &[u8; 64],
    enc_amt: &[u8; 40],
) -> Result<u64, ZKashError> {
    let r_point = parse_g1_bytes(enc_r);
    // shared = sk·R = sk·(eph·G) = eph·(sk·G) = eph·pk  ✓
    let shared = (r_point.into_group() * sk).into_affine();
    decrypt_with_shared(&shared, enc_amt)
}

/// Decrypt as the auditor: `eph·pk` → shared point → key → AEAD decrypt.
///
/// The auditor has the viewing key `eph` (= the ephemeral scalar from the
/// DisclosureGrant) and the employee's on-chain public key `pk`.
pub fn ecies_decrypt_auditor(
    eph: Fr,
    pk: &G1Affine,
    enc_amt: &[u8; 40],
) -> Result<u64, ZKashError> {
    // shared = eph·pk = eph·(sk·G)  (same as sk·(eph·G) = sk·R)  ✓
    let shared = (pk.into_group() * eph).into_affine();
    decrypt_with_shared(&shared, enc_amt)
}

// Shared decryption path for both roles.
fn decrypt_with_shared(shared: &G1Affine, enc_amt: &[u8; 40]) -> Result<u64, ZKashError> {
    let key_bytes = shared_key(shared);
    let key = Key::from_slice(&key_bytes);
    let cipher = ChaCha20Poly1305::new(key);
    let nonce = Nonce::from_slice(&enc_amt[0..12]);

    // enc_amt[12..36] = ct(8) ‖ tag(16) — pass directly to decrypt.
    let plaintext = cipher
        .decrypt(nonce, &enc_amt[12..36])
        .map_err(|_| ZKashError::AuthenticationFailed)?;

    let mut amt_bytes = [0u8; 8];
    amt_bytes.copy_from_slice(&plaintext[..8]);
    Ok(u64::from_le_bytes(amt_bytes))
}

// ---------------------------------------------------------------------------
// Tests (T-01: round-trip employee, auditor, tamper, endianness parity vector)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use ark_bn254::Fr;

    fn fixed_sk() -> Fr {
        Fr::from(42u64)
    }
    fn fixed_eph() -> Fr {
        Fr::from(7u64)
    }
    const AMOUNT: u64 = 5000;
    const ROW: u32 = 0;

    #[test]
    fn round_trip_employee() {
        let sk = fixed_sk();
        let pk = zkash_keypair(sk);
        let ecies = ecies_encrypt(&pk, AMOUNT, fixed_eph(), ROW);
        let result = ecies_decrypt_employee(sk, &ecies.enc_r, &ecies.enc_amt);
        assert_eq!(result, Ok(AMOUNT), "employee round-trip must recover amount");
    }

    #[test]
    fn round_trip_auditor() {
        let sk = fixed_sk();
        let pk = zkash_keypair(sk);
        let ecies = ecies_encrypt(&pk, AMOUNT, fixed_eph(), ROW);
        let result = ecies_decrypt_auditor(fixed_eph(), &pk, &ecies.enc_amt);
        assert_eq!(result, Ok(AMOUNT), "auditor round-trip must recover amount");
    }

    #[test]
    fn tamper_fails_aead() {
        let sk = fixed_sk();
        let pk = zkash_keypair(sk);
        let ecies = ecies_encrypt(&pk, AMOUNT, fixed_eph(), ROW);

        // Flip byte 15 — inside the ciphertext‖tag region [12..36].
        let mut tampered = ecies.enc_amt;
        tampered[15] ^= 0xFF;

        assert_eq!(
            ecies_decrypt_employee(sk, &ecies.enc_r, &tampered),
            Err(ZKashError::AuthenticationFailed),
            "employee must reject tampered enc_amt"
        );
        assert_eq!(
            ecies_decrypt_auditor(fixed_eph(), &pk, &tampered),
            Err(ZKashError::AuthenticationFailed),
            "auditor must reject tampered enc_amt"
        );
    }

    /// Emit the fixed test vector (sk=42, eph=7, amount=5000, row=0) as JSON
    /// to stdout for cross-checking against the Node interop gate (T-02).
    #[test]
    fn sha256_endianness_parity() {
        let sk = fixed_sk();
        let pk = zkash_keypair(sk);
        let ecies = ecies_encrypt(&pk, AMOUNT, fixed_eph(), ROW);

        // Self-check both decrypt paths before emitting the vector.
        assert_eq!(
            ecies_decrypt_employee(sk, &ecies.enc_r, &ecies.enc_amt),
            Ok(AMOUNT)
        );
        assert_eq!(
            ecies_decrypt_auditor(fixed_eph(), &pk, &ecies.enc_amt),
            Ok(AMOUNT)
        );

        let sk_hex = hex::encode(crate::fr_be(&sk));
        let eph_hex = hex::encode(crate::fr_be(&fixed_eph()));
        let pk_hex = hex::encode(crate::g1_bytes(&pk));
        let enc_r_hex = hex::encode(ecies.enc_r);
        let enc_amt_hex = hex::encode(ecies.enc_amt);

        println!("--- ZKash fixed test vector (sk=42, eph=7, amount=5000, row=0) ---");
        println!("sk_hex     = {sk_hex}");
        println!("eph_hex    = {eph_hex}");
        println!("pk_hex     = {pk_hex}");
        println!("enc_r_hex  = {enc_r_hex}");
        println!("enc_amt_hex= {enc_amt_hex}");
    }
}
