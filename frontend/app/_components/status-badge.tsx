import {
  BATCH_STATUS,
  PAYOUT_STATUS,
  type BatchStatus,
  type PayoutStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const base =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset";

const BATCH: Record<BatchStatus, { label: string; cls: string }> = {
  [BATCH_STATUS.DRAFT]: { label: "Draft", cls: "bg-slate-800 text-slate-300 ring-slate-700" },
  [BATCH_STATUS.REVIEWED]: { label: "Reviewed", cls: "bg-sky-500/10 text-sky-300 ring-sky-500/30" },
  [BATCH_STATUS.APPROVED]: { label: "Approved", cls: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/30" },
  [BATCH_STATUS.FUNDED]: { label: "Funded", cls: "bg-violet-500/10 text-violet-300 ring-violet-500/30" },
  [BATCH_STATUS.PROCESSING]: { label: "Processing", cls: "bg-amber-500/10 text-amber-300 ring-amber-500/30" },
  [BATCH_STATUS.PAID]: { label: "Paid", cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" },
  [BATCH_STATUS.PARTIALLY_FLAGGED]: { label: "Partially flagged", cls: "bg-rose-500/10 text-rose-300 ring-rose-500/30" },
  [BATCH_STATUS.CLOSED]: { label: "Closed", cls: "bg-slate-800 text-slate-400 ring-slate-700" },
};

const PAYOUT: Record<PayoutStatus, { label: string; cls: string }> = {
  [PAYOUT_STATUS.PENDING]: { label: "Pending", cls: "bg-slate-800 text-slate-300 ring-slate-700" },
  [PAYOUT_STATUS.READY]: { label: "Ready", cls: "bg-sky-500/10 text-sky-300 ring-sky-500/30" },
  [PAYOUT_STATUS.SUBMITTED]: { label: "Submitted", cls: "bg-indigo-500/10 text-indigo-300 ring-indigo-500/30" },
  [PAYOUT_STATUS.PAID]: { label: "Paid", cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" },
  [PAYOUT_STATUS.FAILED]: { label: "Failed", cls: "bg-rose-500/10 text-rose-300 ring-rose-500/30" },
  [PAYOUT_STATUS.FLAGGED]: { label: "Flagged", cls: "bg-rose-500/10 text-rose-300 ring-rose-500/30" },
  [PAYOUT_STATUS.DISCLOSED]: { label: "Disclosed", cls: "bg-violet-500/10 text-violet-300 ring-violet-500/30" },
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const s = BATCH[status];
  return <span className={cn(base, s.cls)}>{s.label}</span>;
}

export function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  const s = PAYOUT[status];
  return <span className={cn(base, s.cls)}>{s.label}</span>;
}
