"use server";

import { StrKey } from "@stellar/stellar-sdk";

import { getBatch } from "@/lib/data";
import { BATCH_STATUS, DISCLOSURE_SCOPE, PAYOUT_STATUS, ROLE, type BatchStatus, type DisclosureScope } from "@/lib/types";
import { roleKeypair, roleWallet } from "@/lib/wallets";
import {
  approveBatch as chainApproveBatch,
  createBatch as chainCreateBatch,
  executePayoutsFromRows as chainExecutePayoutsFromRows,
  fundBatch as chainFundBatch,
  issueGrant as chainIssueGrant,
  recordSppDeposit as chainRecordSppDeposit,
  reviewBatch as chainReviewBatch,
  reviewBatchFromRows as chainReviewBatchFromRows,
  revokeGrant as chainRevokeGrant,
  type BatchRow,
} from "@/lib/data/chain-writes";
import { depositToPool } from "@/lib/spp/pool-client";
import {
  DEMO_AUDITOR_WALLET,
  registerDynamicBatch,
  seedBatchById,
  setSppNoteForBatch,
  DEMO_EMPLOYEE_WALLET,
} from "@/lib/data/metadata";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ActionResult =
  | { ok: true; txHash: string; status?: BatchStatus }
  | { ok: false; error: string; step?: string };

export type CreateBatchResult = ActionResult & { batchId?: number };

// ---------------------------------------------------------------------------
// Error humanizer
// ---------------------------------------------------------------------------

/**
 * Map known Soroban contract error names to readable messages.
 * Falls back to the raw error message so callers always get something useful.
 */
function humanize(err: unknown, step?: string): { error: string; step?: string } {
  const msg = err instanceof Error ? err.message : String(err);

  const known: Record<string, string> = {
    CommitmentSumMismatch:
      "Commitment sum mismatch — payout commitments do not add up to the batch total. Check amounts and re-review.",
    EmployeeNotAuthorized:
      "Employee not authorized — the recipient is not registered in the compliance contract.",
    PayoutAlreadyExecuted:
      "Payout already executed — this payout was settled in a previous transaction.",
    InvalidBatchStatus:
      "Invalid batch status — the batch is no longer in the expected state. Refresh and try again.",
    ProofInvalid:
      "Invalid ZK proof — the range proof was rejected by the verifier. Re-prove and retry.",
    VkNotSet:
      "Verifying key not set — run the Review step first to upload the VK to the verifier contract.",
    InvalidGrantTarget:
      "Invalid grant target — scope/payout mismatch. Totals Only and Full Batch grants must target the whole batch (payout_id=0).",
    InvalidExpiry:
      "Invalid expiry — the expiry time is already in the past.",
    GrantNotFound:
      "Grant not found — it may have been removed. Refresh and try again.",
    SppDepositAlreadyRecorded:
      "SPP deposit already recorded — this batch already has a privacy pool deposit reference.",
    SppPoolNotSet:
      "SPP pool address not set — call set_spp_pool first to register the pool contract.",
  };

  for (const [keyword, friendly] of Object.entries(known)) {
    if (msg.includes(keyword)) {
      return { error: friendly, step };
    }
  }

  // Prover unreachable (from proveBatch)
  if (msg.includes("ZKOSTER_PROVER_URL") || msg.includes("Prover responded")) {
    return {
      error:
        "Prover unreachable — set ZKOSTER_PROVER_URL and ensure the prover service is running.",
      step,
    };
  }

  // Signing / secret key missing
  if (msg.includes("Secret key for role")) {
    return {
      error: `Auth failure — ${msg}`,
      step,
    };
  }

  return { error: msg, step };
}

// ---------------------------------------------------------------------------
// Shared precondition helpers
// ---------------------------------------------------------------------------

