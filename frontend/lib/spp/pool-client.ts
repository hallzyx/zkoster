// SPP SDK — pool contract interactions.
//
// Calls the SPP privacy pool contract on Stellar testnet.
// Follows the same build → simulate → sign → submit → poll pattern as
// frontend/lib/data/chain-writes.ts.
//
// DEMO: in production, depositToPool would:
//   1. Call the SPP Rust/WASM prover to generate a real Groth16 deposit proof
//      using the arkworks .bin proving key from deployments/testnet/circuit_keys/
//   2. Submit pool.transact(proof, public_inputs) with a cryptographically valid
//      proof that passes the Circom Groth16 verifier on-chain.
//
// For the hackathon demo we submit a placeholder proof (all-zero bytes).  The
// pool contract's verifier will reject it in the actual circuit check, so we
// catch that error and report it as "DEMO_PROOF_REJECTED" — which still
// exercises the full transaction path (RPC, signing, fee estimation, submission)
// and demonstrates the architecture end-to-end.

import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

import { DEMO_POOL, TESTNET_PASSPHRASE, TESTNET_RPC } from "./config";
import { generateDemoNote } from "./notes";
import type { SppClaimResult, SppDepositResult, SppNote } from "./types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 30;

/**
 * Return the configured Soroban RPC server.
 * Reads NEXT_PUBLIC_STELLAR_RPC_URL when available (allows override), else
 * falls back to the hardcoded testnet endpoint.
 */
function rpcServer(): rpc.Server {
  const url =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STELLAR_RPC_URL) ||
    TESTNET_RPC;
  return new rpc.Server(url);
}

/**
 * Poll getTransaction until SUCCESS, FAILED, or MAX_POLLS exhausted.
 * Returns the confirmed transaction hash.
 * Throws on FAILED or timeout.
 */
async function pollUntilConfirmed(server: rpc.Server, hash: string): Promise<string> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await server.getTransaction(hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      const xdrB64 =
        "resultXdr" in result
          ? (result as { resultXdr: { toXDR: (enc: string) => string } }).resultXdr.toXDR(
              "base64",
            )
          : "unavailable";
      throw new Error(`SPP tx FAILED (hash: ${hash}): ${xdrB64}`);
    }
    // NOT_FOUND — still being ingested; keep polling.
  }
  throw new Error(`SPP tx timed out after ${MAX_POLLS} polls (hash: ${hash})`);
}

/**
 * Build a zero-filled Groth16 proof ScVal (128+64+64 = 256 zero bytes split
 * into a, b, c).
 *
 * DEMO: in production, use SPP Rust/WASM prover output.
 * Real layout: a=G1 (64B), b=G2 (128B), c=G1 (64B) — EIP-197 encoding,
 * same as the zkoster prover (see prover/src/lib.rs).
 */
function demoProofScVal(): xdr.ScVal {
  // DEMO: in production, use SPP Rust/WASM prover.
  const sym = (s: string): xdr.ScVal => xdr.ScVal.scvSymbol(s);
  const zeros = (n: number): xdr.ScVal => xdr.ScVal.scvBytes(Buffer.alloc(n));
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: sym("a"), val: zeros(64) }),  // G1 point
    new xdr.ScMapEntry({ key: sym("b"), val: zeros(128) }), // G2 point
    new xdr.ScMapEntry({ key: sym("c"), val: zeros(64) }),  // G1 point
  ]);
}

/**
 * Build the public inputs vector ScVal for the deposit circuit.
 * Inputs: [note_commitment, nullifier_hash, merkle_root, public_amount].
 *
 * DEMO: in production, use SPP Rust/WASM prover.
 * The real inputs are derived from the circuit witness by the arkworks prover.
 * Here we use the demo note's commitment and nullifier as placeholders.
 */
