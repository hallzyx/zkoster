//! Cross-language interop gate (T-02).
//!
//! 1. Rust side generates a fixed ECIES vector (sk=42, eph=7, amount=5000, row=0).
//! 2. Writes it to `prover/target/zkash_vector.json`.
//! 3. Invokes `node scripts/zkash_interop.mjs <path>` and asserts exit 0.
//!
//! This test is the hard gate before any frontend work: if noble and the Rust
//! prover disagree on bytes (endianness, KDF input, AEAD layout), this exits 1
//! with a clear message.

use std::{path::PathBuf, process::Command};
use zkoster_prover::zkash::{ecies_decrypt_auditor, ecies_decrypt_employee, ecies_encrypt, zkash_keypair};
use ark_bn254::Fr;

const MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");

fn manifest_path() -> PathBuf {
    PathBuf::from(MANIFEST_DIR)
}

#[test]
fn interop_rust_encrypts_node_decrypts() {
    // ----- Rust: generate the fixed vector --------------------------------

    let sk = Fr::from(42u64);
    let eph = Fr::from(7u64);
    let amount: u64 = 5000;
    let row_index: u32 = 0;

    let pk = zkash_keypair(sk);
    let ecies = ecies_encrypt(&pk, amount, eph, row_index);

    // Inline assertions: both Rust decrypt paths must pass first.
    assert_eq!(
        ecies_decrypt_employee(sk, &ecies.enc_r, &ecies.enc_amt),
        Ok(amount),
        "Rust employee decrypt must succeed before calling Node"
    );
    assert_eq!(
        ecies_decrypt_auditor(eph, &pk, &ecies.enc_amt),
        Ok(amount),
        "Rust auditor decrypt must succeed before calling Node"
    );

    // Serialize to hex (these functions are re-exported from the crate).
    // We access internal fr_be / g1_bytes via the test-only paths exposed here.
    let sk_hex = hex::encode(fr_be_test(&sk));
    let eph_hex = hex::encode(fr_be_test(&eph));
    let pk_hex = hex::encode(g1_bytes_test(&pk));
    let enc_r_hex = hex::encode(ecies.enc_r);
    let enc_amt_hex = hex::encode(ecies.enc_amt);

    // ----- Write the JSON vector file ------------------------------------

    let target_dir = manifest_path().join("target");
    std::fs::create_dir_all(&target_dir)
        .expect("failed to create target dir");
    let vector_path = target_dir.join("zkash_vector.json");

    let vector_json = format!(
        r#"{{
  "sk_hex": "{sk_hex}",
  "eph_hex": "{eph_hex}",
  "pk_hex": "{pk_hex}",
  "enc_r_hex": "{enc_r_hex}",
  "enc_amt_hex": "{enc_amt_hex}",
  "expected_amount": {amount}
}}"#
    );
    std::fs::write(&vector_path, &vector_json)
        .expect("failed to write zkash_vector.json");

    // ----- Ensure Node dependencies are installed ------------------------

    let scripts_dir = manifest_path().join("..").join("scripts");
    let nm = scripts_dir.join("node_modules");
    if !nm.exists() {
        let install = Command::new("npm")
            .args(["install", "--silent"])
            .current_dir(&scripts_dir)
            .status();
        match install {
            Ok(s) if s.success() => {}
            Ok(s) => eprintln!("npm install exited with {s} — continuing anyway"),
            Err(e) => eprintln!("npm install failed to start: {e} — continuing anyway"),
        }
    }

    // ----- Invoke Node and assert exit 0 ---------------------------------

    let script_path = scripts_dir.join("zkash_interop.mjs");
    let status = Command::new("node")
        .arg(&script_path)
        .arg(&vector_path)
        .status()
        .unwrap_or_else(|e| panic!("failed to launch node: {e}"));

    assert!(
        status.success(),
        "zkash_interop.mjs exited with {status} — Rust↔JS byte layout mismatch"
    );
}

// ---------------------------------------------------------------------------
// Helpers: re-serialize using the same logic as lib.rs (duplicated here to
// avoid depending on unexported functions in a separate test binary).
// ---------------------------------------------------------------------------

use ark_bn254::{Fq, G1Affine};
use ark_ff::{BigInteger, PrimeField};

fn fq_be_test(f: &Fq) -> [u8; 32] {
    let mut out = [0u8; 32];
    let bytes = f.into_bigint().to_bytes_be();
    out[32 - bytes.len()..].copy_from_slice(&bytes);
    out
}

fn fr_be_test(f: &Fr) -> [u8; 32] {
    let mut out = [0u8; 32];
    let bytes = f.into_bigint().to_bytes_be();
    out[32 - bytes.len()..].copy_from_slice(&bytes);
    out
}

fn g1_bytes_test(p: &G1Affine) -> [u8; 64] {
    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&fq_be_test(&p.x));
    out[32..].copy_from_slice(&fq_be_test(&p.y));
    out
}
