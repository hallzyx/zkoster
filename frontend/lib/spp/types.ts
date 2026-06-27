// SPP SDK — shared TypeScript types.
//
// These types model the note-based UTXO system of Stellar Private Payments.
// In production the commitment and nullifier are BN254 field elements derived
// by the SPP Rust/WASM prover.  In the hackathon demo they are SHA-256 hashes
// of locally-generated random values (see notes.ts).

/** A privacy-pool note (unspent UTXO). */
export type SppNote = {
  /** Pedersen commitment to the note value, hex-encoded 32 bytes. */
  commitment: string;
  /** Nullifier that is revealed (burned) when the note is spent, hex 32 bytes. */
  nullifier: string;
  /** Token amount in the smallest unit (stroops for XLM, 7-decimal for USDC). */
  amount: bigint;
  /** Stellar address of the note owner. */
  owner: string;
};

/** Result returned by a successful deposit into the SPP pool. */
export type SppDepositResult = {
  /** Confirmed Stellar transaction hash. */
  txHash: string;
  /** The note created for the deposited amount. Store this for claim later. */
  note: SppNote;
  /** Contract ID of the pool that received the deposit. */
  poolContract: string;
};

/** Result returned by a successful claim (withdrawal) from the SPP pool. */
export type SppClaimResult = {
  /** Confirmed Stellar transaction hash. */
  txHash: string;
  /** Amount received (mirrors the note amount). */
  amount: bigint;
};