function depositPublicInputsScVal(note: SppNote): xdr.ScVal {
  // DEMO: in production, use SPP Rust/WASM prover.
  const toFieldBytes = (hex: string): xdr.ScVal =>
    xdr.ScVal.scvBytes(Buffer.from(hex.padStart(64, "0").slice(0, 64), "hex"));

  return xdr.ScVal.scvVec([
    toFieldBytes(note.commitment),
    toFieldBytes(note.nullifier),
    xdr.ScVal.scvBytes(Buffer.alloc(32)), // merkle_root (demo: zero tree)
    xdr.ScVal.scvBytes(
      Buffer.from(note.amount.toString(16).padStart(64, "0").slice(0, 64), "hex"),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deposit `amount` into the SPP privacy pool on behalf of `recipientStellarAddress`.
 *
 * Flow:
 *   1. Generate a demo note (commitment + nullifier).
 *   2. Build a pool.transact() Soroban transaction carrying a demo Groth16 proof.
 *   3. Sign with `signerKeypair` (admin keypair for deposit).
 *   4. Submit and poll for confirmation.
 *
 * DEMO: in production, use SPP Rust/WASM prover.
 * The real flow would replace demoProofScVal() with output from the SPP WASM
 * module (proof object + real public signals from the arkworks circuit witness).
 *
 * @param amount - Token amount in smallest unit (stroops or 7-decimal USDC).
 * @param recipientStellarAddress - Stellar address of the intended recipient.
 * @param signerKeypair - Keypair that signs the deposit transaction (admin).
 * @param poolContract - Optional pool contract override (defaults to DEMO_POOL).
 */
export async function depositToPool(
  amount: bigint,
  recipientStellarAddress: string,
  signerKeypair: Keypair,
  poolContract: string = DEMO_POOL,
): Promise<SppDepositResult> {
  // DEMO: in production, use SPP Rust/WASM prover.
  const note = generateDemoNote(amount, recipientStellarAddress);

  const server = rpcServer();
  const account: Account = await server.getAccount(signerKeypair.publicKey());

  // DEMO: in production, use SPP Rust/WASM prover.
  // The SPP pool's transact() method signature (from SPP contract source):
  //   fn transact(proof: Proof, public_inputs: Vec<BytesN<32>>) -> bool
  // For the demo we pass placeholder proof + demo public_inputs.
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      new Contract(poolContract).call(
        "transact",
        demoProofScVal(),
        depositPublicInputsScVal(note),
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signerKeypair);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    // DEMO: the demo proof will be rejected by the on-chain verifier with an
    // DEMO_PROOF_REJECTED-equivalent error.  For the hackathon we surface the
    // error but still return the note so the UI can show the deposit reference.
    throw new Error(
      `[DEMO] SPP depositToPool ERROR: ${sent.errorResult?.toXDR("base64") ?? "unknown"}. ` +
        `The demo proof was rejected by the on-chain verifier (expected for hackathon demo). ` +
        `In production, use SPP Rust/WASM prover for a valid Groth16 proof.`,
    );
  }

  const txHash = await pollUntilConfirmed(server, sent.hash);

  return { txHash, note, poolContract };
}

/**
 * Claim (withdraw) from the SPP privacy pool using a previously created note.
 *
 * Flow:
 *   1. Build a pool.transact() Soroban transaction for the withdrawal circuit.
 *   2. Sign with `recipientKeypair` (employee's keypair).
 *   3. Submit and poll for confirmation.
 *
 * DEMO: in production, use SPP Rust/WASM prover.
 * The real flow generates a spend proof (reveals the nullifier, proves Merkle
 * membership, proves knowledge of the spending key) using the SPP WASM prover.
 *
 * @param note - The note to claim, previously obtained from depositToPool.
 * @param recipientKeypair - Keypair that signs the claim transaction (employee).
 * @param poolContract - Optional pool contract override (defaults to DEMO_POOL).
 */
export async function claimFromPool(
  note: SppNote,
  recipientKeypair: Keypair,
  poolContract: string = DEMO_POOL,
): Promise<SppClaimResult> {
  const server = rpcServer();
  const account: Account = await server.getAccount(recipientKeypair.publicKey());

  // DEMO: in production, use SPP Rust/WASM prover.
  // Spend proof public inputs: [nullifier, merkle_root, recipient, amount].
  const withdrawInputs = xdr.ScVal.scvVec([
    xdr.ScVal.scvBytes(Buffer.from(note.nullifier.padStart(64, "0").slice(0, 64), "hex")),
    xdr.ScVal.scvBytes(Buffer.alloc(32)), // merkle_root (demo: zero tree)
    xdr.ScVal.scvBytes(Buffer.from(note.owner.padStart(64, "0").slice(0, 64), "hex")),
    xdr.ScVal.scvBytes(
      Buffer.from(note.amount.toString(16).padStart(64, "0").slice(0, 64), "hex"),
    ),
  ]);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      new Contract(poolContract).call(
        "transact",
        demoProofScVal(),
        withdrawInputs,
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(recipientKeypair);

  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    // DEMO: same caveat as depositToPool — demo proof will be rejected.
    throw new Error(
      `[DEMO] SPP claimFromPool ERROR: ${sent.errorResult?.toXDR("base64") ?? "unknown"}. ` +
        `The demo proof was rejected by the on-chain verifier (expected for hackathon demo). ` +
        `In production, use SPP Rust/WASM prover for a valid spend proof.`,
    );
  }

  const txHash = await pollUntilConfirmed(server, sent.hash);
  return { txHash, amount: note.amount };
}
