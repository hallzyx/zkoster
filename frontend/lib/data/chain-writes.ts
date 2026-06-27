// Chain write adapter: server-side transaction building, signing, and polling.
//
// PROVER DETERMINISM NOTE (Phase A7):
// The prover accepts an optional `seed` parameter (default 42 in the prover CLI).
// When `proveBatch` is called at Review time, we store the seed used.
// At Execute time, we re-call `proveBatch` with the same amounts AND the same seed,
// which produces the exact same Pedersen commitment and Groth16 proof.
// This works because the prover's arkworks circuit uses the seed to derive the
// randomness for the Pedersen blinding factor — same seed → same commitment bytes.
// If the prover ever becomes non-deterministic (e.g. random blinding), the proof
// and public_input must be threaded from the review step via args or a short-lived
// server-side store. For this slice, the deterministic re-prove approach is used.

import "server-only";

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

import { getConfig, type ChainConfig } from "@/lib/config";
import { DISCLOSURE_SCOPE, ROLE, type DisclosureScope, type Role } from "@/lib/types";
import { roleKeypair } from "@/lib/wallets";
import { proveBatch, type ProverProof, type ProverVk } from "@/lib/prover";
import { toRealAmount } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Internal config helper
// ---------------------------------------------------------------------------

function chainConfig(): ChainConfig {
  const { chain } = getConfig();
  if (!chain) throw new Error("Chain writes require ZKOSTER_DATA_SOURCE=chain");
  return chain;
}

// ---------------------------------------------------------------------------
// ScVal helpers
// ---------------------------------------------------------------------------

/** u64 ScVal from a JS number. */
const u64 = (n: number): xdr.ScVal =>
  nativeToScVal(BigInt(n), { type: "u64" });

/** Address ScVal from a Stellar public key string. */
const addr = (wallet: string): xdr.ScVal =>
  Address.fromString(wallet).toScVal();

/**
 * BytesN ScVal from a hex string. Strips a leading "0x" defensively.
 * The hex must represent exactly the byte length the contract expects
 * (e.g. 64 hex chars = BytesN<32>, 128 hex chars = BytesN<64>).
 */
const bytesHex = (hex: string): xdr.ScVal => {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return xdr.ScVal.scvBytes(Buffer.from(clean, "hex"));
};

/** Symbol ScVal. */
const sym = (s: string): xdr.ScVal => xdr.ScVal.scvSymbol(s);

/** Convenience: build a ScMapEntry from a string key + ScVal value. */
const entry = (key: string, val: xdr.ScVal): xdr.ScMapEntry =>
  new xdr.ScMapEntry({ key: sym(key), val });

/**
 * Proof struct → scvMap.
 * Fields MUST be in symbol-sorted order: a < b < c.
 * Confirmed from zkoster_types::Proof { a: BytesN<64>, b: BytesN<128>, c: BytesN<64> }.
 */
function proofScVal(p: ProverProof): xdr.ScVal {
  return xdr.ScVal.scvMap([
    entry("a", bytesHex(p.a)), // BytesN<64>
    entry("b", bytesHex(p.b)), // BytesN<128>
    entry("c", bytesHex(p.c)), // BytesN<64>
  ]);
}

/**
 * VerifyingKey → scvMap.
 * Soroban sorts map keys by symbol bytes: alpha < beta < delta < gamma < ic.
 * NOTE: This is NOT the struct declaration order in Rust — soroban enforces
 * lexicographic symbol ordering at the host level, so the map MUST be built
 * in this order or the host will reject it.
 * Confirmed: VerifyingKey { alpha: BytesN<64>, beta: BytesN<128>,
 *   gamma: BytesN<128>, delta: BytesN<128>, ic: Vec<BytesN<64>> }.
 */
function vkScVal(vk: ProverVk): xdr.ScVal {
  return xdr.ScVal.scvMap([
    entry("alpha", bytesHex(vk.alpha)), // BytesN<64>
    entry("beta", bytesHex(vk.beta)), // BytesN<128>
    entry("delta", bytesHex(vk.delta)), // BytesN<128>
    entry("gamma", bytesHex(vk.gamma)), // BytesN<128>
    entry("ic", xdr.ScVal.scvVec(vk.ic.map(bytesHex))), // Vec<BytesN<64>>
  ]);
}

