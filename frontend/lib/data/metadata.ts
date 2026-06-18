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
  amounts: number[];
  statuses: PayoutStatus[];
}

export const seedBatches: SeedBatch[] = [
  {
    name: "March 2026 Payroll",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    status: BATCH_STATUS.CLOSED,
    settlementRef: "stellar:tx:9f2a…c41",
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
export function seedBatchById(batchId: number): SeedBatch | undefined {
  return seedBatches[batchId - 1];
}

export function cleartextAmount(batchId: number, wallet: string): number {
  const seed = seedBatchById(batchId);
  if (!seed) return 0;
  const idx = employees.findIndex((e) => e.wallet === wallet);
  return idx >= 0 ? (seed.amounts[idx] ?? 0) : 0;
}

export function memberName(wallet: string): string {
  return members.find((m) => m.wallet === wallet)?.displayName ?? wallet;
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
