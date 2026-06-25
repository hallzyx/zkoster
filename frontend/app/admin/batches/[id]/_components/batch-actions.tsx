"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/app/_components/ui";
import { cn } from "@/lib/utils";
import { BATCH_STATUS, type BatchStatus } from "@/lib/types";
import {
  reviewBatchAction,
  approveBatchAction,
  fundBatchAction,
  executePayoutsAction,
  type ActionResult,
} from "@/app/admin/actions";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BatchActionsProps {
  batchId: number;
  status: BatchStatus;
}

// ---------------------------------------------------------------------------
// Status → action map
// ---------------------------------------------------------------------------

type ActionFn = (batchId: number) => Promise<ActionResult>;

interface StepConfig {
  label: string;
  action: ActionFn;
}

const STEP_MAP: Partial<Record<BatchStatus, StepConfig>> = {
  [BATCH_STATUS.DRAFT]: {
    label: "Review batch",
    action: reviewBatchAction,
  },
  [BATCH_STATUS.REVIEWED]: {
    label: "Approve batch",
    action: approveBatchAction,
  },
  [BATCH_STATUS.APPROVED]: {
    label: "Fund batch",
    action: fundBatchAction,
  },
  [BATCH_STATUS.FUNDED]: {
    label: "Execute payouts",
    action: executePayoutsAction,
  },
  [BATCH_STATUS.PROCESSING]: {
    label: "Execute payouts",
    action: executePayoutsAction,
  },
};

const TERMINAL_STATUSES: BatchStatus[] = [
  BATCH_STATUS.PAID,
  BATCH_STATUS.PARTIALLY_FLAGGED,
  BATCH_STATUS.CLOSED,
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BatchActions({ batchId, status }: BatchActionsProps) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  const step = STEP_MAP[status];
  const isTerminal = TERMINAL_STATUSES.includes(status);

  function handleClick() {
    if (!step || pending) return;
    startTransition(async () => {
      const r = await step.action(batchId);
      setResult(r);
      if (r.ok) {
        router.refresh();
      }
    });
  }

  return (
    <Card className="mt-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-300">Admin actions</span>

        {isTerminal ? (
          <span className="text-sm text-slate-500 italic">
            No further action — batch is {status}.
          </span>
        ) : step ? (
          <button
            type="button"
            disabled={pending}
            onClick={handleClick}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              pending
                ? "cursor-not-allowed bg-slate-700 text-slate-400"
                : "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700",
            )}
          >
            {pending ? "Working…" : step.label}
          </button>
        ) : null}
      </div>

      {result !== null && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            result.ok
              ? "border-emerald-800 bg-emerald-950/40 text-emerald-300"
              : "border-red-800 bg-red-950/40 text-red-300",
          )}
        >
          {result.ok ? (
            <span>
              Success — tx{" "}
              <span className="font-mono text-xs text-emerald-400">
                {result.txHash.slice(0, 8)}…{result.txHash.slice(-6)}
              </span>
            </span>
          ) : (
            <span>
              {result.step ? (
                <span className="font-medium text-red-400">[{result.step}] </span>
              ) : null}
              {result.error}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