/**
 * MemberRole::Employee → scvU32(0).
 * MemberRole is a #[contracttype] enum with explicit integer discriminants
 * (Employee = 0, Auditor = 1, Admin = 2), so Soroban encodes it as a plain u32
 * (the discriminant), NOT as a Vec[Symbol]. This matches the CLI's `--role 0`.
 */
const memberRoleEmployee: xdr.ScVal = xdr.ScVal.scvU32(0);

/** Vec<BytesN<32>> public_inputs from a single hex-encoded 32-byte input. */
function publicInputsVec(publicInput: string): xdr.ScVal {
  return xdr.ScVal.scvVec([bytesHex(publicInput)]);
}

/** Zero tx_ref: BytesN<32> of all zeros. */
const zeroTxRef: xdr.ScVal = xdr.ScVal.scvBytes(Buffer.alloc(32));

/**
 * Zero enc_r: BytesN<64> of all zeros.
 * Placeholder passed to add_payout until the prover emits ECIES fields.
 * The contract stores it for employee/auditor decryption — zero means
 * no encrypted amount disclosure for this payout (acceptable for hackathon).
 */
const zeroEncR: xdr.ScVal = xdr.ScVal.scvBytes(Buffer.alloc(64));

/**
 * Zero enc_amt: BytesN<40> of all zeros.
 * Placeholder paired with zeroEncR above (same lifecycle and constraints).
 */
const zeroEncAmt: xdr.ScVal = xdr.ScVal.scvBytes(Buffer.alloc(40));

// ---------------------------------------------------------------------------
// Core write primitive
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 30;

/**
 * Build, sign, submit, and confirm a Soroban contract call.
 * - Fetches a fresh account sequence before every call (no race conditions).
 * - Polls getTransaction until SUCCESS, FAILED, or timeout.
 * - Returns the confirmed transaction hash on success.
 * - Throws a descriptive error on FAILED or timeout.
 */
export async function writeContract(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  signerRole: Role = ROLE.ADMIN,
): Promise<string> {
  const cfg = chainConfig();
  const server = new rpc.Server(cfg.rpcUrl);
  const kp: Keypair = roleKeypair(signerRole);

  // 1. Fetch account with current sequence number.
  const account: Account = await server.getAccount(kp.publicKey());

  // 2. Build unsigned transaction.
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  // 3. Simulate + prepare (footprint, resource fees, auth assembly).
  const prepared = await server.prepareTransaction(tx);

  // 4. Sign with role keypair.
  prepared.sign(kp);

  // 5. Submit.
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(
      `sendTransaction ERROR: ${sent.errorResult?.toXDR("base64") ?? "unknown"}`,
    );
  }

  // 6. Poll until confirmed.
  const hash = sent.hash;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await server.getTransaction(hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      const xdrB64 =
        "resultXdr" in result
          ? (result as { resultXdr: { toXDR: (enc: string) => string } }).resultXdr.toXDR("base64")
          : "unavailable";
      throw new Error(`Transaction FAILED (hash: ${hash}): ${xdrB64}`);
    }
    // status === NOT_FOUND — still being ingested; keep polling
  }
  throw new Error(`Transaction timed out after ${MAX_POLLS} polls (hash: ${hash})`);
}

// ---------------------------------------------------------------------------
// Shared row type
// ---------------------------------------------------------------------------

/**
 * A single recipient row: UI-scaled wallet + amount pair.
 * Used as the source of truth threaded through prove → add_payout → execute_payout.
 * The array index is invariant across all three operations (ROW-ORDER INVARIANT).
 */
export interface BatchRow {
  wallet: string;
  uiAmount: number; // UI-display units (divided by displayScale before proving)
}

// Step orchestrators
// ---------------------------------------------------------------------------

/**
 * Create a new payroll batch on-chain.
 * Returns the batch ID parsed from the contract's u64 return value.
 */
