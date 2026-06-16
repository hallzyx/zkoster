// Demo data layer. Functions mirror the on-chain contract reads so swapping to
// real Soroban bindings later is a drop-in (see contracts/README.md screen→call
// map). Cleartext amounts represent the company's own off-chain records.

import {
  BATCH_STATUS,
  DISCLOSURE_SCOPE,
  MEMBER_STATUS,
  PAYOUT_STATUS,
  ROLE,
  type Batch,
  type Company,
  type Grant,
  type Member,
  type Payout,
  type PayoutStatus,
} from "@/lib/types";

export const DEMO_EMPLOYEE_WALLET = "GEMP1SOFIAGIMENEZ00000000000000000000000000000000000000";
export const DEMO_AUDITOR_WALLET = "GAUDITEXTERNALLLP000000000000000000000000000000000000000";

const company: Company = {
  name: "Aurora Labs",
  asset: "USDC",
  treasury: "GTREASURYAURORALABS0000000000000000000000000000000000000",
};

const members: Member[] = [
  { wallet: "GADMINFINANCEOPS0000000000000000000000000000000000000000", displayName: "Finance Ops", role: ROLE.ADMIN, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: DEMO_EMPLOYEE_WALLET, displayName: "Sofía Giménez", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: "GEMP2MARCUSLEE0000000000000000000000000000000000000000000", displayName: "Marcus Lee", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: "GEMP3AMARAOKAFOR00000000000000000000000000000000000000000", displayName: "Amara Okafor", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: "GEMP4DIEGOTORRES00000000000000000000000000000000000000000", displayName: "Diego Torres", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: "GEMP5YUKITANAKA000000000000000000000000000000000000000000", displayName: "Yuki Tanaka", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: "GEMP6PRIYANAIR0000000000000000000000000000000000000000000", displayName: "Priya Nair", role: ROLE.EMPLOYEE, status: MEMBER_STATUS.AUTHORIZED },
  { wallet: DEMO_AUDITOR_WALLET, displayName: "External Audit LLP", role: ROLE.AUDITOR, status: MEMBER_STATUS.AUTHORIZED },
];

const employees = members.filter((m) => m.role === ROLE.EMPLOYEE);

interface SeedBatch {
  name: string;
  periodStart: string;
  periodEnd: string;
  status: Batch["status"];
  settlementRef: string | null;
  amounts: number[];
  statuses: PayoutStatus[];
}

const seedBatches: SeedBatch[] = [
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

const batches: Batch[] = [];
const payouts: Payout[] = [];

(() => {
  let payoutId = 0;
  seedBatches.forEach((seed, index) => {
    const batchId = index + 1;
    seed.amounts.forEach((amount, i) => {
      payoutId += 1;
      const employee = employees[i];
      const status = seed.statuses[i];
      payouts.push({
        id: payoutId,
        batchId,
        employeeWallet: employee.wallet,
        employeeName: employee.displayName,
        amount,
        status,
        txRef: status === PAYOUT_STATUS.PAID ? `stellar:tx:${batchId}${i}a…f` : null,
        receiptRef: status === PAYOUT_STATUS.PAID ? `rcpt-${batchId}-${i}` : null,
      });
    });
    batches.push({
      id: batchId,
      name: seed.name,
      periodStart: seed.periodStart,
      periodEnd: seed.periodEnd,
      asset: company.asset,
      status: seed.status,
      createdBy: members[0].wallet,
      approvedBy: seed.status === BATCH_STATUS.DRAFT ? null : members[0].wallet,
      totalAmount: seed.amounts.reduce((a, b) => a + b, 0),
      employeeCount: seed.amounts.length,
      settlementRef: seed.settlementRef,
    });
  });
})();

const grants: Grant[] = [
  {
    id: 1,
    batchId: 1,
    payoutId: 0,
    granteeWallet: DEMO_AUDITOR_WALLET,
    granteeName: "External Audit LLP",
    scope: DISCLOSURE_SCOPE.FULL_BATCH,
    expiresAt: "2026-12-31",
    revoked: false,
  },
  {
    id: 2,
    batchId: 2,
    payoutId: 0,
    granteeWallet: DEMO_AUDITOR_WALLET,
    granteeName: "External Audit LLP",
    scope: DISCLOSURE_SCOPE.TOTALS_ONLY,
    expiresAt: "2026-12-31",
    revoked: false,
  },
];

// --- read API (mirrors the contract surface) ----------------------------

export async function getCompany(): Promise<Company> {
  return company;
}

export async function getMembers(): Promise<Member[]> {
  return members;
}

/** Admin Dashboard — mirrors batch_count + get_batch loop. Newest first. */
export async function listBatches(): Promise<Batch[]> {
  return [...batches].sort((a, b) => b.id - a.id);
}

export async function getBatch(id: number): Promise<Batch | undefined> {
  return batches.find((b) => b.id === id);
}

export async function getBatchPayouts(batchId: number): Promise<Payout[]> {
  return payouts.filter((p) => p.batchId === batchId);
}

/** Employee Portal — mirrors get_employee_payouts. */
export async function getEmployeePayouts(wallet: string): Promise<Payout[]> {
  return payouts
    .filter((p) => p.employeeWallet === wallet)
    .sort((a, b) => b.batchId - a.batchId);
}

export async function getMember(wallet: string): Promise<Member | undefined> {
  return members.find((m) => m.wallet === wallet);
}

/** Auditor View — mirrors get_grantee_grants. */
export async function getGranteeGrants(wallet: string): Promise<Grant[]> {
  return grants.filter((g) => g.granteeWallet === wallet && !g.revoked);
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
