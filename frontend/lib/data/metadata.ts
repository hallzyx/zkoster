// The company's OFF-CHAIN records: human metadata (names, periods) and the
// cleartext amounts the company already knows. The ledger never sees these —
// only commitments. Both the mock and chain adapters read decoration from here.

import {
  BATCH_STATUS,
  DISCLOSURE_SCOPE,
  MEMBER_STATUS,
  PAYOUT_STATUS,
  ROLE,
  type BatchStatus,
  type Company,
  type Grant,
  type Member,
  type PayoutStatus,
} from "@/lib/types";
import { roleWallet } from "@/lib/wallets";
import { shortWallet } from "@/lib/utils";

// Role identities resolve to the real testnet wallets derived from the secret
// keys; when those aren't configured (pure mock demo) the placeholders are used.
// The same identities key both the mock seed and the chain queries.
const ADMIN_WALLET = roleWallet.admin ?? "GADMINFINANCEOPS0000000000000000000000000000000000000000";
export const DEMO_EMPLOYEE_WALLET =
  roleWallet.employee ?? "GEMP1SOFIAGIMENEZ00000000000000000000000000000000000000";
export const DEMO_AUDITOR_WALLET =
  roleWallet.auditor ?? "GAUDITEXTERNALLLP000000000000000000000000000000000000000";

export const company: Company = {
  name: "Aurora Labs",
  asset: "USDC",
  treasury: "GTREASURYAURORALABS0000000000000000000000000000000000000",
};

export const members: Member[] = [
  { wallet: ADMIN_WALLET, displayName: "Finance Ops", role: ROLE.ADMIN, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: DEMO_EMPLOYEE_WALLET, displayName: "Sofía Giménez", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: "GEMP2MARCUSLEE0000000000000000000000000000000000000000000", displayName: "Marcus Lee", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: "GEMP3AMARAOKAFOR00000000000000000000000000000000000000000", displayName: "Amara Okafor", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: "GEMP4DIEGOTORRES00000000000000000000000000000000000000000", displayName: "Diego Torres", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: "GEMP5YUKITANAKA000000000000000000000000000000000000000000", displayName: "Yuki Tanaka", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: "GEMP6PRIYANAIR0000000000000000000000000000000000000000000", displayName: "Priya Nair", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: DEMO_AUDITOR_WALLET, displayName: "External Audit LLP", role: ROLE.AUDITOR, status: MEMBER_STATUS.AUTHORIZED },
];

export const employees = members.filter((m) => m.role === ROLE.EMPLOYEE);

export interface SeedBatch {
  name: string;
  periodStart: string;
  periodEnd: string;
  status: BatchStatus;
  settlementRef: string | null;
  /** Hex-encoded BytesN<32> from record_spp_deposit. Set when the batch has been deposited into the SPP privacy pool. */
  sppDepositRef?: string | null;
  /**
   * Stellar tx hash of the SPP deposit (record_spp_deposit) — separate from
   * sppDepositRef (the 32-byte note anchor). Persists in off-chain storage so
   * the Stellar Expert link stays visible after the page refresh that wipes
   * the local `result` state in SppDepositStep.
   */
  sppDepositTxRef?: string | null;
  amounts: number[];
  statuses: PayoutStatus[];
  /**
   * Dynamic batches only: parallel array to amounts[], preserves ROW ORDER.
   * wallets[i] ↔ amounts[i] — the same index used in prove/add_payout/execute.
   * Static seed data leaves this undefined; lookups fall back to employees[].
   */
  wallets?: string[];
  /**
   * Dynamic batches only: optional CSV display names, parallel to wallets[].
   * names[i] is the display name for wallets[i]; empty string means no name.
   */
  names?: string[];
}

// ---------------------------------------------------------------------------
// Dynamic batch registry (in-memory, cleared on process restart)
// ---------------------------------------------------------------------------
//
// Created batches via CSV upload are stored here so the read side (chain.ts
// decorateBatch / decoratePayout) can look up the company's off-chain records
// without querying the ledger for cleartext amounts (which are never on-chain).
//
// Lifecycle: registered immediately after createBatch() returns a batchId,
// before any payout TXs. Lost on process restart — acceptable for hackathon demo.
//
// MUST be pinned on globalThis: a plain module-level Map is NOT shared across
// Next.js App Router request boundaries — the server action that creates the
// batch, the page render that reads it, and the execute action each get their
// own module instance, so a module-local Map would always read back empty.
// globalThis is the single per-process global, so all of them share one Map
// (this is the same pattern used for a dev-time Prisma singleton). It also
// survives Turbopack HMR. Still lost on a real process restart, as documented.

const _globalForBatches = globalThis as unknown as {
  __zkosterDynamicBatches?: Map<number, SeedBatch>;
};
const _dynamicBatches: Map<number, SeedBatch> =
  _globalForBatches.__zkosterDynamicBatches ??
  (_globalForBatches.__zkosterDynamicBatches = new Map<number, SeedBatch>());

/** Register a dynamically created batch in the in-memory off-chain store. */
export function registerDynamicBatch(batchId: number, data: SeedBatch): void {
  _dynamicBatches.set(batchId, data);
}

/**
 * Update a dynamically created batch in-place (mutates the existing SeedBatch).
 * Used to persist SPP deposit metadata (tx hash, ref) AFTER the initial
 * registerDynamicBatch call so the Stellar Expert link survives a page refresh.
 *
 * No-op if the batch was registered via the static seed array (i.e. seed
 * batch created before the user-facing CSV flow) — those are immutable seeds.
 */
