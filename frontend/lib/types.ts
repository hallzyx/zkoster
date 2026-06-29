// Domain types — mirror the on-chain contract model (see ../../contracts).
// Amounts are kept cleartext here because this layer represents the *company's*
// off-chain data (it already knows its own salaries). Only commitments ever go
// on-chain; the UI enforces per-role visibility of the cleartext values.

export const ROLE = {
  ADMIN: "admin",
  EMPLOYEE: "employee",
  AUDITOR: "auditor",
} as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

export const BATCH_STATUS = {
  DRAFT: "draft",
  REVIEWED: "reviewed",
  APPROVED: "approved",
  FUNDED: "funded",
  PROCESSING: "processing",
  PAID: "paid",
  PARTIALLY_FLAGGED: "partially_flagged",
  CLOSED: "closed",
} as const;
export type BatchStatus = (typeof BATCH_STATUS)[keyof typeof BATCH_STATUS];

export const PAYOUT_STATUS = {
  PENDING: "pending",
  READY: "ready",
  SUBMITTED: "submitted",
  PAID: "paid",
  FAILED: "failed",
  FLAGGED: "flagged",
  DISCLOSED: "disclosed",
} as const;
export type PayoutStatus = (typeof PAYOUT_STATUS)[keyof typeof PAYOUT_STATUS];

export const DISCLOSURE_SCOPE = {
  TOTALS_ONLY: "totals_only",
  SAMPLE: "sample",
  FULL_BATCH: "full_batch",
} as const;
export type DisclosureScope =
  (typeof DISCLOSURE_SCOPE)[keyof typeof DISCLOSURE_SCOPE];

export const MEMBER_STATUS = {
  AUTHORIZED: "authorized",
  REVOKED: "revoked",
} as const;
export type MemberStatus = (typeof MEMBER_STATUS)[keyof typeof MEMBER_STATUS];

export interface Company {
  name: string;
  asset: string;
  treasury: string;
}

export interface Member {
  wallet: string;
  displayName: string;
  role: Role;
  status: MemberStatus;
}

export interface Batch {
  id: number;
  name: string;
  periodStart: string;
  periodEnd: string;
  asset: string;
  status: BatchStatus;
  createdBy: string;
  approvedBy: string | null;
  totalAmount: number;
  employeeCount: number;
  settlementRef: string | null;
  /** Hex-encoded 32-byte SPP deposit reference anchored on-chain, or null if no deposit yet. */
  sppDepositRef: string | null;
  /** Stellar tx hash of the SPP deposit, persisted in off-chain storage so the
   * Stellar Expert link survives a page refresh. Null until a deposit is made. */
  sppDepositTxRef: string | null;
}

export interface Payout {
  id: number;
  batchId: number;
  employeeWallet: string;
  employeeName: string;
  amount: number;
  status: PayoutStatus;
  txRef: string | null;
  receiptRef: string | null;
}

export interface Grant {
  id: number;
  batchId: number;
  payoutId: number; // 0 => whole batch
  granteeWallet: string;
  granteeName: string;
  scope: DisclosureScope;
  expiresAt: string | null;
  revoked: boolean;
}
