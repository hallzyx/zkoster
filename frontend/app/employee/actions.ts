"use server";

// Employee server actions — SPP claim flow.
//
// The SPP proof runs server-side so the employee keypair (from env vars) never
// needs to be passed to the browser.  In production, the employee would supply
// their own keypair client-side; this is a demo-grade shortcut.

import { generateDemoNote } from "@/lib/spp/notes";
import { claimFromPool } from "@/lib/spp/pool-client";
import { ROLE } from "@/lib/types";
import { roleKeypair } from "@/lib/wallets";

export type ClaimResult =
  | { ok: true; txHash: string }
  | { ok: false; error: string; isDemo?: boolean };

/**
 * Attempt to claim a payout from the SPP privacy pool.
 *
 * DEMO: generates a placeholder note and submits it with a zero-filled
 * Groth16 proof.  The pool's verifier will reject it — that error is caught
 * and surfaced as a friendly "Demo mode" message so the UI can still show the
 * full claim flow end-to-end.
 *
 * In production, the employee would generate the spend proof client-side using
 * the SPP Rust/WASM prover and sign with their own keypair.
 *
 * @param payoutId - ID of the payout being claimed (used to label the demo note).
 * @param amount   - Cleartext payout amount in USD display units (e.g. 7800 = $7,800).
 * @param recipientAddress - Stellar address of the employee.
 */
export async function claimPayoutFromPool(
  payoutId: number,
  amount: number,
  recipientAddress: string,
): Promise<ClaimResult> {
  try {
    const keypair = roleKeypair(ROLE.EMPLOYEE);
    // Convert display-unit USD to micro-USDC (7 decimal places) for the note.
    const microAmount = BigInt(Math.round(amount * 10_000_000));
    const note = generateDemoNote(microAmount, recipientAddress);
    const result = await claimFromPool(note, keypair);
    return { ok: true, txHash: result.txHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Demo proof rejection is expected — surface it as a friendly message.
    if (msg.includes("[DEMO]")) {
      return {
        ok: false,
        error: `Demo mode: proof verification simulated. Payout #${payoutId} would be privately transferred in production.`,
        isDemo: true,
      };
    }
    // Real errors (network, missing keypair, etc.) pass through as-is.
    return { ok: false, error: msg };
  }
}
