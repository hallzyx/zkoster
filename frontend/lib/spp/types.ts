// SPP SDK — shared TypeScript types.

/** A privacy-pool note (unspent UTXO). */
export type SppNote = {
  /** Pedersen commitment (BE hex 32B) — unique pool leaf identifier. */
  commitment: string;
  /** Token amount in stroops (7-decimal USDC). */
  amount: bigint;
  /** Blinding factor (LE hex 32B) — required for withdraw proof. From POST /spp/deposit. */
  blinding?: string;
  /** 0-based insertion index in the pool Merkle tree. */
  leafIndex?: number;
  /** All pool commitments (BE hex 32B each) at deposit time, in insertion order. Used to rebuild Merkle path for withdraw. */
  allCommitments?: string[];
  // Demo-only fields kept for backward compat with notes.ts:
  nullifier?: string;
  owner?: string;
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
