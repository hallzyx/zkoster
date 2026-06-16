// Chain adapter: live Soroban reads, decorated with off-chain metadata.
//
// The ledger only stores commitments + verifiable state (status, counts, refs),
// so cleartext amounts and human names are merged from `metadata` — the
// company's own off-chain records. This is the faithful hybrid model.
//
// STATUS: provisional. Active only when ZKOSTER_DATA_SOURCE=chain. The exact
// ScVal encodings (enum variant shape, struct field names) must be confirmed
// against a deployed contract (`stellar contract invoke ... -- get_batch`)
// before relying on it. The mock adapter remains the default.

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
import {
  BATCH_STATUS,
  DISCLOSURE_SCOPE,
  PAYOUT_STATUS,
  type Batch,
  type BatchStatus,
  type Company,
  type DisclosureScope,
  type Grant,
  type Member,
  type Payout,
  type PayoutStatus,
} from "@/lib/types";
import {
  cleartextAmount,
  company as companyMeta,
  members as membersMeta,
  memberName,
  seedBatchById,
} from "@/lib/data/metadata";

function chainConfig(): ChainConfig {
  const { chain } = getConfig();
  if (!chain) throw new Error("Chain adapter used without ZKOSTER_DATA_SOURCE=chain");
  return chain;
}

/** Simulate a read-only contract call and return the decoded result. */
async function readContract<T>(
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<T> {
  const cfg = chainConfig();
  const server = new rpc.Server(cfg.rpcUrl);
  const source = new Account(Keypair.random().publicKey(), "0");
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`simulate ${method} failed: ${sim.error}`);
  }
  if (!sim.result) throw new Error(`simulate ${method} returned no value`);
  return scValToNative(sim.result.retval) as T;
}

const u64 = (n: number): xdr.ScVal => nativeToScVal(BigInt(n), { type: "u64" });
const addr = (wallet: string): xdr.ScVal => Address.fromString(wallet).toScVal();

/** Normalize a soroban enum value to its variant name regardless of shape. */
function enumTag(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.length > 0) return String(raw[0]);
  if (raw && typeof raw === "object" && "tag" in raw) {
    return String((raw as { tag: unknown }).tag);
  }
  return String(raw);
}

const BATCH_STATUS_BY_TAG: Record<string, BatchStatus> = {
  Draft: BATCH_STATUS.DRAFT,
  Reviewed: BATCH_STATUS.REVIEWED,
  Approved: BATCH_STATUS.APPROVED,
  Funded: BATCH_STATUS.FUNDED,
  Processing: BATCH_STATUS.PROCESSING,
  Paid: BATCH_STATUS.PAID,
  PartiallyFlagged: BATCH_STATUS.PARTIALLY_FLAGGED,
  Closed: BATCH_STATUS.CLOSED,
};

const PAYOUT_STATUS_BY_TAG: Record<string, PayoutStatus> = {
  Pending: PAYOUT_STATUS.PENDING,
  Ready: PAYOUT_STATUS.READY,
  Submitted: PAYOUT_STATUS.SUBMITTED,
  Paid: PAYOUT_STATUS.PAID,
  Failed: PAYOUT_STATUS.FAILED,
  Flagged: PAYOUT_STATUS.FLAGGED,
  Disclosed: PAYOUT_STATUS.DISCLOSED,
};

const SCOPE_BY_TAG: Record<string, DisclosureScope> = {
  TotalsOnly: DISCLOSURE_SCOPE.TOTALS_ONLY,
  Sample: DISCLOSURE_SCOPE.SAMPLE,
  FullBatch: DISCLOSURE_SCOPE.FULL_BATCH,
};

// Raw on-chain shapes (snake_case field names from the contract structs).
interface RawBatch {
  batch_id: bigint;
  status: unknown;
  employee_count: number;
  created_by: string;
  approved_by: string | null;
  settlement_ref: unknown;
}
interface RawPayout {
  payout_id: bigint;
  batch_id: bigint;
  employee: string;
  status: unknown;
  tx_ref: unknown;
  receipt_ref: unknown;
}
interface RawGrant {
  grant_id: bigint;
  batch_id: bigint;
  payout_id: bigint;
  grantee: string;
  scope: unknown;
  expires_at: bigint;
  revoked: boolean;
}

