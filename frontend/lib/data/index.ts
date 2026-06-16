// Data layer entry point. Pages import from "@/lib/data" and never know which
// adapter is active — the config flips between mock and live Soroban reads.
// The chain adapter is loaded lazily so stellar-sdk is never bundled in mock.

import { DATA_SOURCE, getConfig } from "@/lib/config";
import type { Batch, Company, Grant, Member, Payout } from "@/lib/types";

export {
  DEMO_AUDITOR_WALLET,
  DEMO_EMPLOYEE_WALLET,
  canAccess,
} from "@/lib/data/metadata";

type Adapter = typeof import("@/lib/data/mock");

async function adapter(): Promise<Adapter> {
  if (getConfig().dataSource === DATA_SOURCE.CHAIN) {
    return import("@/lib/data/chain");
  }
  return import("@/lib/data/mock");
}

export async function getCompany(): Promise<Company> {
  return (await adapter()).getCompany();
}

export async function getMembers(): Promise<Member[]> {
  return (await adapter()).getMembers();
}

export async function getMember(wallet: string): Promise<Member | undefined> {
  return (await adapter()).getMember(wallet);
}

export async function listBatches(): Promise<Batch[]> {
  return (await adapter()).listBatches();
}

export async function getBatch(id: number): Promise<Batch | undefined> {
  return (await adapter()).getBatch(id);
}

export async function getBatchPayouts(batchId: number): Promise<Payout[]> {
  return (await adapter()).getBatchPayouts(batchId);
}

export async function getEmployeePayouts(wallet: string): Promise<Payout[]> {
  return (await adapter()).getEmployeePayouts(wallet);
}

export async function getGranteeGrants(wallet: string): Promise<Grant[]> {
  return (await adapter()).getGranteeGrants(wallet);
}