export function updateDynamicBatch(
  batchId: number,
  patch: Partial<SeedBatch>,
): boolean {
  const existing = _dynamicBatches.get(batchId);
  if (!existing) return false;
  Object.assign(existing, patch);
  return true;
}

// ---------------------------------------------------------------------------
// SPP note storage (in-memory, same globalThis lifetime as _dynamicBatches)
// ---------------------------------------------------------------------------
// After a real SPP deposit, the note JSON is stored here so the employee claim
// flow can retrieve it by batchId without requiring a database column.

const _globalForNotes = globalThis as unknown as {
  __zkosterSppNotes?: Map<number, string>;
};
const _sppNotes: Map<number, string> =
  _globalForNotes.__zkosterSppNotes ??
  (_globalForNotes.__zkosterSppNotes = new Map<number, string>());

export function setSppNoteForBatch(batchId: number, noteJson: string): void {
  _sppNotes.set(batchId, noteJson);
}

export function getSppNoteForBatch(batchId: number): string | null {
  return _sppNotes.get(batchId) ?? null;
}

export const seedBatches: SeedBatch[] = [
  {
    name: "March 2026 Payroll",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    status: BATCH_STATUS.CLOSED,
    settlementRef: "stellar:tx:9f2a…c41",
    // Demo SPP deposit ref: a real deployment would write this via record_spp_deposit().
    sppDepositRef: "a3f8c2e14b7d905e6f2a18c4d3b7e9f02a1c5d8e4b6f0a2e1c3d5b7f9a2c4e6",
    amounts: [7800, 6200, 9100, 5400, 8300, 6700],
    statuses: Array(6).fill(PAYOUT_STATUS.PAID) as PayoutStatus[],
  },
  {
    name: "April 2026 Payroll",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    status: BATCH_STATUS.PROCESSING,
    settlementRef: "stellar:tx:1b7d…e09",
    amounts: [7800, 6200, 9100, 5400, 8300, 7000],
    statuses: [
      PAYOUT_STATUS.PAID,
      PAYOUT_STATUS.PAID,
      PAYOUT_STATUS.PAID,
      PAYOUT_STATUS.FLAGGED,
      PAYOUT_STATUS.PENDING,
      PAYOUT_STATUS.PENDING,
    ],
  },
  {
    name: "May 2026 Payroll",
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    status: BATCH_STATUS.DRAFT,
    settlementRef: null,
    amounts: [8000, 6200, 9100, 5400, 8300, 7000],
    statuses: Array(6).fill(PAYOUT_STATUS.PENDING) as PayoutStatus[],
  },
];

export const seedGrants: Grant[] = [
  { id: 1, batchId: 1, payoutId: 0, granteeWallet: DEMO_AUDITOR_WALLET, granteeName: "External Audit LLP", scope: DISCLOSURE_SCOPE.FULL_BATCH, expiresAt: "2026-12-31", revoked: false },
  { id: 2, batchId: 2, payoutId: 0, granteeWallet: DEMO_AUDITOR_WALLET, granteeName: "External Audit LLP", scope: DISCLOSURE_SCOPE.TOTALS_ONLY, expiresAt: "2026-12-31", revoked: false },
];

/** Off-chain decoration lookups (used by the chain adapter). */

/**
 * Look up a batch's off-chain metadata.
 * Checks the dynamic batch Map first (CSV-created batches), then falls back
 * to the static seed array (demo seed batches).
 */
export function seedBatchById(batchId: number): SeedBatch | undefined {
  return _dynamicBatches.get(batchId) ?? seedBatches[batchId - 1];
}

/**
 * Resolve cleartext amount for a wallet in a given batch.
 * Dynamic batches: look up by wallet in the aligned wallets[] array.
 * Static seed batches: fall back to employees[] index (original behavior).
 */
export function cleartextAmount(batchId: number, wallet: string): number {
  const seed = seedBatchById(batchId);
  if (!seed) return 0;
  if (seed.wallets) {
    const i = seed.wallets.indexOf(wallet);
    return i >= 0 ? (seed.amounts[i] ?? 0) : 0;
  }
  // Legacy path: static seed batches keyed by employees[] index.
  const idx = employees.findIndex((e) => e.wallet === wallet);
  return idx >= 0 ? (seed.amounts[idx] ?? 0) : 0;
}

/**
 * Resolve display name for a wallet.
 * Priority: static members list → dynamic batch names → shortWallet fallback.
 */
export function memberName(wallet: string): string {
  const m = members.find((x) => x.wallet === wallet);
  if (m) return m.displayName;

  // Search dynamic batches for a CSV name attached to this wallet.
  for (const batch of _dynamicBatches.values()) {
    if (batch.wallets && batch.names) {
      const i = batch.wallets.indexOf(wallet);
      if (i >= 0 && batch.names[i]) return batch.names[i];
    }
  }

  return shortWallet(wallet);
}

/** Mirrors compliance.can_access(grantee, batchId, payoutId). */
export function canAccess(
  granteeGrants: Grant[],
  batchId: number,
  payoutId: number,
): boolean {
  const now = Date.now();
  return granteeGrants.some((g) => {
    const live =
      !g.revoked && (g.expiresAt === null || new Date(g.expiresAt).getTime() > now);
    const covers = g.batchId === batchId && (g.payoutId === 0 || g.payoutId === payoutId);
    return live && covers;
  });
}