function decorateBatch(raw: RawBatch): Batch {
  const id = Number(raw.batch_id);
  const meta = seedBatchById(id);
  return {
    id,
    name: meta?.name ?? `Batch #${id}`,
    periodStart: meta?.periodStart ?? "",
    periodEnd: meta?.periodEnd ?? "",
    asset: companyMeta.asset,
    status: BATCH_STATUS_BY_TAG[enumTag(raw.status)] ?? BATCH_STATUS.DRAFT,
    createdBy: raw.created_by,
    approvedBy: raw.approved_by ?? null,
    totalAmount: meta?.amounts.reduce((a, b) => a + b, 0) ?? 0,
    employeeCount: raw.employee_count,
    settlementRef: meta?.settlementRef ?? null,
  };
}

function decoratePayout(raw: RawPayout): Payout {
  const batchId = Number(raw.batch_id);
  return {
    id: Number(raw.payout_id),
    batchId,
    employeeWallet: raw.employee,
    employeeName: memberName(raw.employee),
    amount: cleartextAmount(batchId, raw.employee),
    status: PAYOUT_STATUS_BY_TAG[enumTag(raw.status)] ?? PAYOUT_STATUS.PENDING,
    txRef: null,
    receiptRef: null,
  };
}

export async function getCompany(): Promise<Company> {
  // Name is off-chain; treasury/asset live in the payroll Config on-chain.
  return companyMeta;
}

export async function getMembers(): Promise<Member[]> {
  // No list endpoint on-chain; the roster is off-chain company metadata.
  return membersMeta;
}

export async function getMember(wallet: string): Promise<Member | undefined> {
  return membersMeta.find((m) => m.wallet === wallet);
}

export async function listBatches(): Promise<Batch[]> {
  const cfg = chainConfig();
  const count = Number(await readContract<bigint>(cfg.payrollId, "batch_count"));
  const ids = Array.from({ length: count }, (_, i) => count - i); // newest first
  const batches = await Promise.all(ids.map((id) => getBatch(id)));
  return batches.filter((b): b is Batch => b !== undefined);
}

export async function getBatch(id: number): Promise<Batch | undefined> {
  const cfg = chainConfig();
  const raw = await readContract<RawBatch | null>(cfg.payrollId, "get_batch", [u64(id)]);
  return raw ? decorateBatch(raw) : undefined;
}

export async function getBatchPayouts(batchId: number): Promise<Payout[]> {
  const cfg = chainConfig();
  const ids = await readContract<bigint[]>(cfg.payrollId, "get_batch_payouts", [u64(batchId)]);
  return Promise.all(
    ids.map(async (pid) =>
      decoratePayout(await readContract<RawPayout>(cfg.payrollId, "get_payout", [u64(Number(pid))])),
    ),
  );
}

export async function getEmployeePayouts(wallet: string): Promise<Payout[]> {
  const cfg = chainConfig();
  const ids = await readContract<bigint[]>(cfg.payrollId, "get_employee_payouts", [addr(wallet)]);
  const payouts = await Promise.all(
    ids.map(async (pid) =>
      decoratePayout(await readContract<RawPayout>(cfg.payrollId, "get_payout", [u64(Number(pid))])),
    ),
  );
  return payouts.sort((a, b) => b.batchId - a.batchId);
}

export async function getGranteeGrants(wallet: string): Promise<Grant[]> {
  const cfg = chainConfig();
  const ids = await readContract<bigint[]>(cfg.complianceId, "get_grantee_grants", [addr(wallet)]);
  const grants = await Promise.all(
    ids.map((gid) =>
      readContract<RawGrant>(cfg.complianceId, "get_grant", [u64(Number(gid))]),
    ),
  );
  return grants
    .filter((g) => !g.revoked)
    .map((g) => ({
      id: Number(g.grant_id),
      batchId: Number(g.batch_id),
      payoutId: Number(g.payout_id),
      granteeWallet: g.grantee,
      granteeName: memberName(g.grantee),
      scope: SCOPE_BY_TAG[enumTag(g.scope)] ?? DISCLOSURE_SCOPE.TOTALS_ONLY,
      expiresAt:
        Number(g.expires_at) === 0
          ? null
          : new Date(Number(g.expires_at) * 1000).toISOString(),
      revoked: g.revoked,
    }));
}
