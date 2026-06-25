"use server";

import { StrKey } from "@stellar/stellar-sdk";

import { getBatch } from "@/lib/data";
import { BATCH_STATUS, PAYOUT_STATUS, type BatchStatus } from "@/lib/types";
import { roleWallet } from "@/lib/wallets";
import {
  approveBatch as chainApproveBatch,
  createBatch as chainCreateBatch,
  executePayoutsFromRows as chainExecutePayoutsFromRows,
  fundBatch as chainFundBatch,
  reviewBatch as chainReviewBatch,
  reviewBatchFromRows as chainReviewBatchFromRows,
  type BatchRow,
} from "@/lib/data/chain-writes";
import {
  registerDynamicBatch,
  seedBatchById,
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