export async function createBatch(): Promise<{ batchId: number; txHash: string }> {
  const cfg = chainConfig();
  const server = new rpc.Server(cfg.rpcUrl);
  const kp = roleKeypair(ROLE.ADMIN);

  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(
      new Contract(cfg.payrollId).call(
        "create_batch",
        u64(1), // period_start (placeholder epoch)
        u64(2), // period_end (placeholder epoch)
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`create_batch ERROR: ${sent.errorResult?.toXDR("base64") ?? "unknown"}`);
  }

  const hash = sent.hash;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await server.getTransaction(hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      // Decode the returned u64 batch ID from the simulation result.
      const batchId =
        "returnValue" in result && result.returnValue
          ? Number(scValToNative(result.returnValue) as bigint)
          : 0;
      return { batchId, txHash: hash };
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`create_batch FAILED (hash: ${hash})`);
    }
  }
  throw new Error(`create_batch timed out (hash: ${hash})`);
}

/**
 * Review a payroll batch for N recipients (multi-payout generalisation).
 *
 * Exact sequence (must not be reordered — spec REQ-7):
 *   1. proveBatch(realAmounts, seed=42)  — single call for all N rows
 *   2. verifier.set_vk(vk)              — once per batch
 *   3. for i in 0..N-1:
 *        compliance.register_member(rows[i].wallet, Employee)  — idempotent
 *        payroll.add_payout(batchId, rows[i].wallet, proved.payouts[i].commitment)
 *   4. payroll.review_batch(batchId, proved.total_commitment)
 *
 * ROW-ORDER INVARIANT: proved.payouts[i] corresponds to rows[i].
 * The same index order must be used in executePayoutsFromRows.
 *
 * Returns the hash of the final review_batch transaction.
 */
