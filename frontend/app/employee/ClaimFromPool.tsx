"use client";

// ClaimFromPool — employee "Claim from Privacy Pool" step.
//
// Shows when:
//   - payout.status === "paid"  AND
//   - the batch has an sppDepositRef (admin ran record_spp_deposit)
//
// States: idle → claiming → claimed (success) | error

import { useState } from "react";
import { ShieldCheck, Loader2, AlertCircle } from "lucide-react";

import { claimPayoutFromPool } from "./actions";

type ClaimState =
  | { phase: "idle" }
  | { phase: "claiming" }
  | { phase: "claimed"; txHash: string }
  | { phase: "error"; message: string; isDemo?: boolean };

export function ClaimFromPool({
  payoutId,
  amount,
  recipientAddress,
}: {
  payoutId: number;
  amount: number;
  recipientAddress: string;
}) {
  const [state, setState] = useState<ClaimState>({ phase: "idle" });

  async function handleClaim() {
    setState({ phase: "claiming" });
    const result = await claimPayoutFromPool(payoutId, amount, recipientAddress);
    if (result.ok) {
      setState({ phase: "claimed", txHash: result.txHash });
    } else {
      setState({ phase: "error", message: result.error, isDemo: result.isDemo });
    }
  }

  if (state.phase === "idle") {
    return (
      <div className="mt-2 flex flex-col gap-1">
        <button
          onClick={handleClaim}
          className="inline-flex items-center gap-1.5 rounded-md bg-violet-600/20 px-3 py-1.5 text-xs font-medium text-violet-300 ring-1 ring-violet-500/40 transition hover:bg-violet-600/30 hover:text-violet-200"
        >
          <ShieldCheck className="size-3.5" />
          Claim from Privacy Pool
        </button>
        <p className="text-[11px] text-slate-600">
          Demo: privacy pool claim. In production, proof generation happens client-side.
        </p>
      </div>
    );
  }

  if (state.phase === "claiming") {
    return (
      <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-400">
        <Loader2 className="size-3.5 animate-spin" />
        Claiming…
      </div>
    );
  }

  if (state.phase === "claimed") {
    return (
      <div className="mt-2 flex flex-col gap-1">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <ShieldCheck className="size-3.5" />
          Claimed ✓
        </span>
        <span className="font-mono text-[11px] text-slate-500">
          tx: {state.txHash.slice(0, 12)}…{state.txHash.slice(-6)}
        </span>
        <p className="text-[11px] text-slate-500">
          Your payment has been privately transferred.
        </p>
      </div>
    );
  }

  // error phase
  return (
    <div className="mt-2 flex flex-col gap-1">
      {state.isDemo ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-400">
          <ShieldCheck className="size-3.5" />
          Demo mode: proof verification simulated
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="size-3.5" />
          Claim failed
        </span>
      )}
      <p className="max-w-xs text-[11px] text-slate-500">{state.message}</p>
      {!state.isDemo && (
        <button
          onClick={() => setState({ phase: "idle" })}
          className="text-[11px] text-slate-400 underline hover:text-slate-300"
        >
          Try again
        </button>
      )}
    </div>
  );
}
