#!/usr/bin/env node
/**
 * ZKash cross-language interop gate (T-02).
 *
 * Reads a Rust-generated ECIES test vector from the path passed as argv[2]
 * (default: target/zkash_vector.json) and decrypts it using @noble libraries.
 *
 * Exits 0 on success; exits 1 with a descriptive error on any mismatch.
 *
 * Byte layout (must exactly match prover/src/zkash.rs):
 *   enc_r : 64B  x‖y BE, no prefix
 *   enc_amt: 40B  [0..12] nonce | [12..20] ct | [20..36] tag | [36..40] zeros
 *   KDF   : SHA-256(uncompressed shared point, 64B x‖y BE)
 *   AEAD  : ChaCha20Poly1305, plaintext = amount u64 LE (8B)
 *
 * NOTE on @noble/curves bn254: the pairing module's G1 sets fromBytes as
 * notImplemented (it is not needed for pairing). We deserialize enc_r by
 * parsing x,y as bigints and calling ProjectivePoint.fromAffine({x,y}).
 * Serialization uses toAffine() to extract coordinates without calling toBytes.
 */

import { readFileSync } from "node:fs";
import { bn254 } from "@noble/curves/bn254";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";

// BN254 scalar field order r (well-known constant).
const ORDER =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fromHex(hex) {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/** Interpret bytes as a big-endian unsigned integer. */
function bytesToNumberBE(bytes) {
  return bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n);
}

/** Serialize a bigint to a 32-byte big-endian Uint8Array. */
function numberToBytesBE32(n) {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

/** Interpret first 8 bytes as a little-endian u64. */
function u64FromLE(bytes) {
  let n = 0n;
  for (let i = 0; i < 8; i++) {
    n |= BigInt(bytes[i]) << BigInt(8 * i);
  }
  return n;
}

/** Decode a 32-byte BE hex scalar to a bigint mod ORDER. */
function hexToFr(hex) {
  return bytesToNumberBE(fromHex(hex)) % ORDER;
}

/**
 * Parse 64-byte uncompressed G1 point (x‖y BE, no prefix) without using
 * fromHex/fromBytes (which are notImplemented for bn254 pairing module).
 */
function g1FromRaw64(bytes64) {
  const x = bytesToNumberBE(bytes64.slice(0, 32));
  const y = bytesToNumberBE(bytes64.slice(32, 64));
  return bn254.G1.ProjectivePoint.fromAffine({ x, y });
}

/**
 * Serialize a G1 projective point to 64-byte x‖y BE without using toBytes
 * (in case toBytes is also notImplemented). Uses toAffine() instead.
 */
function g1ToRaw64(point) {
  const { x, y } = point.toAffine();
  const out = new Uint8Array(64);
  out.set(numberToBytesBE32(x), 0);
  out.set(numberToBytesBE32(y), 32);
  return out;
}

// ---------------------------------------------------------------------------
// Read vector
// ---------------------------------------------------------------------------

const vectorPath = process.argv[2] || "target/zkash_vector.json";
let vector;
try {
  vector = JSON.parse(readFileSync(vectorPath, "utf8"));
} catch (e) {
  console.error(`Failed to read vector file at ${vectorPath}: ${e.message}`);
  process.exit(1);
}

const { sk_hex, eph_hex, enc_r_hex, enc_amt_hex, expected_amount } = vector;

const encR = fromHex(enc_r_hex);     // 64B x‖y, no prefix
const encAmt = fromHex(enc_amt_hex); // 40B
const nonce = encAmt.slice(0, 12);   // ChaCha20 nonce
const ctTag = encAmt.slice(12, 36);  // ciphertext(8) ‖ tag(16) = 24B

const expectedBigInt = BigInt(expected_amount);

// ---------------------------------------------------------------------------
// Employee decrypt: shared = sk·R
// ---------------------------------------------------------------------------

const skFr = hexToFr(sk_hex);

// Deserialize enc_r as BN254 G1 point from x‖y BE coordinates (no prefix).
const R = g1FromRaw64(encR);

// shared = sk·R  (same as eph·pk because R = eph·G and pk = sk·G)
const sharedEmp = R.multiply(skFr);

// Serialize shared point as 64B x‖y BE for KDF input.
const sharedBytesEmp = g1ToRaw64(sharedEmp);

const keyEmp = sha256(sharedBytesEmp);
let decryptedEmp;
try {
  decryptedEmp = chacha20poly1305(keyEmp, nonce).decrypt(ctTag);
} catch (e) {
  console.error(`Employee decrypt FAILED (AEAD error): ${e.message}`);
  process.exit(1);
}
const amountEmp = u64FromLE(decryptedEmp.slice(0, 8));

if (amountEmp !== expectedBigInt) {
  console.error(
    `Employee path FAILED: decrypted=${amountEmp}, expected=${expectedBigInt}`
  );
  process.exit(1);
}
console.log(`Employee path: OK  (amount=${amountEmp})`);

// ---------------------------------------------------------------------------
// Auditor decrypt: shared = eph·pk  (pk = sk·G, known from on-chain)
// ---------------------------------------------------------------------------

const ephFr = hexToFr(eph_hex);

// pk = sk·G (employee public key — obtained from Member.pub_key on-chain)
const pk = bn254.G1.ProjectivePoint.BASE.multiply(skFr);

// shared = eph·pk  (= eph·sk·G = sk·eph·G = sk·R — same shared secret)
const sharedAud = pk.multiply(ephFr);
const sharedBytesAud = g1ToRaw64(sharedAud);

const keyAud = sha256(sharedBytesAud);
let decryptedAud;
try {
  decryptedAud = chacha20poly1305(keyAud, nonce).decrypt(ctTag);
} catch (e) {
  console.error(`Auditor decrypt FAILED (AEAD error): ${e.message}`);
  process.exit(1);
}
const amountAud = u64FromLE(decryptedAud.slice(0, 8));

if (amountAud !== expectedBigInt) {
  console.error(
    `Auditor path FAILED: decrypted=${amountAud}, expected=${expectedBigInt}`
  );
  process.exit(1);
}
console.log(`Auditor path:  OK  (amount=${amountAud})`);

process.exit(0);