export async function reviewBatchFromRows(
  batchId: number,
  rows: BatchRow[],
): Promise<string> {
  const cfg = chainConfig();
  const { displayScale } = getConfig();

  if (rows.length === 0) throw new Error("reviewBatchFromRows: no rows");

  const realAmounts = rows.map((r) => toRealAmount(r.uiAmount, displayScale));

  // Step 1: prove all amounts in one call (seed=42 → deterministic commitments/proofs).
  const proved = await proveBatch(realAmounts, /* seed= */ 42);
  if (proved.payouts.length !== rows.length) {
    throw new Error(
      `Prover/row count mismatch: ${proved.payouts.length} proofs for ${rows.length} rows`,
    );
  }

  // Step 2: upload verifying key (once per batch).
  await writeContract(cfg.verifierId, "set_vk", [vkScVal(proved.vk)]);

  // Step 3: register + add_payout in row order (index i is invariant).
  for (let i = 0; i < rows.length; i++) {
    try {
      await writeContract(cfg.complianceId, "register_member", [
        addr(rows[i].wallet),
        memberRoleEmployee,
      ]);
      await writeContract(cfg.payrollId, "add_payout", [
        u64(batchId),
        addr(rows[i].wallet),
        bytesHex(proved.payouts[i].commitment),
        zeroEncR,   // enc_r: prover does not emit ECIES fields yet; zero placeholder
        zeroEncAmt, // enc_amt: same — zero placeholder
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`add_payout row ${i}: ${msg}`);
    }
  }

  // Step 4: finalize review with the total commitment (sum check on-chain).
  return writeContract(cfg.payrollId, "review_batch", [
    u64(batchId),
    bytesHex(proved.total_commitment),
  ]);
}

/**
 * Back-compat shim: single-recipient review delegates to reviewBatchFromRows.
 * Existing callers (reviewBatchAction, createBatchWithPayoutAction) unchanged.
 */
export async function reviewBatch(
  batchId: number,
  employeeWallet: string,
  uiAmount: number,
): Promise<string> {
  return reviewBatchFromRows(batchId, [{ wallet: employeeWallet, uiAmount }]);
}

/** Approve a Reviewed batch. Returns the confirmed tx hash. */
export async function approveBatch(batchId: number): Promise<string> {
  const cfg = chainConfig();
  return writeContract(cfg.payrollId, "approve_batch", [u64(batchId)]);
}

/** Fund an Approved batch. Returns the confirmed tx hash. */
export async function fundBatch(batchId: number): Promise<string> {
  const cfg = chainConfig();
  return writeContract(cfg.payrollId, "fund_batch", [u64(batchId)]);
}

/**
 * Execute all payouts for a Funded batch (N-recipient version).
 *
 * BUG FIX vs old executePayouts: the old function applied proved.payouts[0]
 * to every payout ID. This function correctly maps proved.payouts[i] to
 * payoutIds[i] (same index — ROW-ORDER INVARIANT, spec REQ-9).
 *
 * Strategy: re-prove with identical amounts + seed=42 (same as review time)
 * → byte-identical Pedersen commitments and Groth16 proofs. The commitment
 * stored on-chain at review will match what we submit here.
 *
 * get_batch_payouts returns IDs in insertion (push) order == add_payout call
 * order == rows[] order, so payoutIds[i] ↔ proved.payouts[i] is guaranteed.
 *
 * PayoutAlreadyExecuted is caught per-payout and skipped (idempotent).
 * Returns an array of confirmed tx hashes (one per successfully executed payout).
 */
export async function executePayoutsFromRows(
  batchId: number,
  rows: BatchRow[],
): Promise<string[]> {
  const cfg = chainConfig();
  const server = new rpc.Server(cfg.rpcUrl);
  const { displayScale } = getConfig();

  const realAmounts = rows.map((r) => toRealAmount(r.uiAmount, displayScale));

  // Re-prove with same amounts + seed=42 → same commitments/proofs as review time.
  const proved = await proveBatch(realAmounts, /* seed= */ 42);
  if (proved.payouts.length !== rows.length) {
    throw new Error(
      `Prover/row count mismatch: ${proved.payouts.length} proofs for ${rows.length} rows`,
    );
  }

  // Read payout IDs in insertion order (== add_payout call order == rows[] order).
  const source = new Account(Keypair.random().publicKey(), "0");
  const readTx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(new Contract(cfg.payrollId).call("get_batch_payouts", u64(batchId)))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(readTx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`get_batch_payouts failed: ${sim.error}`);
  }
  if (!sim.result) throw new Error("get_batch_payouts returned no value");
  const payoutIds = scValToNative(sim.result.retval) as bigint[];

  if (payoutIds.length !== proved.payouts.length) {
    throw new Error(
      `payout/proof count mismatch: ${payoutIds.length} ids vs ${proved.payouts.length} proofs`,
    );
  }

  const hashes: string[] = [];
  for (let i = 0; i < payoutIds.length; i++) {
    const p = proved.payouts[i]; // BUG FIX: per-index (i), NOT payout[0]
    try {
      const hash = await writeContract(cfg.payrollId, "execute_payout", [
        u64(batchId),
        u64(Number(payoutIds[i])),
        proofScVal(p.proof),
        publicInputsVec(p.public_input),
        zeroTxRef,
      ]);
      hashes.push(hash);
    } catch (err) {
      // PayoutAlreadyExecuted: idempotent skip — keep processing remaining payouts.
      if (String(err).includes("PayoutAlreadyExecuted")) continue;
      throw err;
    }
  }

  return hashes;
}

/**
 * Back-compat shim: single-recipient execute delegates to executePayoutsFromRows.
 * Existing callers continue to compile and work unchanged.
 */
export async function executePayouts(
  batchId: number,
  employeeWallet: string,
  uiAmount: number,
): Promise<string[]> {
  return executePayoutsFromRows(batchId, [{ wallet: employeeWallet, uiAmount }]);
}

// ---------------------------------------------------------------------------
// Disclosure grant writes
// ---------------------------------------------------------------------------

// Domain scope string → on-chain u32 discriminant (matches Rust enum order).
// DisclosureScope: TotalsOnly=0, Sample=1, FullBatch=2 (shared/src/lib.rs).
// Must use scvU32, NOT scvSymbol — same pattern as MemberRole (memberRoleEmployee).
const SCOPE_TO_ID: Record<DisclosureScope, number> = {
  [DISCLOSURE_SCOPE.TOTALS_ONLY]: 0,
  [DISCLOSURE_SCOPE.SAMPLE]: 1,
  [DISCLOSURE_SCOPE.FULL_BATCH]: 2,
};

const scvScope = (s: DisclosureScope): xdr.ScVal =>
  xdr.ScVal.scvU32(SCOPE_TO_ID[s]);

