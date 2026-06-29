"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/app/_components/ui";
import { TxHashLink } from "@/app/_components/tx-hash-link";
import { cn } from "@/lib/utils";
import { PUBLIC_NETWORK_PASSPHRASE } from "@/lib/config";
import { BATCH_STATUS, type BatchStatus } from "@/lib/types";
import {
  depositToPrivacyPoolAction,
  type SppDepositActionResult,
} from "@/app/admin/actions";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SppDepositStepProps {
  batchId: number;
  status: BatchStatus;
  /** Hex-encoded 32-byte SPP deposit ref already anchored on-chain, or null. */
  sppDepositRef: string | null;
  /** Batch total in UI display units (passed as-is to the pool action). */
  totalAmount: number;
}

// ---------------------------------------------------------------------------
// Helper: shorten a hex ref for display (8 chars … 6 chars).
// ---------------------------------------------------------------------------

function shortRef(hex: string): string {
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the "Deposit to Privacy Pool" lifecycle step for admin batch detail.
 *
 * Lifecycle:
 *   - Batch status NOT Funded → renders nothing (not yet applicable).
 *   - Batch Funded + no sppDepositRef → shows "Deposit to Privacy Pool" button.
 *   - After success (or sppDepositRef already set) → shows "Privacy Pool: funded" badge.
 */
export function SppDepositStep({
  batchId,
  status,
  sppDepositRef,
  totalAmount,
}: SppDepositStepProps) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SppDepositActionResult | null>(null);
  const router = useRouter();

  // Only show this step for Funded (or later) batches.
  const isFunded =
    status === BATCH_STATUS.FUNDED ||
    status === BATCH_STATUS.PROCESSING ||
    status === BATCH_STATUS.PAID ||
    status === BATCH_STATUS.PARTIALLY_FLAGGED ||
    status === BATCH_STATUS.CLOSED;

  if (!isFunded) return null;

  // Determine effective deposit ref + tx hash: prefer the just-recorded result
  // over the props so the UI updates immediately without waiting for a page
  // refresh. The "tx hash" is only available from the local result — when
  // reading from storage (sppDepositRef populated server-side), we don't have
  // the tx hash on the read path, so we fall back to a static label.
  const effectiveRef =
    (result?.ok ? result.sppRef : null) ?? sppDepositRef;
  const effectiveTxHash = result?.ok ? result.txHash : null;

  function handleDeposit() {
    if (pending || effectiveRef) return;
    startTransition(async () => {
      const r = await depositToPrivacyPoolAction(batchId, totalAmount);
      setResult(r);
      if (r.ok) {
        router.refresh();
      }
    });
  }

  return (
    <Card className="mt-4 flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-slate-300">
            Privacy Pool deposit
          </span>
          <span className="text-xs text-slate-500">
            Privacy-preserving deposit: amount is moved into a Groth16 private pool.
          </span>
        </div>

        {effectiveRef ? (
          /* Already deposited — show badge */
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
              "bg-violet-950/60 text-violet-300 ring-1 ring-violet-700/50",
            )}
          >
            <span className="size-1.5 rounded-full bg-violet-400" />
            Privacy Pool: funded
          </span>
        ) : (
          /* Not yet deposited — show action button */
          <button
            type="button"
            disabled={pending}
            onClick={handleDeposit}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              pending
                ? "cursor-not-allowed bg-slate-700 text-slate-400"
                : "bg-violet-600 text-white hover:bg-violet-500 active:bg-violet-700",
            )}
          >
            {pending ? "Depositing…" : "Deposit to Privacy Pool"}
          </button>
        )}
      </div>

      {/* SPP reference display (shown once the ref is available) */}
      {effectiveRef && (
        <div className="flex flex-col gap-1 rounded-lg border border-violet-800/40 bg-violet-950/20 px-4 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            SPP deposit ref
          </span>
          <span
            className="font-mono text-xs text-violet-300"
            title={effectiveRef}
          >
            {shortRef(effectiveRef)}
          </span>
          {effectiveTxHash ? (
            <span className="mt-0.5 font-mono text-xs text-slate-500">
              <TxHashLink
                hash={effectiveTxHash}
                passphrase={PUBLIC_NETWORK_PASSPHRASE}
              />
            </span>
          ) : (
            <span className="mt-0.5 text-xs text-slate-600">
              Deposit tx recorded on-chain
            </span>
          )}
        </div>
      )}

      {/* Success notice */}
      {result?.ok && !sppDepositRef && (
        <div className="rounded-lg border border-violet-800 bg-violet-950/40 px-4 py-3 text-sm text-violet-300">
          Funds in Privacy Pool — deposit reference anchored on-chain.
        </div>
      )}

      {/* Error notice */}
      {result && !result.ok && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {result.step ? (
            <span className="font-medium text-red-400">[{result.step}] </span>
          ) : null}
          {result.error}
        </div>
      )}
    </Card>
  );
}
