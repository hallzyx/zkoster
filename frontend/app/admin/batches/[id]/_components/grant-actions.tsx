"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { DISCLOSURE_SCOPE, type DisclosureScope } from "@/lib/types";
import {
  issueGrantAction,
  revokeGrantAction,
  type ActionResult,
  type IssueGrantResult,
} from "@/app/admin/actions";

// ---------------------------------------------------------------------------
// GrantActions — issue form
// ---------------------------------------------------------------------------

interface GrantActionsProps {
  batchId: number;
}

export function GrantActions({ batchId }: GrantActionsProps) {
  const [pending, startTransition] = useTransition();
  const [scope, setScope] = useState<DisclosureScope>(DISCLOSURE_SCOPE.TOTALS_ONLY);
  const [result, setResult] = useState<IssueGrantResult | null>(null);
  const router = useRouter();

  function handleIssue() {
    if (pending) return;
    startTransition(async () => {
      const r = await issueGrantAction(batchId, scope);
      setResult(r);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium text-slate-300">Issue grant</span>
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as DisclosureScope)}
          disabled={pending}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {/* Sample (scope=1) is intentionally omitted — it requires payoutId!=0
              (contract rule: InvalidGrantTarget). Only whole-batch scopes here. */}
          <option value={DISCLOSURE_SCOPE.TOTALS_ONLY}>Totals Only</option>
          <option value={DISCLOSURE_SCOPE.FULL_BATCH}>Full Batch</option>
        </select>

        <button
          type="button"
          disabled={pending}
          onClick={handleIssue}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            pending
              ? "cursor-not-allowed bg-slate-700 text-slate-400"
              : "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700",
          )}
        >
          {pending ? "Working…" : "Issue grant"}
        </button>
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
              Grant issued — tx{" "}
              <span className="font-mono text-xs text-emerald-400">
                {result.txHash.slice(0, 8)}…{result.txHash.slice(-6)}
              </span>
              {result.grantId !== undefined ? (
                <span className="ml-2 text-emerald-500">(grant #{result.grantId})</span>
              ) : null}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// RevokeButton — per-row revoke, isolated client state
// ---------------------------------------------------------------------------

interface RevokeButtonProps {
  grantId: number;
}

export function RevokeButton({ grantId }: RevokeButtonProps) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();

  function handleRevoke() {
    if (pending) return;
    startTransition(async () => {
      const r = await revokeGrantAction(grantId);
      setResult(r);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={handleRevoke}
        className={cn(
          "rounded-lg border px-3 py-1 text-xs font-medium transition-colors",
          pending
            ? "cursor-not-allowed border-slate-700 text-slate-500"
            : "border-red-800 text-red-300 hover:bg-red-950/40 active:bg-red-950/60",
        )}
      >
        {pending ? "Revoking…" : "Revoke"}
      </button>
      {result !== null && !result.ok && (
        <span className="text-xs text-red-400">{result.error}</span>
      )}
    </div>
  );
}