/**
 * Issue a disclosure grant on the compliance contract.
 *
 * Returns the grant_id decoded from the contract's u64 return value — required
 * by the caller (revokeGrant needs the id, and surfacing it in the UI is good UX).
 *
 * Uses the inline build/prepare/sign/submit/poll loop (same as createBatch) because
 * the generic writeContract discards returnValue and we need the grant_id.
 *
 * IMPORTANT arg order (must match contract signature exactly):
 *   issue_grant(grantee, batch_id, payout_id, scope, expires_at)
 *
 * TotalsOnly/FullBatch REQUIRE payout_id=0; Sample REQUIRES payout_id!=0.
 * The demo form only offers TotalsOnly/FullBatch, so payoutId defaults to 0.
 *
 * Admin-signed: contract enforces require_admin. A wrong admin key → require_auth
 * failure surfaced via humanize's "Secret key for role" branch.
 */
export async function issueGrant(
  batchId: number,
  scope: DisclosureScope,
  opts: { grantee: string; payoutId?: number; expiresAt?: number },
): Promise<{ grantId: number; txHash: string }> {
  const cfg = chainConfig();
  const server = new rpc.Server(cfg.rpcUrl);
  const kp = roleKeypair(ROLE.ADMIN);

  const account = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(
      new Contract(cfg.complianceId).call(
        "issue_grant",
        addr(opts.grantee),
        u64(batchId),
        u64(opts.payoutId ?? 0),
        scvScope(scope),
        u64(opts.expiresAt ?? 0),
      ),
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`issue_grant ERROR: ${sent.errorResult?.toXDR("base64") ?? "unknown"}`);
  }

  const hash = sent.hash;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await server.getTransaction(hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      const grantId =
        "returnValue" in result && result.returnValue
          ? Number(scValToNative(result.returnValue) as bigint)
          : 0;
      return { grantId, txHash: hash };
    }
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`issue_grant FAILED (hash: ${hash})`);
    }
  }
  throw new Error(`issue_grant timed out (hash: ${hash})`);
}

/**
 * Revoke a disclosure grant by id.
 * Admin-signed (contract enforces require_admin).
 * Returns the confirmed tx hash.
 */
export async function revokeGrant(grantId: number): Promise<string> {
  const cfg = chainConfig();
  return writeContract(cfg.complianceId, "revoke_grant", [u64(grantId)]);
}

// ---------------------------------------------------------------------------
// SPP anchor writes
// ---------------------------------------------------------------------------

/**
 * Register the deployed SPP pool address in the payroll contract's Config.
 * Admin-only (contract enforces require_admin).
 *
 * Must be called once after a fresh redeploy before any SPP deposit flow.
 * The address is stored in Config.spp_pool and is advisory — execute_payout
 * does not read it, but the frontend uses it for deposit routing.
 */
export async function setSppPool(poolAddress: string): Promise<void> {
  const cfg = chainConfig();
  await writeContract(cfg.payrollId, "set_spp_pool", [addr(poolAddress)]);
}

/**
 * Record a completed off-chain SPP deposit on-chain as a tamper-evident anchor.
 * Admin-only (contract enforces require_admin).
 *
 * Requirements (enforced by the contract):
 *   - Batch must be in Funded or Processing status.
 *   - spp_deposit_ref must not already be set (idempotency guard;
 *     a second call returns SppDepositAlreadyRecorded).
 *
 * @param batchId - The on-chain batch ID (u64).
 * @param sppRef  - Exactly 64 hex characters representing 32 bytes that
 *                  identify the SPP deposit (e.g. hash of the deposit note
 *                  commitment). A leading "0x" is stripped if present.
 *
 * Emits SppDepositRecorded { batch_id, spp_ref } on success.
 */
export async function recordSppDeposit(
  batchId: number,
  sppRef: string,
): Promise<void> {
  const clean = sppRef.startsWith("0x") ? sppRef.slice(2) : sppRef;
  if (clean.length !== 64) {
    throw new Error(
      `recordSppDeposit: sppRef must be exactly 64 hex chars (32 bytes); got ${clean.length} chars`,
    );
  }
  const cfg = chainConfig();
  await writeContract(cfg.payrollId, "record_spp_deposit", [
    u64(batchId),
    bytesHex(clean),
  ]);
}
