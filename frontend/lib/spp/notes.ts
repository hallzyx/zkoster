// SPP SDK — note (UTXO) generation and serialization.
//
// DEMO: In production this module would call the SPP Rust/WASM prover to derive
// real Pedersen commitments on BN254 using arkworks.  The prover is built with
// Trunk and produces an arkworks-encoded .bin proving key — not snarkjs-compatible.
// For the hackathon demo we generate SHA-256-based demo commitments that show
// the data flow without requiring the full WASM prover build.

import { createHash, randomBytes } from "crypto";

import type { SppNote } from "./types";

/**
 * Generate a demo note for the given amount and owner.
 *
 * DEMO: in production, use SPP Rust/WASM prover.
 * The real commitment would be: Pedersen(amount, blinding_factor) on BN254.
 * The real nullifier would be: poseidon(spending_key, leaf_index).
 * Here both are SHA-256 hashes of random material — sufficient to demonstrate
 * the deposit → record_spp_deposit → claim data flow end-to-end.
 */
export function generateDemoNote(amount: bigint, owner: string): SppNote {
  // Random 32-byte blinding factor per note (prevents commitment linking).
  const blinding = randomBytes(32);

  const commitment = createHash("sha256")
    .update("commitment")
    .update(blinding)
    .update(Buffer.from(amount.toString()))
    .update(Buffer.from(owner))
    .digest("hex");

  const nullifier = createHash("sha256")
    .update("nullifier")
    .update(blinding)
    .update(Buffer.from(owner))
    .digest("hex");

  return { commitment, nullifier, amount, owner };
}

/**
 * Hash a note to produce a stable 32-byte identifier.
 * Used as the `spp_deposit_ref` stored on the zkoster payroll contract:
 * the payroll contract records this value so auditors can cross-reference
 * the on-chain batch with the SPP deposit transaction.
 *
 * DEMO: in production, use SPP Rust/WASM prover.
 * The production version would derive the leaf hash from the real commitment
 * using Poseidon, matching the Merkle tree leaf format inside the SPP circuit.
 */
export function hashNote(note: SppNote): string {
  return createHash("sha256")
    .update("note_hash")
    .update(Buffer.from(note.commitment, "hex"))
    .update(Buffer.from(note.nullifier ?? "", "hex"))
    .update(Buffer.from(note.amount.toString()))
    .update(Buffer.from(note.owner ?? ""))
    .digest("hex");
}

/**
 * Derive a 32-byte `spp_deposit_ref` from a note.
 * This is the value stored as `BytesN<32>` in the zkoster payroll batch.
 */
export function deriveDepositRef(note: SppNote): Buffer {
  return Buffer.from(hashNote(note), "hex");
}
