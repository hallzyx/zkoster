// Mock adapter: builds a full demo dataset from the off-chain seed. Default
// data source — keeps the demo fully functional without a deployment.

import { PAYOUT_STATUS, BATCH_STATUS, type Batch, type Grant, type Member, type Payout, type Company } from "@/lib/types";
import {
  company,
  employees,
  members,
  seedBatches,
  seedGrants,
} from "@/lib/data/metadata";

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

const grants: Grant[] = [...seedGrants];

export async function getCompany(): Promise<Company> {
  return company;
}

export async function getMembers(): Promise<Member[]> {
  return members;
}

export async function getMember(wallet: string): Promise<Member | undefined> {
  return members.find((m) => m.wallet === wallet);
}

export async function listBatches(): Promise<Batch[]> {
  return [...batches].sort((a, b) => b.id - a.id);
}

export async function getBatch(id: number): Promise<Batch | undefined> {
  return batches.find((b) => b.id === id);
}

export async function getBatchPayouts(batchId: number): Promise<Payout[]> {
  return payouts.filter((p) => p.batchId === batchId);
}

export async function getEmployeePayouts(wallet: string): Promise<Payout[]> {
  return payouts
    .filter((p) => p.employeeWallet === wallet)
    .sort((a, b) => b.batchId - a.batchId);
}

export async function getGranteeGrants(wallet: string): Promise<Grant[]> {
  return grants.filter((g) => g.granteeWallet === wallet && !g.revoked);
}