function requireEmployeeWallet(): string {
  const wallet = roleWallet.employee;
  if (!wallet) {
    throw new Error(
      "Employee wallet not configured — set ZKOSTER_EMPLOYEE_SECRET_KEY.",
    );
  }
  return wallet;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Review a Draft batch.
 *
 * Runs in order (spec R4):
 *   proveBatch → set_vk → register_member → add_payout → review_batch
 *
 * The UI amount is resolved from off-chain seed metadata (amounts[0]).
 * For a production system this would come from the company's own records.
 */
export async function reviewBatchAction(batchId: number): Promise<ActionResult> {
  try {
    // Pre-check: batch must still be Draft (R2 / S10).
    const batch = await getBatch(batchId);
    if (!batch) return { ok: false, error: `Batch ${batchId} not found.` };
    if (batch.status !== BATCH_STATUS.DRAFT) {
      return {
        ok: false,
        error: `Batch is no longer Draft (current: ${batch.status}). Refresh and try again.`,
        step: "precondition",
      };
    }

    const employeeWallet = requireEmployeeWallet();

    // Resolve cleartext amount from off-chain seed metadata.
    // amounts[0] corresponds to DEMO_EMPLOYEE_WALLET in the seed roster.
    const meta = seedBatchById(batchId);
    const uiAmount = meta?.amounts[0] ?? 0;
    if (uiAmount === 0) {
      return {
        ok: false,
        error: "No cleartext amount found for this batch. Seed metadata may be missing.",
        step: "amount-resolve",
      };
    }

    const txHash = await chainReviewBatch(batchId, employeeWallet, uiAmount);
    return { ok: true, txHash, status: BATCH_STATUS.REVIEWED };
  } catch (err) {
    return { ok: false, ...humanize(err, "review") };
  }
}

/**
 * Approve a Reviewed batch (checks rule 5 on-chain).
 */
export async function approveBatchAction(batchId: number): Promise<ActionResult> {
  try {
    const batch = await getBatch(batchId);
    if (!batch) return { ok: false, error: `Batch ${batchId} not found.` };
    if (batch.status !== BATCH_STATUS.REVIEWED) {
      return {
        ok: false,
        error: `Batch is no longer Reviewed (current: ${batch.status}). Refresh and try again.`,
        step: "precondition",
      };
    }

    const txHash = await chainApproveBatch(batchId);
    return { ok: true, txHash, status: BATCH_STATUS.APPROVED };
  } catch (err) {
    return { ok: false, ...humanize(err, "approve") };
  }
}

/**
 * Fund an Approved batch.
 */
export async function fundBatchAction(batchId: number): Promise<ActionResult> {
  try {
    const batch = await getBatch(batchId);
    if (!batch) return { ok: false, error: `Batch ${batchId} not found.` };
    if (batch.status !== BATCH_STATUS.APPROVED) {
      return {
        ok: false,
        error: `Batch is no longer Approved (current: ${batch.status}). Refresh and try again.`,
        step: "precondition",
      };
    }

    const txHash = await chainFundBatch(batchId);
    return { ok: true, txHash, status: BATCH_STATUS.FUNDED };
  } catch (err) {
    return { ok: false, ...humanize(err, "fund") };
  }
}

// Result type for the SPP deposit action (extends ActionResult with sppRef).
export type SppDepositActionResult =
  | { ok: true; txHash: string; sppRef: string }
  | { ok: false; error: string; step?: string };

/**
 * Deposit the batch total into the SPP privacy pool and anchor the reference on-chain.
 *
 * Server-side orchestration:
 *   1. depositToPool — admin signs a real Groth16 proof via spp-prover (port 8788).
 *   2. Use output_commitment0 as the 32-byte on-chain reference (sppRef).
 *   3. Store the note in-process for employee claim (batchId → noteJson).
 *   4. Call record_spp_deposit on-chain to anchor the reference (tamper-evident).
 */
export async function depositToPrivacyPoolAction(
  batchId: number,
  totalAmount: number,
): Promise<SppDepositActionResult> {
  try {
    const batch = await getBatch(batchId);
    if (!batch) return { ok: false, error: `Batch ${batchId} not found.` };
    const depositAllowed = [BATCH_STATUS.FUNDED, BATCH_STATUS.PROCESSING, BATCH_STATUS.PAID];
    if (!depositAllowed.includes(batch.status as (typeof depositAllowed)[number])) {
      return {
        ok: false,
        error: `Batch is not Funded (current: ${batch.status}). Refresh and try again.`,
        step: "precondition",
      };
    }
    if (batch.sppDepositRef !== null) {
      return {
        ok: false,
        error: "SPP deposit already recorded for this batch.",
        step: "precondition",
      };
    }

    const kp = roleKeypair(ROLE.ADMIN);
    // totalAmount is in display units where 1000 = 1 USDC.
    // USDC has 7 decimals on Stellar (1 USDC = 10_000_000 stroops).
    // Conversion: stroops = (totalAmount / 1000) * 10_000_000 = totalAmount * 10_000
    const amount = BigInt(totalAmount) * 10_000n;

    const result = await depositToPool(amount, kp.publicKey(), kp);
    const txHash = result.txHash;

    // The output commitment is a 32-byte BN254 field element — use it directly
    // as the on-chain tamper-evident deposit reference (BytesN<32>).
    const sppRef = result.note.commitment;

    // Store the note in-process so the employee claim flow can retrieve it.
    setSppNoteForBatch(batchId, JSON.stringify(result.note));

    // Anchor the reference on-chain (idempotency guard in the contract).
    // Non-fatal if the batch has already transitioned past Funded — the pool
    // deposit succeeded and the in-memory note is available for the claim flow.
    try {
      await chainRecordSppDeposit(batchId, sppRef);
    } catch (anchorErr) {
      const msg = anchorErr instanceof Error ? anchorErr.message : String(anchorErr);
      // InvalidBatchStatus (#5) means the batch moved past Funded after payouts;
      // the pool deposit is real so we continue successfully.
      if (!msg.includes("#5") && !msg.includes("InvalidBatchStatus")) throw anchorErr;
    }

    return { ok: true, txHash, sppRef };
  } catch (err) {
    return { ok: false, ...humanize(err, "spp-deposit") };
  }
}

/**
 * Execute all payouts for a Funded/Processing batch.
 *
 * PayoutAlreadyExecuted is treated as a non-fatal skip (S6) — we report
 * partial success if at least one payout was settled.
 */
export async function executePayoutsAction(batchId: number): Promise<ActionResult> {
  try {
    const batch = await getBatch(batchId);
    if (!batch) return { ok: false, error: `Batch ${batchId} not found.` };
    if (
      batch.status !== BATCH_STATUS.FUNDED &&
      batch.status !== BATCH_STATUS.PROCESSING
    ) {
      return {
        ok: false,
        error: `Batch is not Funded or Processing (current: ${batch.status}). Refresh and try again.`,
        step: "precondition",
      };
    }

    // Recover recipient rows from off-chain metadata.
    // Dynamic batches (CSV upload): wallets[] + amounts[] are aligned arrays.
    // Legacy seed batches: fall back to single demo employee wallet.
    const meta = seedBatchById(batchId);
    let rows: BatchRow[];
    if (meta?.wallets?.length) {
      rows = meta.wallets.map((w, i) => ({ wallet: w, uiAmount: meta.amounts[i] ?? 0 }));
    } else {
      const employeeWallet = requireEmployeeWallet();
      const uiAmount = meta?.amounts[0] ?? 0;
      if (uiAmount === 0) {
        return {
          ok: false,
          error: "No cleartext amount found for this batch.",
          step: "amount-resolve",
        };
      }
      rows = [{ wallet: employeeWallet, uiAmount }];
    }

    const hashes = await chainExecutePayoutsFromRows(batchId, rows);
    const lastHash = hashes[hashes.length - 1] ?? "";
    return { ok: true, txHash: lastHash, status: BATCH_STATUS.PAID };
  } catch (err) {
    return { ok: false, ...humanize(err, "execute") };
  }
}

// ---------------------------------------------------------------------------
// CSV multi-payout batch creation
// ---------------------------------------------------------------------------

export interface NewBatchRowInput {
  wallet: string;
  amount: number; // UI-display units (same scale as seed metadata)
  name?: string;
}

export interface CreateBatchInput {
  name: string;
  periodStart: string;
  periodEnd: string;
  rows: NewBatchRowInput[];
}

const MAX_CSV_ROWS = 100;

/**
 * Create a batch from a CSV upload: validate → createBatch → registerDynamic
 * → reviewBatchFromRows (prove + set_vk + add_payout × N + review_batch).
 *
 * Server-side re-validation is authoritative — never trust client-parsed data alone.
 * Returns { ok: true, batchId } on success or { ok: false, error, step } on failure.
 */
export async function createBatchWithRowsAction(
  input: CreateBatchInput,
): Promise<CreateBatchResult> {
  try {
    const { name, periodStart, periodEnd, rows } = input;

    // Authoritative server-side validation.
    if (!rows?.length) {
      return { ok: false, error: "CSV has no rows.", step: "validate" };
    }
    if (rows.length > MAX_CSV_ROWS) {
      return {
        ok: false,
        error: `Too many rows (max ${MAX_CSV_ROWS}).`,
        step: "validate",
      };
    }
    const seen = new Set<string>();
    for (const r of rows) {
      if (!StrKey.isValidEd25519PublicKey(r.wallet)) {
        return {
          ok: false,
          error: `Invalid wallet address: ${r.wallet}`,
          step: "validate",
        };
      }
      if (!Number.isInteger(r.amount) || r.amount <= 0) {
        return {
          ok: false,
          error: `Invalid amount for ${r.wallet}: must be a positive integer.`,
          step: "validate",
        };
      }
      if (seen.has(r.wallet)) {
        return {
          ok: false,
          error: `Duplicate wallet in payload: ${r.wallet}`,
          step: "validate",
        };
      }
      seen.add(r.wallet);
    }

    // Step 1: create batch on-chain → batchId
    const { batchId } = await chainCreateBatch();

    // Step 2: register off-chain metadata BEFORE any payout TXs
    // (read side needs this to decorate the batch and payouts immediately).
    registerDynamicBatch(batchId, {
      name,
      periodStart,
      periodEnd,
      status: BATCH_STATUS.DRAFT,
      settlementRef: null,
      amounts: rows.map((r) => r.amount),
      wallets: rows.map((r) => r.wallet),
      names: rows.map((r) => r.name ?? ""),
      statuses: rows.map(() => PAYOUT_STATUS.PENDING),
    });

    // Step 3: prove + register_member × N + add_payout × N + review_batch
    const txHash = await chainReviewBatchFromRows(
      batchId,
      rows.map((r) => ({ wallet: r.wallet, uiAmount: r.amount })),
    );

    return { ok: true, txHash, batchId, status: BATCH_STATUS.REVIEWED };
  } catch (err) {
    return { ok: false, ...humanize(err, "create-batch") };
  }
}

// ---------------------------------------------------------------------------
// Disclosure grant actions
// ---------------------------------------------------------------------------

export type IssueGrantResult = ActionResult & { grantId?: number };

/**
 * Issue a disclosure grant to the demo auditor wallet for a batch.
 *
 * Demo policy:
 *   - grantee: DEMO_AUDITOR_WALLET (hardcoded — single auditor in the demo)
 *   - payoutId: 0 (whole-batch grant; required by on-chain rule for non-Sample scope)
 *   - expiresAt: 0 (no expiry)
 *   - scope: TotalsOnly | FullBatch only (Sample excluded — requires payoutId!=0)
 *
 * Returns grantId on success so the UI can surface it immediately.
 */
export async function issueGrantAction(
  batchId: number,
  scope: DisclosureScope,
): Promise<IssueGrantResult> {
  try {
    // Guard: Sample scope requires payoutId!=0; this form only issues whole-batch grants.
    if (scope === DISCLOSURE_SCOPE.SAMPLE) {
      return {
        ok: false,
        error: "Sample scope is not supported in this form — it requires a specific payout target.",
        step: "precondition",
      };
    }
    const { grantId, txHash } = await chainIssueGrant(batchId, scope, {
      grantee: DEMO_AUDITOR_WALLET,
    });
    return { ok: true, txHash, grantId };
  } catch (err) {
    return { ok: false, ...humanize(err, "issue-grant") };
  }
}

/**
 * Revoke a disclosure grant by id. Admin-signed.
 */
export async function revokeGrantAction(grantId: number): Promise<ActionResult> {
  try {
    const txHash = await chainRevokeGrant(grantId);
    return { ok: true, txHash };
  } catch (err) {
    return { ok: false, ...humanize(err, "revoke-grant") };
  }
}

/**
 * Create a new batch on-chain and immediately queue its review.
 * This is the one-click new-batch flow: create → review bundle.
 *
 * Used by the new-batch demo flow (optional for batch-detail slice).
 */
export async function createBatchWithPayoutAction(
  uiAmount: number,
): Promise<CreateBatchResult> {
  try {
    requireEmployeeWallet();
    const { batchId, txHash: createHash } = await chainCreateBatch();

    void createHash; // creation hash logged but not surfaced (review hash wins)

    const employeeWallet = DEMO_EMPLOYEE_WALLET;
    const txHash = await chainReviewBatch(batchId, employeeWallet, uiAmount);
    return { ok: true, txHash, batchId, status: BATCH_STATUS.REVIEWED };
  } catch (err) {
    return { ok: false, ...humanize(err, "create-with-payout") };
  }
}
